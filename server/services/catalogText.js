const MarkdownIt = require('markdown-it');

const markdown = new MarkdownIt({ html: false, linkify: false });
const collapse = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

// Use Markdown's parsed text, never rendered HTML, in snippets and API summaries.
// Link destinations and formatting disappear; their readable labels remain.
function plainText(value) {
    const source = String(value == null ? '' : value)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
        .replace(/<br\s*\/?\s*>|<\/(?:div|h[1-6]|li|p|section|td|th)>/gi, ' ')
        .replace(/<[^>]*>/g, ' ');
    const read = tokens => tokens.map(token => {
        if (token.children) return read(token.children);
        if (['text', 'code_inline', 'code_block', 'fence'].includes(token.type)) return token.content;
        if (['softbreak', 'hardbreak'].includes(token.type) || token.block) return ' ';
        return '';
    }).join('');
    return collapse(read(markdown.parse(source, {})));
}

function truncate(value, max) {
    const text = collapse(value);
    if (text.length <= max) return text;
    return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function resourceLanguages(resource) {
    const values = Array.isArray(resource.language) ? resource.language : [resource.language];
    const codes = values.map(value => String(value || '').toLowerCase());
    return ['en', 'fr'].filter(lang => codes.some(code =>
        (lang === 'en' ? /^(en(?:[-_]ca)?|eng|english)$/ : /^(fr(?:[-_]ca)?|fra|fre|french|français)$/).test(code)
    ));
}

module.exports = { plainText, collapse, truncate, resourceLanguages };
