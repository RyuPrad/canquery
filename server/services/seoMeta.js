// Pure SEO helpers: route classification, safe HTML/JSON-LD escaping, per-page
// <head> building (title/description/canonical/OpenGraph/Twitter) and
// schema.org JSON-LD (Dataset / WebSite / Organization). No DB, no fs, no
// Express - so it is fully unit-testable and reused by both the SPA head
// injector (controllers/spaController.js) and any other caller.
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { classifyResource } = require('./resourceCapabilities');
const { plainText, collapse, truncate, resourceLanguages } = require('./catalogText');
const facts = require('./catalogFacts');
const { hostedRoutes, hostedRoute, pageOverride } = require('../extensions');

const SITE_URL = (process.env.SITE_URL || 'https://canquery.com').replace(/\/+$/, '');
const SITE_NAME = 'CanQuery';
const DEFAULT_TITLE = 'Canadian open data & government datasets - CanQuery';
const DEFAULT_DESC =
    'Search Canadian government datasets by place and topic. Find CSV downloads, explore supported tables and maps, and use CanQuery’s free API.';
// Link previews (Facebook, LinkedIn, X, Bluesky, Slack) need a raster image.
const DEFAULT_IMAGE = SITE_URL + '/og-image.png';
const DEFAULT_IMAGE_ALT = 'CanQuery: Canadian open data search, tables and maps';
const REPO_URL = 'https://github.com/RyuPrad/canquery';
const BLUESKY_URL = 'https://bsky.app/profile/canquery.com';
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 160;
const TITLE_SUFFIX = ' - CanQuery';
const DATASET_DESCRIPTION_MIN = 50;
// Search results show about 60 characters of a title. Candidates that fit are
// preferred; longer ones stay whole up to the hard bound and are compacted at
// natural boundaries beyond it, never cut mid-word with an ellipsis.
const TITLE_SOFT = 60;
const TITLE_HARD = TITLE_MAX - TITLE_SUFFIX.length;

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// JSON-LD and the resource page's embedded initial data live inside <script>
// elements, so the serialized JSON must not be able to break out of them.
// Escaping < > & to their \u form keeps the payload valid JSON while making
// "</script>" and "<!--" impossible to form. Data blocks (any non-JavaScript
// type) are inert: browsers neither execute nor fetch them.
function jsonScript(obj, { type = 'application/ld+json', id } = {}) {
    const json = JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    return '<script type="' + escapeHtml(type) + '"' + (id ? ' id="' + escapeHtml(id) + '"' : '') + '>' + json + '</script>';
}

const jsonLdScript = obj => jsonScript(obj);

// English-default site: prefer the EN value, fall back to FR when EN is blank.
function pick(en, fr) {
    return plainText(en) || plainText(fr) || '';
}

function siteTitle(value) {
    return truncate(collapse(value) || 'Open data', TITLE_MAX - TITLE_SUFFIX.length) + TITLE_SUFFIX;
}

// Function words skipped when matching a phrase's initials against its acronym.
const ACRONYM_SKIP = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'des', 'du', 'et', 'for', 'from', 'in', 'la', 'le',
    'les', 'of', 'on', 'or', 'par', 'pour', 'sur', 'the', 'to', 'à']);

// "Labour Market Impact Assessment (LMIA) list" -> "LMIA list": a parenthetical
// acronym replaces the shortest preceding phrase whose initials spell it.
// Digit-only and format tokens such as "(2021)" or "(CSV)" match no phrase.
function collapseAcronyms(value, max) {
    let text = value;
    const re = /\(([A-Z][A-Z0-9]{1,9})\)/g;
    let match;
    while (text.length > max && (match = re.exec(text))) {
        const acronym = match[1];
        const head = text.slice(0, match.index).trimEnd();
        const words = head ? head.split(' ') : [];
        let replaced = false;
        for (let start = words.length - 1; start >= 0 && words.length - start <= 12; start -= 1) {
            const phrase = words.slice(start);
            const initials = phrase
                .filter(word => !ACRONYM_SKIP.has(word.toLowerCase().replace(/[^a-zà-ÿ]/g, '')))
                .map(word => (word.match(/[A-Za-zÀ-ÿ0-9]/) || [''])[0])
                .join('')
                .toUpperCase();
            if (phrase.length >= 2 && initials === acronym) {
                const before = words.slice(0, start).join(' ');
                text = (before ? before + ' ' : '') + acronym + text.slice(match.index + match[0].length);
                re.lastIndex = (before ? before.length + 1 : 0) + acronym.length;
                replaced = true;
                break;
            }
        }
        if (!replaced) re.lastIndex = match.index + match[0].length;
    }
    return text;
}

const TITLE_SEPARATOR_RE = /:\s|\s[-–—|]\s/g;

// A title that fits `max` as it stands or with its spelled-out acronyms
// collapsed; null when it would have to be shortened.
function wholeTitle(value, max) {
    const text = collapse(value);
    if (text.length <= max) return text;
    const collapsed = collapseAcronyms(text, max);
    return collapsed.length <= max ? collapsed : null;
}

// A title shortened only at a natural boundary: whole, or its leading clause
// before a separator, or before a comma when that clause keeps most of the
// room ("Merchandise imports and exports customs-based price indexes, Canada
// and United States trade, …"); '' when only a mid-phrase cut would fit.
function titleClause(value, max) {
    const whole = wholeTitle(value, max);
    if (whole) return whole;
    const collapsed = collapseAcronyms(collapse(value), max);
    let best = '';
    for (const match of collapsed.matchAll(TITLE_SEPARATOR_RE)) {
        const head = collapsed.slice(0, match.index).trim();
        if (head.length >= 24 && head.length <= max && head.length > best.length) best = head;
    }
    if (best) return best;
    for (const match of collapsed.matchAll(/,\s/g)) {
        const head = collapsed.slice(0, match.index).trim();
        if (head.length >= Math.floor(max * 0.75) && head.length <= max && head.length > best.length) best = head;
    }
    return best;
}

// Shorten a title to `max` characters without a mid-string ellipsis: collapse
// spelled-out acronyms, then keep the leading clause before a natural
// separator, then cut at a word boundary; `truncate` only as a last resort.
function compactTitle(value, max) {
    const text = collapse(value);
    const whole = wholeTitle(text, max);
    if (whole) return whole;
    const collapsed = collapseAcronyms(text, max);
    let best = null;
    for (const match of collapsed.matchAll(TITLE_SEPARATOR_RE)) {
        const head = collapsed.slice(0, match.index).trim();
        if (head.length >= 24 && head.length <= max && (!best || head.length > best.length)) best = head;
    }
    if (best) return best;
    let cut = collapsed.slice(0, max + 1).replace(/\s+\S*$/, '');
    if ((cut.match(/\(/g) || []).length > (cut.match(/\)/g) || []).length) cut = cut.slice(0, cut.lastIndexOf('('));
    cut = cut.trim().replace(/[\s,;:(–—-]+$/, '');
    // A cut never ends on a dangling function word ("… with a").
    let trailing;
    while ((trailing = cut.match(/\s+(a|an|and|at|by|de|des|du|et|for|from|in|la|le|les|of|on|or|the|to|with)$/i))) {
        cut = cut.slice(0, cut.length - trailing[0].length).replace(/[\s,;:(–—-]+$/, '');
    }
    const minimum = Math.max(12, Math.min(24, Math.floor(max * 0.75)));
    // Nor inside a two-word tail that a conjunction or a clause-opening
    // preposition starts when the title goes on past it ("… authorities and
    // other", "… to include"); "of" and "by" tails such as "level of
    // education" usually stand as they are.
    const tail = /\s+(?:and|for|in|or|to|with|à|au|aux|avec|dans|et|ou|pour)\s+\S+$/i.exec(cut);
    if (tail && tail.index >= minimum && /^\s+[^\s,;:)]/.test(collapsed.slice(cut.length))) {
        cut = cut.slice(0, tail.index).replace(/[\s,;:(–—-]+$/, '');
    }
    if (cut.length >= minimum && cut.length <= max) return cut;
    // A file name ("Survey_Point_Counts_2003_EN_FR.csv") has no spaces to cut
    // at; its underscores and hyphens separate the words instead.
    const fileCut = collapsed.slice(0, max + 1).replace(/[_-]+[^\s_-]*$/, '').replace(/[\s_.,;:(–—-]+$/, '');
    return fileCut.length >= minimum && fileCut.length <= max ? fileCut : truncate(collapsed, max);
}

// Prefer the first candidate that fits a search-result title, then the first
// within the hard bound, then a compacted version of the last candidate.
function fitTitle(candidates, { soft = TITLE_SOFT, hard = TITLE_HARD } = {}) {
    const list = (candidates || []).map(collapse).filter(Boolean);
    return list.find(candidate => candidate.length <= soft) ||
        list.find(candidate => candidate.length <= hard) ||
        compactTitle(list[list.length - 1] || 'Open data', hard);
}

// Candidates come in tiers of decreasing information (with the facts a
// searcher wants, then without). A tier is abandoned only when none of its
// candidates fits the hard bound, so a bare title never beats a longer one
// that still says what the page offers.
function fitTitleTiers(tiers, { soft = TITLE_SOFT, hard = TITLE_HARD } = {}) {
    for (const tier of tiers) {
        const list = (tier || []).map(collapse).filter(Boolean);
        const found = list.find(candidate => candidate.length <= soft) || list.find(candidate => candidate.length <= hard);
        if (found) return found;
    }
    return fitTitle(tiers.flat(), { soft, hard });
}

// Later pages of a paginated page carry "(page N)" in their title and
// description, so they never duplicate page one's snippet.
function pagedMeta(meta, page) {
    if (!(page > 1)) return meta;
    const label = ' (page ' + page + ')';
    const title = meta.title || 'Open data' + TITLE_SUFFIX;
    const base = title.endsWith(TITLE_SUFFIX) ? title.slice(0, -TITLE_SUFFIX.length) : title;
    const body = base.length + label.length <= TITLE_HARD ? base : compactTitle(base, TITLE_HARD - label.length);
    return {
        ...meta,
        title: body + label + TITLE_SUFFIX,
        description: truncate(meta.description || DEFAULT_DESC, DESCRIPTION_MAX - label.length) + label
    };
}

// Publishers bound to a place or mirrored from the federal portal are
// governments; anything else is described as an organization.
const organizationType = row => (row && (row.place_id || row.government) ? 'GovernmentOrganization' : 'Organization');

const GENERIC_RESOURCE_NAMES = new Set([
    'data', 'dataset', 'download', 'english', 'en', 'file', 'french', 'fr',
    'francais', 'français', 'ensembles de données', 'ensemble de données', 'resource', 'csv', 'xls', 'xlsx', 'json', 'geojson',
    'xml', 'pdf', 'zip'
]);

function isGenericResourceName(value, format) {
    const normalized = collapse(value).toLowerCase().replace(/[._-]+/g, ' ');
    const normalizedFormat = collapse(format).toLowerCase();
    return !normalized || GENERIC_RESOURCE_NAMES.has(normalized) ||
        (normalizedFormat && normalized === normalizedFormat) || Boolean(downloadName(value, format));
}

// Match only publisher download boilerplate. Extra subject words must not be
// discarded. JP2's expanded label appears in bilingual federal metadata.
function downloadName(value, format) {
    const normalized = collapse(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const normalizedFormat = collapse(format).toLowerCase();
    if (!normalizedFormat) return null;
    const escaped = normalizedFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const formatPattern = ['jp2', 'jpeg2000'].includes(normalizedFormat) ? '(?:jp2|jpeg2000)' : escaped;
    const en = new RegExp('^download(?: the)?(?: (english|french))? ' + formatPattern +
        '(?: file)?(?: (?:through|via) (?:https?|ftp))?$', 'i').exec(normalized);
    if (en) return { qualifier: en[1] === 'english' ? 'English' : en[1] === 'french' ? 'French' : '' };
    const fr = new RegExp('^telecharg(?:er|ez)(?: le)? fichier(?: en format)? ' + formatPattern +
        '(?: (anglais|francais))?(?: via (?:https?|ftp))?$', 'i').exec(normalized);
    return fr ? { qualifier: fr[1] === 'francais' ? 'français' : fr[1] || '' } : null;
}

function isPeriodName(name) {
    return /^\d{4}(?:-\d{2}(?:-\d{2})?)?(?:\s*(?:to|au|à|[-–—/])\s*\d{4}(?:-\d{2}(?:-\d{2})?)?)?$/i.test(name) ||
        /^(?:[QT][1-4]\s+\d{4}|\d{4}\s+[QT][1-4])$/i.test(name);
}

// The year, or fiscal year such as 2006–07, in a file's name; null when the
// name has none or several. A digit run (a date such as 20240115 or a code
// such as 100001) is not a year.
const FILE_YEAR_RE = /(?:^|[^a-z0-9])((?:19|20)\d{2})(?:[-–_](\d{4}|\d{2}))?(?=$|[^a-z0-9])/gi;
const NAME_YEAR_RE = /(?:^|[^0-9])(?:19|20)\d{2}(?![0-9])/;

function fileYear(url) {
    let file = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
    try {
        file = decodeURIComponent(file);
    } catch {
        // A malformed escape keeps the raw name.
    }
    file = file.replace(/\.[a-z0-9]{1,5}$/i, '');
    const years = new Set();
    for (const match of file.matchAll(FILE_YEAR_RE)) {
        const start = Number(match[1]);
        const end = match[2];
        if (end && Number(end) === (end.length === 2 ? (start + 1) % 100 : start + 1)) years.add(match[1] + '–' + end.slice(-2));
        else {
            years.add(match[1]);
            // A second four-digit year makes a range, which names no single year.
            if (end && end.length === 4 && /^(?:19|20)/.test(end)) years.add(end);
        }
    }
    return years.size === 1 ? [...years][0] : null;
}

// Yearly files of one dataset often share a name, format and language ("Key
// ratios" for 2022, 2023 and 2024), so their pages had the same <title> and
// heading and Google kept one of them as the canonical. When the dataset has
// such siblings (same_name_siblings) and the text names no year, the year in
// the file's name tells the pages apart.
function siblingYear(resource, text) {
    if (!(Number(resource.same_name_siblings) > 0) || NAME_YEAR_RE.test(text || '')) return null;
    return fileYear(resource.url);
}

function withSiblingYear(resource, text) {
    const year = text ? siblingYear(resource, text) : null;
    return year ? text + ' ' + year : text;
}

function resourceSubject(resource) {
    const name = pick(resource.name_en, resource.name_fr);
    const datasetTitle = pick(resource.dataset_title_en, resource.dataset_title_fr);
    if (datasetTitle && isPeriodName(name)) return datasetTitle + ' — ' + name;
    const download = downloadName(name, resource.format);
    if (datasetTitle && download) {
        return withSiblingYear(resource, datasetTitle) + (download.qualifier ? ' — ' + download.qualifier : '');
    }
    return withSiblingYear(resource, isGenericResourceName(name, resource.format) ? datasetTitle : name) || name || datasetTitle;
}

function titleContainsFormat(value, format) {
    const normalizedFormat = collapse(format);
    if (!normalizedFormat) return true;
    const escaped = normalizedFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(value);
}

// A dataset title followed by a period or qualifier (" — 2023", " — English").
// A sibling's year joins the title when it fits whole, else the qualifier, so
// cutting a long title cannot drop it.
function wholePeriodTitle(datasetTitle, period, year, room) {
    const text = collapse(datasetTitle) + (year ? ' ' + year : '') + period;
    return text.length <= room ? text : null;
}

function periodTitle(datasetTitle, period, year, room) {
    const yearText = year ? ' ' + year : '';
    return wholePeriodTitle(datasetTitle, period, year, room) ||
        compactTitle(datasetTitle, Math.max(12, room - period.length - yearText.length)) + period + yearText;
}

// The language words a title's qualifier adds, leaving out a language the
// subject already names: "Canadian Earthquakes (English)" is not followed by
// "(English, CSV)".
const NAMED_LANGUAGE_RE = { en: /\((?:english|anglais)\)/i, fr: /\((?:french|fran[cç]ais)\)/i };

function titleLanguages(subject, codes, lang = 'en') {
    return codes.filter(code => !NAMED_LANGUAGE_RE[code].test(subject)).map(code => lang === 'fr'
        ? (code === 'fr' ? 'français' : 'anglais') : (code === 'fr' ? 'French' : 'English'));
}

function resourceTitleBase(resource, max = null, lang = 'en') {
    const name = pick(resource.name_en, resource.name_fr);
    const datasetTitle = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const qualifier = downloadName(name, resource.format)?.qualifier;
    const format = collapse(resource.format).toUpperCase();
    let base = resourceSubject(resource) || 'Resource';
    const languages = titleLanguages(base, resourceLanguages(resource), lang);
    const suffixParts = [...languages, format && !titleContainsFormat(base, format) ? format : ''].filter(Boolean);
    const suffix = suffixParts.length ? ' (' + suffixParts.join(', ') + ')' : '';
    if (max && datasetTitle && (isPeriodName(name) || qualifier)) {
        const year = isPeriodName(name) ? '' : siblingYear(resource, datasetTitle);
        base = periodTitle(datasetTitle, ' — ' + (qualifier || name), year, max - suffix.length);
    }
    return (max ? compactTitle(base, Math.max(12, max - suffix.length)) : base) + suffix;
}

// A dataset title to lead a resource title: whole, or its leading clause
// before a natural separator; '' when only a mid-phrase fragment would fit.
function datasetLead(title, max) {
    const text = collapseAcronyms(collapse(title), max);
    if (text.length <= max) return text;
    let best = '';
    for (const match of text.matchAll(TITLE_SEPARATOR_RE)) {
        const head = text.slice(0, match.index).trim();
        if (head.length >= 12 && head.length <= max && head.length > best.length) best = head;
    }
    return best;
}

const fold = value => collapse(value).toLowerCase();
const DATASET_YEAR_RE = /\b(?:19|20)\d{2}(?:[-–/](?:\d{4}|\d{2}))?\b/;

// File names such as "Data dictionary", "Parks" or "Charitable programs" recur
// across hundreds of datasets and would give each of their pages the same
// <title>. A name that its dataset's title does not already cover is led by
// that title ("Building Permits — Data dictionary"), or followed by the
// dataset's year when both cannot fit; a short phrase that is still shared
// gets the publisher. The text is returned before any shortening to `room`.
function distinctResourceText(resource, subject, room) {
    const name = collapse(withSiblingYear(resource, pick(resource.name_en, resource.name_fr)));
    const datasetTitle = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const publisher = pick(resource.org_title_en, resource.org_title_fr);
    let text = collapse(subject);
    if (datasetTitle && name && fold(subject) === fold(name) &&
        !fold(name).includes(fold(datasetTitle)) && !fold(datasetTitle).includes(fold(name))) {
        const tail = ' — ' + name;
        const lead = datasetLead(datasetTitle, room - tail.length);
        const year = (datasetTitle.match(DATASET_YEAR_RE) || [''])[0];
        if (lead && !fold(name).includes(fold(lead))) text = lead + tail;
        else if (year && !name.includes(year)) text = name + ' — ' + year;
    }
    if (publisher && text === collapse(subject) && text.length < 25 && !fold(text).includes(fold(publisher)) &&
        text.length + 3 + collapse(publisher).length <= room) {
        text += ' — ' + collapse(publisher);
    }
    return text;
}

// The <title> of a resource page: the subject plus a qualifier that says what
// the file is on CanQuery, such as "(French, XLSX table)", "(CSV live table
// and map)" or "(English, PDF)". The subject is not cut to make room for the
// qualifier: the language words go first, then the format and table words.
// Only "French" on a French-only file stays, as English is the site's default:
// the file's English twin, if any, carries no language word of its own then.
// A subject too long to stand whole even so is shortened behind the shorter
// qualifier.
function resourceTitle(resource) {
    const name = pick(resource.name_en, resource.name_fr);
    const datasetTitle = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const qualifier = downloadName(name, resource.format)?.qualifier;
    const info = facts.resourceFacts(resource);
    const subject = resourceSubject(resource) || 'Resource';
    const languages = titleLanguages(subject, info.languages);
    const formatPart = [titleContainsFormat(subject, info.format) ? '' : info.format, facts.capabilityWord(info)]
        .filter(Boolean).join(' ');
    const qualify = parts => (parts.some(Boolean) ? ' (' + parts.filter(Boolean).join(', ') + ')' : '');
    const kept = languages.length === 1 && languages[0] === 'French' ? languages : [];
    const shorter = qualify([...kept, formatPart]);
    const suffixes = [...new Set([qualify([...languages, formatPart]), shorter, qualify(kept)])];
    const period = datasetTitle && (isPeriodName(name) || qualifier) ? ' — ' + (qualifier || name) : '';
    const year = period && !isPeriodName(name) ? siblingYear(resource, datasetTitle) : '';
    const base = (suffix, whole) => {
        const room = Math.max(12, TITLE_HARD - suffix.length);
        if (period) return whole ? wholePeriodTitle(datasetTitle, period, year, room) : periodTitle(datasetTitle, period, year, room);
        const text = distinctResourceText(resource, subject, room);
        return whole ? wholeTitle(text, room) : compactTitle(text, room);
    };
    for (const suffix of suffixes) {
        const text = base(suffix, true);
        if (text) return text + suffix + TITLE_SUFFIX;
    }
    return base(shorter, false) + shorter + TITLE_SUFFIX;
}

function buildBreadcrumbJsonLd(items) {
    const unique = [];
    const paths = new Set();
    for (const item of items || []) {
        const name = collapse(item && item.name);
        const path = item && item.path;
        if (!name || !path) continue;
        const url = canonicalFor(path);
        if (paths.has(url)) continue;
        paths.add(url);
        unique.push({ name, url });
    }
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: unique.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: item.url
        }))
    };
}

function canonicalFor(pathname) {
    let p = pathname || '/';
    const q = p.indexOf('?');
    if (q !== -1) p = p.slice(0, q);
    if (p !== '/') p = p.replace(/\/+$/, '');
    if (!p.startsWith('/')) p = '/' + p;
    return SITE_URL + p;
}

function decodePathSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

function classifyRoute(pathname) {
    const p = (pathname || '/').replace(/\?.*$/, '');
    if (p === '/' || p === '') return { type: 'home' };
    let m = p.match(/^\/datasets\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'dataset', id };
    }
    m = p.match(/^\/resources\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'resource', id };
    }
    m = p.match(/^\/places\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'place', id };
    }
    m = p.match(/^\/organizations\/([^/]+)\/?$/);
    if (m) {
        const id = decodePathSegment(m[1]);
        return id == null ? { type: 'other' } : { type: 'organization', id };
    }
    if (/^\/datasets\/?$/.test(p)) return { type: 'datasets' };
    if (/^\/places\/?$/.test(p)) return { type: 'places' };
    if (/^\/insights\/?$/.test(p)) return { type: 'insights' };
    if (/^\/organizations\/?$/.test(p)) return { type: 'organizations' };
    if (/^\/docs\/?$/.test(p)) return { type: 'docs' };
    if (/^\/privacy\/?$/.test(p)) return { type: 'privacy' };
    if (/^\/faq\/?$/.test(p)) return { type: 'faq' };
    if (/^\/about\/?$/.test(p)) return { type: 'about' };
    for (const route of hostedRoutes()) {
        if (p === route.path || p === route.path + '/') return { type: route.type };
    }
    return { type: 'other' };
}

const STATIC_META = {
    datasets: { path: '/datasets', title: 'Browse all Canadian datasets - CanQuery',
        description: 'Browse the complete Canadian open data catalogue: downloadable files, live tables and maps from federal, provincial and municipal publishers.' },
    home: { title: DEFAULT_TITLE, description: DEFAULT_DESC, path: '/' },
    insights: {
        title: 'Insights: Top 100 downloaded datasets - CanQuery',
        description:
            'The 100 most-downloaded datasets on open.canada.ca, loaded into CanQuery and turned into live charts you can explore.',
        path: '/insights',
    },
    organizations: {
        title: 'Organizations publishing Canadian open data - CanQuery',
        description:
            'Browse governments and public organizations publishing Canadian open data, ranked by how many datasets they have.',
        path: '/organizations',
    },
    places: {
        title: 'Canadian open data by place - CanQuery',
        description: 'Browse queryable and mappable open data for Canadian provinces, regions, and municipalities.',
        path: '/places',
    },
    docs: {
        title: 'Canadian open data API documentation - CanQuery',
        description:
            'Build with Canadian public data: working curl, Python and JavaScript examples, endpoint reference, pagination, preparation and error handling.',
        path: '/docs',
    },
    privacy: {
        title: 'Privacy and analytics - CanQuery',
        description:
            'How CanQuery uses anonymous, self-hosted product analytics, honors browser privacy signals, and protects visitor data.',
        path: '/privacy',
    },
    faq: {
        title: 'Frequently asked questions - CanQuery',
        description: 'Get answers about Canadian open data, supported tables and maps, file preparation and contacting CanQuery support.',
        path: '/faq',
    },
    about: {
        title: 'About CanQuery: search and explore Canadian open data',
        description: 'CanQuery is a free search engine for Canadian open data. Find government datasets by place or topic, explore live tables and maps, then open the source.',
        path: '/about',
    },
};

function buildWebsiteJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: SITE_URL + '/',
        description: DEFAULT_DESC,
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: SITE_URL + '/?q={search_term_string}',
            },
            'query-input': 'required name=search_term_string',
        },
    };
}

function buildOrganizationJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL + '/',
        logo: SITE_URL + '/android-chrome-512.png',
        sameAs: [REPO_URL, BLUESKY_URL],
    };
}

// schema.org/Dataset - the markup that makes a page eligible for Google
// Dataset Search. `dataset` is a row from getDatasetByIdOrName; `resources`
// is the listResourcesForDataset rows (optional; used for distributions).
function sourceForDataset(dataset) {
    const sources = Array.isArray(dataset.provenance_sources) ? dataset.provenance_sources : [];
    return sources.find(source => source.authoritative && source.license_url) ||
        sources.find(source => source.license_url) ||
        sources.find(source => source.authoritative) ||
        sources[0] || null;
}

function absoluteHttpUrl(value) {
    if (!value) return null;
    try {
        const resolved = new URL(toAbsoluteUrl(value));
        return resolved.protocol === 'http:' || resolved.protocol === 'https:'
            ? resolved.toString()
            : null;
    } catch {
        return null;
    }
}

// A DataDownload's format: the recorded one, else the file extension. A link
// with neither is a web page (often another catalogue's landing page), not a
// download, and is left out of the distribution list.
function downloadFormat(resource, contentUrl) {
    const recorded = plainText(resource.format);
    if (recorded) return recorded;
    const file = new URL(contentUrl).pathname.split('/').pop();
    const extension = /\.([a-z0-9]{2,7})$/i.exec(file);
    return extension && !/^(html?|aspx?|php|jsp)$/i.test(extension[1]) ? extension[1].toUpperCase() : '';
}

const humanFileSize = facts.humanFileSize;

// The long-form text for the Dataset schema: the publisher's notes, with
// generated facts added only when the notes are too short to stand alone.
function datasetDescription(dataset, resources, max = 5000) {
    const name = pick(dataset.title_en, dataset.title_fr) || 'This dataset';
    const notes = pick(dataset.notes_en, dataset.notes_fr);
    const org = pick(dataset.org_title_en, dataset.org_title_fr);
    const list = Array.isArray(resources) ? resources : [];
    const queryable = list.filter(resource => {
        const capability = classifyResource(resource).capability;
        return capability === 'datastore' || capability === 'ingested';
    }).length;
    const mapped = list.filter(resource => resource && (
        resource.map_provider || (resource.map && resource.map.available)
    )).length;
    const facts = [
        name + ' is an open dataset' + (org ? ' published by ' + org : ' available through CanQuery') + '.',
        list.length ? 'It contains ' + list.length + ' resource' + (list.length === 1 ? '' : 's') + '.' : '',
        queryable ? queryable + ' can be queried as a live table.' : '',
        mapped ? mapped + ' can be explored on a map.' : ''
    ].filter(Boolean).join(' ');
    let description = notes;
    if (description.length < DATASET_DESCRIPTION_MIN) {
        description = [description, facts].filter(Boolean).join(' ');
    }
    if (description.length < DATASET_DESCRIPTION_MIN) {
        description += ' Search and explore the public data on CanQuery.';
    }
    return truncate(description, max);
}

function buildDatasetJsonLd(dataset, resources) {
    const name = pick(dataset.title_en, dataset.title_fr) || 'Dataset';
    const slug = dataset.name || dataset.id;
    const url = SITE_URL + '/datasets/' + encodeURIComponent(slug);
    const description = datasetDescription(dataset, resources, 5000);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name,
        description,
        url,
        identifier: dataset.id,
        isAccessibleForFree: true,
    };
    const alternateName = plainText(dataset.title_fr);
    if (alternateName && alternateName.toLocaleLowerCase('fr-CA') !== name.toLocaleLowerCase('fr-CA')) {
        ld.alternateName = alternateName;
    }
    // Only records mirrored from the federal portal may fall back to its
    // landing page, licence and publisher; a municipal record states what its
    // own source recorded, or nothing.
    const source = sourceForDataset(dataset);
    const federalPortal = dataset.jurisdiction != null || Boolean(source && source.id === 'open-canada');
    const federalGovernment = dataset.jurisdiction === 'federal';
    if (source && source.license_url) ld.license = source.license_url;
    else if (federalGovernment) ld.license = 'https://open.canada.ca/en/open-government-licence-canada';
    if (source && source.landing_url) ld.sameAs = source.landing_url;
    else if (federalPortal) ld.sameAs = 'https://open.canada.ca/data/en/dataset/' + dataset.id;
    const keywords = []
        .concat(dataset.keywords_en || [], dataset.keywords_fr || [])
        .map(collapse)
        .filter(Boolean);
    if (keywords.length) ld.keywords = Array.from(new Set(keywords)).slice(0, 50);
    if (dataset.metadata_modified) {
        const d = new Date(dataset.metadata_modified);
        if (!Number.isNaN(d.getTime())) ld.dateModified = d.toISOString();
    }
    const org = pick(dataset.org_title_en, dataset.org_title_fr);
    if (org) {
        ld.creator = { '@type': 'Organization', name: org };
    }
    const publisher = source ? pick(source.name_en, source.name_fr) : federalGovernment ? 'Government of Canada' : '';
    if (publisher) ld.publisher = { '@type': 'Organization', name: publisher };
    const places = (Array.isArray(dataset.places) ? dataset.places : [])
        .map(place => pick(place.name_en, place.name_fr))
        .filter(Boolean);
    if (places.length) ld.spatialCoverage = Array.from(new Set(places));
    const distribution = [];
    for (const resource of resources || []) {
        if (distribution.length >= 25) break;
        const contentUrl = absoluteHttpUrl(resource && resource.url);
        if (!contentUrl) continue;
        const fmt = downloadFormat(resource, contentUrl);
        if (!fmt) continue;
        const dl = { '@type': 'DataDownload', contentUrl, encodingFormat: fmt };
        const resourceName = pick(resource.name_en, resource.name_fr);
        if (resourceName) dl.name = resourceName;
        const size = humanFileSize(resource.size_bytes);
        if (size) dl.contentSize = size;
        distribution.push(dl);
    }
    if (distribution.length) ld.distribution = distribution;
    return ld;
}

function homeMeta() {
    return {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESC,
        canonical: SITE_URL + '/',
        ogType: 'website',
        jsonLd: [buildWebsiteJsonLd(), buildOrganizationJsonLd()],
    };
}

// The about page answers "What is CanQuery?": an AboutPage whose subject is
// the same Organization the home page describes.
function aboutJsonLd(entry) {
    return [{
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: entry.title,
        description: entry.description,
        url: SITE_URL + entry.path,
        about: buildOrganizationJsonLd(),
    }, buildBreadcrumbJsonLd([{ name: 'CanQuery', path: '/' }, { name: 'About', path: entry.path }])];
}

function staticMeta(type, pathname) {
    if (type === 'home') return homeMeta();
    const override = pageOverride(type)?.meta;
    const entry = override || STATIC_META[type] || hostedRoute(type)?.meta;
    if (entry) {
        return {
            title: entry.title,
            description: entry.description,
            canonical: SITE_URL + entry.path,
            ogType: 'website',
            ...(entry.noindex ? {noindex:true} : {}),
            ...(type === 'about' && !override ? { jsonLd: aboutJsonLd(entry) } : {}),
        };
    }
    // Unknown route -> the SPA renders a not-found page; keep it out of the index.
    return {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESC,
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true,
    };
}

// The dataset <title> leads with what CanQuery adds ("table and 2 files") so
// the result reads differently from the publisher's own page. The publisher
// joins short titles, which are the ones several publishers tend to share. The
// phrase follows the whole name or its leading clause; a name that would have
// to be cut mid-phrase to make room for it is cut with the whole title room
// instead, and the phrase follows only if it still fits.
function datasetTitle(title, info) {
    const base = titleClause(title, TITLE_SOFT) || compactTitle(title, TITLE_HARD);
    const publisher = info.publisher && collapse(title).length < 25 ? ' (' + info.publisher + ')' : '';
    const phrase = facts.capabilityPhrase(info);
    const shortPhrase = facts.capabilityPhrase(info, { short: true });
    return fitTitleTiers([
        [
            phrase ? base + publisher + ': ' + phrase : '',
            shortPhrase ? base + publisher + ': ' + shortPhrase : '',
            phrase && publisher ? base + ': ' + phrase : '',
            shortPhrase && publisher ? base + ': ' + shortPhrase : ''
        ],
        [base + publisher, base]
    ]);
}

// The meta description states the facts a searcher compares results on: file
// count and formats, publisher, record date and what they can do here. Parts
// are dropped from the least to the most useful until the text fits.
function datasetSnippet(title, info) {
    // The title already heads the result; it opens the description only when
    // it fits whole, never as a cut-off fragment.
    const name = collapse(title).length <= 48 ? collapse(title) : '';
    const files = info.fileCount ? facts.formatCount(info.fileCount) + ' ' + facts.plural(info.fileCount, 'file') : '';
    const build = ({ withTitle, withFormats, withDate, withBilingual }) => {
        const titled = withTitle && name;
        const formats = withFormats && info.topFormats.length ? ' (' + info.topFormats.join(', ') + ')' : '';
        const from = info.publisher ? ' from ' + info.publisher : '';
        const updated = withDate && info.updated ? ', updated ' + info.updated : '';
        const record = titled ? 'catalogue record' : 'Catalogue record';
        const head = (titled ? name + ': ' : '') + (files ? files + formats : record) + from + updated + '.';
        const action = files
            ? facts.capabilitySentence(info) + ' on CanQuery.'
            : 'View metadata, publisher and licence on CanQuery.';
        const bilingual = withBilingual && info.bilingual ? ' Files in English and French.' : '';
        return head + ' ' + action + bilingual;
    };
    const attempts = [
        { withTitle: true, withFormats: true, withDate: true, withBilingual: true },
        { withTitle: true, withFormats: true, withDate: true, withBilingual: false },
        { withTitle: true, withFormats: false, withDate: true, withBilingual: false },
        { withTitle: false, withFormats: false, withDate: true, withBilingual: false },
        { withTitle: false, withFormats: false, withDate: false, withBilingual: false }
    ];
    for (const flags of attempts) {
        const text = build(flags);
        if (text.length <= DESCRIPTION_MAX) return text;
    }
    return truncate(build(attempts[attempts.length - 1]), DESCRIPTION_MAX);
}

// Page two onwards of a dataset's resource list describes that page, not the
// whole dataset, so the Dataset schema appears once, on the canonical page.
function buildDatasetPageJsonLd(dataset, resources, pageItems, page, datasetUrl) {
    const title = pick(dataset.title_en, dataset.title_fr) || 'Dataset';
    return {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title + ' (page ' + page + ')',
        url: datasetUrl + '?page=' + page,
        isPartOf: datasetUrl,
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: (resources || []).length,
            itemListElement: (pageItems || []).map((resource, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: resourceTitleBase({ ...resource, dataset_title_en: dataset.title_en, dataset_title_fr: dataset.title_fr }),
                url: SITE_URL + '/resources/' + encodeURIComponent(resource.id)
            }))
        }
    };
}

function datasetMeta(dataset, resources, { page = 1, pageItems = null } = {}) {
    const title = pick(dataset.title_en, dataset.title_fr) || 'Dataset';
    const info = facts.datasetFacts(dataset, resources);
    const slug = dataset.name || dataset.id;
    const datasetUrl = SITE_URL + '/datasets/' + encodeURIComponent(slug);
    const breadcrumb = buildBreadcrumbJsonLd([
        { name: 'Datasets', path: '/datasets' },
        { name: title, path: '/datasets/' + encodeURIComponent(slug) }
    ]);
    return {
        title: datasetTitle(title, info) + TITLE_SUFFIX,
        description: datasetSnippet(title, info),
        canonical: datasetUrl,
        ogType: 'website',
        jsonLd: page > 1
            ? [buildDatasetPageJsonLd(dataset, resources, pageItems, page, datasetUrl), breadcrumb]
            : [buildDatasetJsonLd(dataset, resources), breadcrumb],
    };
}

// The resource description names the subject, says what the file is and what
// a visitor can do with it on CanQuery, then the publisher and record date.
// Variants drop the publisher, the date, the size and the counts, in that
// order, until the text fits; only then is it truncated.
function resourceDescription(resource, { lang = 'en', max = DESCRIPTION_MAX } = {}) {
    const fr = lang === 'fr';
    const info = facts.resourceFacts(resource);
    const subject = resourceSubject(resource) || (fr ? 'données ouvertes' : 'open data');
    const languages = info.languages
        .map(code => (fr ? (code === 'fr' ? 'français' : 'anglais') : (code === 'fr' ? 'French' : 'English')))
        .join('/');
    const format = info.format;
    const size = facts.humanFileSize(resource.size_bytes, lang);
    const rows = info.rows != null ? facts.formatCount(info.rows, lang) : null;
    const fields = info.fields != null ? facts.formatCount(info.fields, lang) : null;
    const updated = facts.monthYear(resource.last_modified, lang);
    // A map alongside a table must survive every shortening step.
    const prefix = info.mapped && (info.table || info.loadable)
        ? (fr ? 'Explorez la carte interactive. ' : 'Explore the interactive map. ') : '';
    const build = ({ subject, withPublisher, withDate, withSize, withCounts }) => {
        const publisher = withPublisher ? info.publisher : '';
        const dated = withDate && updated ? updated : '';
        let from = '';
        if (publisher && dated) from = (fr ? ' Source : ' + publisher + ', mis à jour ' : ' From ' + publisher + ', updated ') + dated + '.';
        else if (publisher) from = (fr ? ' Source : ' : ' From ') + publisher + '.';
        else if (dated) from = (fr ? ' Mis à jour ' : ' Updated ') + dated + '.';
        const sized = withSize && size ? ' (' + size + ')' : '';
        let counts = '';
        if (withCounts && (rows || fields)) {
            counts = (fr ? ' avec ' : ' with ') + facts.joinList([
                rows ? rows + (fr ? ' lignes' : ' rows') : '',
                fields ? fields + (fr ? ' champs' : ' fields') : ''
            ], lang);
        }
        if (fr) {
            const langFr = languages ? ' (' + languages + ')' : '';
            const detail = [languages, withSize && size ? size : ''].filter(Boolean).join(', ');
            const detailed = detail ? ' (' + detail + ')' : '';
            if (info.table) return subject + ' : tableau ' + format + ' en direct' + langFr + counts + '. Filtrez, créez des graphiques et exportez jusqu’à 10 000 lignes en CSV.' + from;
            if (info.loadable) return subject + ' : fichier ' + format + detailed + ' à ouvrir comme tableau pour filtrer, créer des graphiques et exporter jusqu’à 10 000 lignes.' + from;
            if (info.mapped) return subject + ' : carte interactive sur CanQuery, plus le téléchargement original ' + format + sized + '.' + from;
            return subject + ' : fichier ' + format + detailed + '.' + from + ' Consultez les métadonnées, la licence et le téléchargement direct sur CanQuery.';
        }
        const langEn = languages ? languages + ' ' : '';
        if (info.table) return subject + ': live ' + langEn + format + ' table' + counts + '. Filter, chart and export up to 10,000 rows as CSV.' + from;
        if (info.loadable) return subject + ': ' + langEn + format + ' file' + sized + ' you can open as a table, filter, chart and export up to 10,000 rows.' + from;
        if (info.mapped) return subject + ': interactive map on CanQuery, plus the original ' + format + ' download' + sized + '.' + from;
        return subject + ': ' + langEn + format + ' file' + sized + '.' + from + ' View metadata, licence and the direct download on CanQuery.';
    };
    const steps = [
        { withPublisher: true, withDate: true, withSize: true, withCounts: true },
        { withPublisher: false, withDate: true, withSize: true, withCounts: true },
        { withPublisher: false, withDate: false, withSize: true, withCounts: true },
        { withPublisher: false, withDate: false, withSize: false, withCounts: true },
        { withPublisher: false, withDate: false, withSize: false, withCounts: false }
    ];
    // A long subject (a federal title repeated for every quarterly file) is
    // compacted before anything is cut mid-sentence.
    const subjects = [subject];
    if (subject.length > TITLE_SOFT) subjects.push(compactTitle(subject, TITLE_SOFT));
    for (const candidate of subjects) {
        for (const flags of steps) {
            const text = collapse(prefix + build({ subject: candidate, ...flags }));
            if (text.length <= max) return text;
        }
    }
    return truncate(prefix + build({ subject: subjects[subjects.length - 1], ...steps[steps.length - 1] }), max);
}

function buildResourceJsonLd(resource, description) {
    const name = resourceTitleBase(resource);
    const datasetSlug = resource.dataset_name || resource.dataset_id;
    const download = {
        '@type': 'DataDownload',
        name,
        encodingFormat: plainText(resource.format) || undefined,
        contentSize: humanFileSize(resource.size_bytes) || undefined,
        contentUrl: absoluteHttpUrl(resource.url) || undefined,
        // A nested Dataset must satisfy the full Dataset schema too. Reference
        // its canonical landing page, which owns the complete dataset metadata.
        isPartOf: datasetSlug ? SITE_URL + '/datasets/' + encodeURIComponent(datasetSlug) : undefined
    };
    for (const key of Object.keys(download)) {
        if (download[key] === undefined) delete download[key];
    }
    const source = sourceForDataset(resource);
    if (source && source.license_url) download.license = source.license_url;
    return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name,
        description,
        url: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        mainEntity: download
    };
}

// A download-only file's page repeats its dataset page with one link added, so
// it stays out of the index (its links are still followed); pages that offer
// a table or a map are indexed.
function resourceMeta(resource) {
    const name = resourceTitleBase(resource);
    const ds = pick(resource.dataset_title_en, resource.dataset_title_fr);
    const datasetSlug = resource.dataset_name || resource.dataset_id;
    const description = resourceDescription(resource);
    const downloadOnly = classifyResource(resource).capability === 'file-only';
    return {
        title: resourceTitle(resource),
        description,
        canonical: SITE_URL + '/resources/' + encodeURIComponent(resource.id),
        ogType: 'website',
        ...(downloadOnly ? { noindex: true } : {}),
        jsonLd: [buildResourceJsonLd(resource, description), buildBreadcrumbJsonLd([
            { name: 'Datasets', path: '/datasets' },
            datasetSlug && ds ? {
                name: ds,
                path: '/datasets/' + encodeURIComponent(datasetSlug)
            } : null,
            { name, path: '/resources/' + encodeURIComponent(resource.id) }
        ])]
    };
}

// A place's province or territory, so a title cannot be mistaken for another
// place of the same name.
function provinceOf(place) {
    const ancestors = Array.isArray(place.ancestors) ? place.ancestors : [];
    const province = ancestors.find(ancestor => ancestor && ancestor.id !== place.id &&
        ['province', 'territory'].includes(ancestor.kind));
    return province ? pick(province.name_en, province.name_fr) : '';
}

// One count from a shaped facet summary ({ total, facets: { group: [{ value, count }] } }).
function facetCount(facets, group, value) {
    const list = facets && facets.facets && Array.isArray(facets.facets[group]) ? facets.facets[group] : [];
    const entry = list.find(item => item && item.value === value);
    return entry ? Number(entry.count) || 0 : 0;
}

const PLACE_LEVELS = ['municipal', 'provincial', 'federal'];

function placeMeta(place, datasets = [], { queryable = null, facets = null } = {}) {
    const name = pick(place.name_en, place.name_fr) || 'Place';
    const type = pick(place.type_en, place.type_fr);
    const datasetCount = Number(place.dataset_count) || 0;
    const mapCount = Number(place.mappable_dataset_count) || 0;
    const liveTables = Number(queryable) || facetCount(facets, 'access', 'queryable');
    const levels = PLACE_LEVELS.map(level => [level, facetCount(facets, 'level', level)]).filter(([, count]) => count > 0);
    const province = ['region', 'municipality'].includes(place.kind) ? provinceOf(place) : '';
    const qualified = province ? name + ', ' + province : name;
    const n = facts.formatCount(datasetCount);
    const m = facts.formatCount(mapCount);
    const q = facts.formatCount(liveTables);
    const title = fitTitleTiers([
        [
            datasetCount && liveTables && mapCount ? qualified + ' open data: ' + n + ' datasets, ' + q + ' live tables and ' + m + ' maps' : '',
            datasetCount && mapCount ? qualified + ' open data: ' + n + ' datasets and ' + m + ' maps' : '',
            datasetCount ? qualified + ' open data: ' + n + ' ' + facts.plural(datasetCount, 'dataset') : ''
        ],
        [qualified + ' open data', name + ' open data']
    ]);
    const describe = ({ withType, withAction }) => n + ' open ' + facts.plural(datasetCount, 'dataset') + ' for ' + qualified +
        (withType && type ? ' (' + type + ')' : '') +
        (mapCount ? ': ' + m + ' with interactive maps' : '') +
        (liveTables ? (mapCount ? ', ' : ': ') + q + ' with live tables' : '') + '.' +
        (withAction ? ' Browse by publisher and format, preview tables and export CSV on CanQuery.' : '');
    // With counts by government level the description reads as the hub it is;
    // without them it falls back to the plain place summary.
    const access = [mapCount ? m + ' with maps' : '', liveTables ? q + ' with live tables' : ''].filter(Boolean).join(', ');
    const hubFacts = levels.length
        ? n + ' open ' + facts.plural(datasetCount, 'dataset') + ' for ' + qualified + ': ' +
            facts.joinList(levels.map(([level, count]) => facts.formatCount(count) + ' ' + level)) + (access ? '; ' + access : '') + '.'
        : '';
    const hubDescriptions = hubFacts ? [
        hubFacts + ' Publishers, portals, popular tables and guides on CanQuery.',
        hubFacts + ' Publishers, portals and guides on CanQuery.',
        hubFacts
    ] : [];
    const description = [...hubDescriptions, describe({ withType: true, withAction: true }), describe({ withType: false, withAction: true }),
        describe({ withType: false, withAction: false })]
        .find(text => text && text.length <= DESCRIPTION_MAX) ||
        truncate(describe({ withType: false, withAction: false }), DESCRIPTION_MAX);
    const slug = place.slug || place.id;
    const placePath = '/places/' + encodeURIComponent(slug);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'AdministrativeArea',
        name,
        url: SITE_URL + '/places/' + encodeURIComponent(slug),
        identifier: place.id
    };
    if (place.latitude != null && place.longitude != null) {
        ld.geo = {
            '@type': 'GeoCoordinates',
            latitude: Number(place.latitude),
            longitude: Number(place.longitude)
        };
    }
    const collection = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: name + ' open data',
        description: truncate(description, DESCRIPTION_MAX),
        url: SITE_URL + placePath,
        about: {
            '@type': 'AdministrativeArea',
            name,
            url: SITE_URL + placePath,
            identifier: place.id
        },
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: datasetCount,
            itemListElement: (datasets || []).slice(0, 12).map((dataset, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: pick(dataset.title_en, dataset.title_fr) || dataset.name || dataset.id,
                url: SITE_URL + '/datasets/' + encodeURIComponent(dataset.name || dataset.id)
            }))
        }
    };
    return {
        title: title + TITLE_SUFFIX,
        description,
        canonical: SITE_URL + placePath,
        ogType: 'website',
        noindex: datasetCount === 0 || place.enabled === false,
        jsonLd: [ld, collection, buildBreadcrumbJsonLd([
            { name: 'Places', path: '/places' },
            ...(Array.isArray(place.ancestors) ? place.ancestors.map(ancestor => ({
                name: pick(ancestor.name_en, ancestor.name_fr),
                path: '/places/' + encodeURIComponent(ancestor.slug || ancestor.id)
            })) : []),
            { name, path: placePath }
        ])]
    };
}

function organizationMeta(organization, datasets = []) {
    const name = pick(organization.title_en, organization.title_fr) || organization.name || 'Organization';
    const organizationPath = '/organizations/' + encodeURIComponent(organization.name);
    const total = Number(organization.dataset_count) || 0;
    const queryable = Number(organization.queryable_dataset_count) || 0;
    const mappable = Number(organization.mappable_dataset_count) || 0;
    const n = facts.formatCount(total);
    const title = fitTitleTiers([
        [
            total && queryable && mappable ? name + ': ' + n + ' open datasets, tables and maps' : '',
            total && (queryable || mappable) ? name + ': ' + n + ' open datasets and ' + (queryable ? 'tables' : 'maps') : '',
            total ? name + ': ' + n + ' open ' + facts.plural(total, 'dataset') : ''
        ],
        [name + ' open data']
    ]);
    const place = pick(organization.place_name_en, organization.place_name_fr);
    // The place hub matters more than the counts for a municipal publisher, so
    // the counts go first when the description must shrink.
    const describe = ({ withPlace, withCapabilities }) => name + ' publishes ' + n + ' open ' + facts.plural(total, 'dataset') +
        ' on CanQuery' + (withCapabilities && (queryable || mappable) ? ': ' + facts.joinList([
            queryable ? facts.formatCount(queryable) + ' with live tables' : '',
            mappable ? facts.formatCount(mappable) + ' with maps' : ''
        ]) : '') + '.' +
        (withPlace && place ? ' Part of ' + place + ' open data.' : '') +
        ' Preview tables, export CSV and follow original downloads.';
    const description = [{ withPlace: true, withCapabilities: true }, { withPlace: true, withCapabilities: false }, { withPlace: false, withCapabilities: false }]
        .map(describe).find(text => text.length <= DESCRIPTION_MAX) ||
        truncate(describe({ withPlace: false, withCapabilities: false }), DESCRIPTION_MAX);
    const items = (datasets || []).slice(0, 12).map((dataset, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: pick(dataset.title_en, dataset.title_fr) || dataset.name || dataset.id,
        url: SITE_URL + '/datasets/' + encodeURIComponent(dataset.name || dataset.id)
    }));
    const collection = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: name + ' open data',
        description,
        url: SITE_URL + organizationPath,
        about: {
            '@type': organizationType(organization),
            name,
            identifier: organization.id
        },
        mainEntity: {
            '@type': 'ItemList',
            numberOfItems: total,
            itemListElement: items
        }
    };
    return {
        title: title + TITLE_SUFFIX,
        description,
        canonical: SITE_URL + organizationPath,
        ogType: 'website',
        noindex: total === 0,
        jsonLd: [collection, buildBreadcrumbJsonLd([
            { name: 'Organizations', path: '/organizations' },
            { name, path: organizationPath }
        ])]
    };
}

function notFoundMeta(pathname) {
    return {
        title: 'Not found - CanQuery',
        description: DEFAULT_DESC,
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true,
    };
}

function serviceUnavailableMeta(pathname) {
    return {
        title: 'Temporarily unavailable - CanQuery',
        description: 'This CanQuery page is temporarily unavailable. Please try again shortly.',
        canonical: canonicalFor(pathname),
        ogType: 'website',
        noindex: true
    };
}

// Build the managed <head> tag list for a resolved meta object.
function buildManagedTags(meta) {
    const title = escapeHtml(meta.title || DEFAULT_TITLE);
    const description = escapeHtml(meta.description || DEFAULT_DESC);
    const url = escapeHtml(meta.canonical || SITE_URL + '/');
    const image = escapeHtml(meta.image || DEFAULT_IMAGE);
    const ogType = escapeHtml(meta.ogType || 'website');
    const tags = [];
    if (meta.noindex) tags.push('<meta name="robots" content="noindex, follow" />');
    tags.push('<title>' + title + '</title>');
    tags.push('<meta name="description" content="' + description + '" />');
    tags.push('<link rel="canonical" href="' + url + '" />');
    for (const [language, href] of Object.entries(meta.alternates || {})) {
        tags.push('<link rel="alternate" hreflang="' + escapeHtml(language) + '" href="' + escapeHtml(href) + '" />');
    }
    if (meta.lang) tags.push('<meta property="og:locale" content="' + (meta.lang === 'fr' ? 'fr_CA' : 'en_CA') + '" />');
    tags.push('<meta property="og:title" content="' + title + '" />');
    tags.push('<meta property="og:description" content="' + description + '" />');
    tags.push('<meta property="og:type" content="' + ogType + '" />');
    tags.push('<meta property="og:url" content="' + url + '" />');
    tags.push('<meta property="og:site_name" content="CanQuery" />');
    tags.push('<meta property="og:image" content="' + image + '" />');
    if (!meta.image) {
        tags.push('<meta property="og:image:width" content="1200" />');
        tags.push('<meta property="og:image:height" content="630" />');
        tags.push('<meta property="og:image:alt" content="' + escapeHtml(DEFAULT_IMAGE_ALT) + '" />');
    }
    tags.push('<meta name="twitter:card" content="summary_large_image" />');
    tags.push('<meta name="twitter:title" content="' + title + '" />');
    tags.push('<meta name="twitter:description" content="' + description + '" />');
    tags.push('<meta name="twitter:image" content="' + image + '" />');
    if (!meta.image) tags.push('<meta name="twitter:image:alt" content="' + escapeHtml(DEFAULT_IMAGE_ALT) + '" />');
    for (const obj of meta.jsonLd || []) tags.push(jsonLdScript(obj));
    return tags;
}

// Replace the <!-- seo:start --> ... <!-- seo:end --> block in the SPA
// template with freshly built tags. If the markers are absent (template
// changed), return the template untouched - serving valid default HTML.
function renderHtml(template, meta, bodyHtml = '') {
    const re = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
    let html = meta.lang ? template.replace(/<html\b[^>]*>/, '<html lang="' + escapeHtml(meta.lang) + '">') : template;
    if (re.test(html)) {
        const block = buildManagedTags(meta)
            .map((line) => '    ' + line)
            .join('\n');
        // The replacement must be a function: a string replacement interprets
        // $&, $', $` and $$ as substitution patterns, and catalogue text can
        // otherwise re-inject the matched block.
        html = html.replace(re, () => '<!-- seo:start -->\n' + block + '\n    <!-- seo:end -->');
    }
    if (bodyHtml && /<div id="root">\s*<\/div>/.test(html)) {
        html = html.replace(
            /<div id="root">\s*<\/div>/,
            () => '<div id="root">' + bodyHtml + '</div>'
        );
    }
    return html;
}

module.exports = {
    SITE_URL,
    SITE_NAME,
    DEFAULT_TITLE,
    DEFAULT_DESC,
    escapeHtml,
    jsonScript,
    jsonLdScript,
    plainText,
    truncate,
    classifyRoute,
    canonicalFor,
    buildWebsiteJsonLd,
    buildOrganizationJsonLd,
    buildDatasetJsonLd,
    datasetDescription,
    buildBreadcrumbJsonLd,
    isGenericResourceName,
    resourceTitleBase,
    resourceTitle,
    resourceDescription,
    siteTitle,
    compactTitle,
    fitTitle,
    fitTitleTiers,
    pagedMeta,
    organizationType,
    datasetSnippet,
    facetCount,
    homeMeta,
    staticMeta,
    datasetMeta,
    resourceMeta,
    placeMeta,
    organizationMeta,
    notFoundMeta,
    serviceUnavailableMeta,
    buildManagedTags,
    renderHtml,
};
