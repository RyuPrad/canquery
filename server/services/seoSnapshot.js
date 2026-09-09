const seo = require('./seoMeta');
const { classifyResource } = require('./resourceCapabilities');

const MAX_LINKS = 12;
const MAX_SUMMARY = 1200;

function text(value) {
    return seo.escapeHtml(seo.plainText(value));
}

function pathLink(path, label) {
    const cleanLabel = seo.plainText(label);
    if (!path || !cleanLabel) return '';
    return '<a href="' + seo.escapeHtml(path) + '">' + seo.escapeHtml(cleanLabel) + '</a>';
}

function breadcrumb(items) {
    const entries = (items || []).filter(item => item && item.label);
    if (!entries.length) return '';
    return '<nav aria-label="Breadcrumb"><ol>' + entries.map((item, index) => {
        const content = item.path && index < entries.length - 1
            ? pathLink(item.path, item.label)
            : '<span aria-current="page">' + text(item.label) + '</span>';
        return '<li>' + content + '</li>';
    }).join('') + '</ol></nav>';
}

function factList(facts) {
    const entries = (facts || []).filter(fact => fact && fact.value !== null && fact.value !== undefined && fact.value !== '');
    if (!entries.length) return '';
    return '<dl>' + entries.map(fact => '<div><dt>' + text(fact.label) + '</dt><dd>' + text(fact.value) +
        '</dd></div>').join('') + '</dl>';
}

function linkList(title, links) {
    const entries = (links || []).filter(link => link && link.path && link.label).slice(0, MAX_LINKS);
    if (!entries.length) return '';
    return '<section><h2>' + text(title) + '</h2><ul>' + entries.map(link =>
        '<li>' + pathLink(link.path, link.label) + (link.detail ? ' <span>' + text(link.detail) + '</span>' : '') + '</li>'
    ).join('') + '</ul></section>';
}

function shell({ breadcrumbs, title, summary, facts, linksTitle, links, relatedLinks }) {
    return '<main class="cq-seo-snapshot max-w-5xl mx-auto px-4 py-8" data-cq-seo-snapshot="true">' +
        breadcrumb(breadcrumbs) + '<article><h1>' + text(title) + '</h1>' +
        (summary ? '<p>' + text(seo.truncate(summary, MAX_SUMMARY)) + '</p>' : '') +
        factList(facts) + linkList(linksTitle, links) +
        linkList('Related open data', relatedLinks) + '</article></main>';
}

function datasetSnapshot(dataset, resources) {
    const title = seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id;
    const organization = seo.plainText(dataset.org_title_en) || seo.plainText(dataset.org_title_fr);
    const links = (resources || []).slice(0, MAX_LINKS).map(resource => ({
        path: '/resources/' + encodeURIComponent(resource.id),
        label: seo.plainText(resource.name_en) || seo.plainText(resource.name_fr) || resource.format || resource.id,
        detail: resource.format || classifyResource(resource).capability
    }));
    const placeLinks = (Array.isArray(dataset.places) ? dataset.places : []).map(place => ({
        path: '/places/' + encodeURIComponent(place.slug || place.id),
        label: seo.plainText(place.name_en) || seo.plainText(place.name_fr) || place.slug
    }));
    const organizationLinks = organization && dataset.org_name ? [{
        path: '/organizations/' + encodeURIComponent(dataset.org_name),
        label: organization
    }] : [];
    return shell({
        breadcrumbs: [{ label: 'Datasets', path: '/' }, { label: title }],
        title,
        summary: seo.datasetDescription(dataset, resources, MAX_SUMMARY),
        facts: [
            organization ? {
                label: 'Publisher',
                value: organization
            } : null,
            { label: 'Resources', value: (resources || []).length },
            dataset.metadata_modified ? {
                label: 'Updated',
                value: new Date(dataset.metadata_modified).toLocaleDateString('en-CA')
            } : null
        ],
        linksTitle: 'Resources',
        links,
        relatedLinks: organizationLinks.concat(placeLinks)
    });
}

function resourceSnapshot(resource) {
    const name = seo.plainText(resource.name_en) || seo.plainText(resource.name_fr) || resource.id;
    const datasetName = seo.plainText(resource.dataset_title_en) || seo.plainText(resource.dataset_title_fr) || resource.dataset_name || resource.dataset_id;
    const datasetSlug = resource.dataset_name || resource.dataset_id;
    const organization = seo.plainText(resource.org_title_en) || seo.plainText(resource.org_title_fr);
    const capability = classifyResource(resource).capability;
    const links = [];
    if (organization && resource.org_name) {
        links.push({ path: '/organizations/' + encodeURIComponent(resource.org_name), label: organization });
    }
    for (const place of Array.isArray(resource.places) ? resource.places : []) {
        links.push({
            path: '/places/' + encodeURIComponent(place.slug || place.id),
            label: seo.plainText(place.name_en) || seo.plainText(place.name_fr) || place.slug
        });
    }
    return shell({
        breadcrumbs: [
            { label: 'Datasets', path: '/' },
            { label: datasetName, path: '/datasets/' + encodeURIComponent(datasetSlug) },
            { label: name }
        ],
        title: name,
        summary: seo.resourceDescription(resource),
        facts: [
            { label: 'Format', value: resource.format || 'File' },
            { label: 'Access', value: capability },
            resource.size_bytes ? { label: 'Size', value: Number(resource.size_bytes).toLocaleString('en-CA') + ' bytes' } : null,
            resource.last_modified ? { label: 'Updated', value: new Date(resource.last_modified).toLocaleDateString('en-CA') } : null
        ],
        linksTitle: 'Related open data',
        links
    });
}

function placeSnapshot(place, datasets) {
    const name = seo.plainText(place.name_en) || seo.plainText(place.name_fr) || place.slug || place.id;
    const ancestors = (Array.isArray(place.ancestors) ? place.ancestors : [])
        .filter(ancestor => ancestor.id !== place.id)
        .map(ancestor => ({
            label: seo.plainText(ancestor.name_en) || seo.plainText(ancestor.name_fr),
            path: '/places/' + encodeURIComponent(ancestor.slug || ancestor.id)
        }));
    const datasetLinks = (datasets || []).map(dataset => ({
        path: '/datasets/' + encodeURIComponent(dataset.name || dataset.id),
        label: seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id
    }));
    const childLinks = (Array.isArray(place.children) ? place.children : []).map(child => ({
        path: '/places/' + encodeURIComponent(child.slug || child.id),
        label: seo.plainText(child.name_en) || seo.plainText(child.name_fr) || child.slug,
        detail: Number(child.dataset_count || 0).toLocaleString('en-CA') + ' datasets'
    }));
    const count = Number(place.dataset_count) || 0;
    const maps = Number(place.mappable_dataset_count) || 0;
    return shell({
        breadcrumbs: [{ label: 'Places', path: '/places' }, ...ancestors, { label: name }],
        title: name + ' open data',
        summary: 'Explore ' + count.toLocaleString('en-CA') + ' open dataset' + (count === 1 ? '' : 's') +
            ' for ' + name + (maps ? ', including ' + maps.toLocaleString('en-CA') + ' with interactive maps.' : '.'),
        facts: [
            { label: 'Datasets', value: count },
            { label: 'Direct datasets', value: Number(place.direct_dataset_count) || 0 },
            { label: 'Mappable datasets', value: maps }
        ],
        linksTitle: datasetLinks.length ? 'Open datasets' : 'Places in this area',
        links: datasetLinks.length ? datasetLinks : childLinks
    });
}

function organizationSnapshot(organization, datasets) {
    const name = seo.plainText(organization.title_en) || seo.plainText(organization.title_fr) || organization.name;
    const links = (datasets || []).map(dataset => ({
        path: '/datasets/' + encodeURIComponent(dataset.name || dataset.id),
        label: seo.plainText(dataset.title_en) || seo.plainText(dataset.title_fr) || dataset.name || dataset.id
    }));
    const relatedLinks = [];
    if (organization.place_id) {
        relatedLinks.push({
            path: '/places/' + encodeURIComponent(organization.place_slug || organization.place_id),
            label: seo.plainText(organization.place_name_en) || seo.plainText(organization.place_name_fr) || organization.place_slug
        });
    }
    const total = Number(organization.dataset_count) || 0;
    return shell({
        breadcrumbs: [{ label: 'Organizations', path: '/organizations' }, { label: name }],
        title: name + ' open data',
        summary: 'Browse ' + total.toLocaleString('en-CA') + ' open dataset' + (total === 1 ? '' : 's') +
            ' published by ' + name + ' and mirrored by CanQuery.',
        facts: [
            { label: 'Datasets', value: total },
            { label: 'Queryable datasets', value: Number(organization.queryable_dataset_count) || 0 },
            { label: 'Mappable datasets', value: Number(organization.mappable_dataset_count) || 0 }
        ],
        linksTitle: 'Open datasets',
        links,
        relatedLinks
    });
}

const STATIC_COPY = {
    home: {
        title: "Search Canada's open data",
        summary: 'Find federal, provincial, territorial and municipal datasets, query live tables, and explore spatial resources on maps.',
        links: [
            { path: '/places', label: 'Browse open data by place' },
            { path: '/organizations', label: 'Browse publishing organizations' },
            { path: '/insights', label: 'Explore popular dataset insights' },
            { path: '/docs', label: 'Use the CanQuery API' }
        ]
    },
    insights: {
        title: 'Top downloaded Canadian datasets',
        summary: 'Explore live charts built from the most-downloaded datasets in the CanQuery catalogue.',
        links: [{ path: '/', label: 'Search all datasets' }]
    },
    organizations: {
        title: 'Organizations publishing Canadian open data',
        summary: 'Browse public-sector organizations and the datasets they publish through CanQuery.'
    },
    places: {
        title: 'Canadian open data by place',
        summary: 'Browse open datasets for provinces, territories, regions and municipalities across Canada.'
    },
    docs: {
        title: 'CanQuery API documentation',
        summary: 'Use the anonymous JSON API to search datasets, query tables, export filtered data and request map features.',
        links: [{ path: '/', label: 'Search the catalogue' }]
    },
    privacy: {
        title: 'Privacy and analytics',
        summary: 'Learn how CanQuery uses cookie-free, self-hosted analytics and honors browser privacy signals.',
        links: [{ path: '/', label: 'Return to CanQuery' }]
    }
};

function staticSnapshot(type, items = []) {
    const copy = STATIC_COPY[type] || STATIC_COPY.home;
    const dynamicLinks = items.map(item => {
        if (type === 'organizations') {
            return {
                path: '/organizations/' + encodeURIComponent(item.name),
                label: seo.plainText(item.title_en) || seo.plainText(item.title_fr) || item.name,
                detail: Number(item.dataset_count || 0).toLocaleString('en-CA') + ' datasets'
            };
        }
        if (type === 'places') {
            return {
                path: '/places/' + encodeURIComponent(item.slug || item.id),
                label: seo.plainText(item.name_en) || seo.plainText(item.name_fr) || item.slug,
                detail: Number(item.dataset_count || 0).toLocaleString('en-CA') + ' datasets'
            };
        }
        return null;
    }).filter(Boolean);
    return shell({
        breadcrumbs: type === 'home' ? [] : [{ label: 'CanQuery', path: '/' }, { label: copy.title }],
        title: copy.title,
        summary: copy.summary,
        linksTitle: dynamicLinks.length ? (type === 'places' ? 'Featured places' : 'Publishing organizations') : 'Explore CanQuery',
        links: dynamicLinks.length ? dynamicLinks : copy.links
    });
}

function errorSnapshot(title, summary) {
    return shell({
        breadcrumbs: [{ label: 'CanQuery', path: '/' }, { label: title }],
        title,
        summary,
        linksTitle: 'Continue',
        links: [{ path: '/', label: 'Return to dataset search' }]
    });
}

module.exports = {
    MAX_LINKS,
    MAX_SUMMARY,
    datasetSnapshot,
    resourceSnapshot,
    placeSnapshot,
    organizationSnapshot,
    staticSnapshot,
    errorSnapshot
};
