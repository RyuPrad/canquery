const fs = require('fs');
const path = require('path');
const seoMeta = require('../services/seoMeta');
const catalogRead = require('../db/catalogReadQueries');

// The built index.html is immutable for the life of the process (a deploy
// restarts the API), so read it once and reuse.
let templateCache = null;
function loadTemplate(distDir) {
    if (templateCache == null) {
        templateCache = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    }
    return templateCache;
}

// Map a request path to a resolved meta object, fetching dataset/resource rows
// as needed. `deps` is injected for testing; defaults to the real DB layer.
async function resolveMeta(reqPath, deps = catalogRead) {
    const route = seoMeta.classifyRoute(reqPath);
    if (route.type === 'dataset') {
        const dataset = await deps.getDatasetByIdOrName(route.id);
        if (!dataset) return seoMeta.notFoundMeta(reqPath);
        const resources = await deps.listResourcesForDataset(dataset.id);
        return seoMeta.datasetMeta(dataset, resources);
    }
    if (route.type === 'resource') {
        const resource = await deps.getResourceById(route.id);
        if (!resource) return seoMeta.notFoundMeta(reqPath);
        return seoMeta.resourceMeta(resource);
    }
    return seoMeta.staticMeta(route.type, reqPath);
}

// Catch-all SPA handler: inject per-route SEO <head> into the template. Any
// failure (DB down, bad row) falls back to the untouched template so a page is
// always served.
function serveSpa(distDir) {
    return async (req, res) => {
        const template = loadTemplate(distDir);
        let html = template;
        try {
            const meta = await resolveMeta(req.path);
            html = seoMeta.renderHtml(template, meta);
        } catch {
            // SEO is best-effort: on any failure serve the untouched template.
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        // HTML is revalidated each load so a new deploy (and its hashed asset
        // refs) propagates immediately; the hashed assets themselves cache for a year.
        res.set('Cache-Control', 'public, max-age=0, must-revalidate');
        res.send(html);
    };
}

module.exports = { serveSpa, resolveMeta, loadTemplate };
