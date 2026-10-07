const { CREDIT_COSTS } = require('./commercialConfig');

function operationPath(req) {
    // Express routes are case-insensitive and accept one trailing slash. Match
    // those aliases for billing without changing publisher IDs or query fields.
    return req.path.toLowerCase().replace(/\/$/, '');
}

function isPublicOperation(req) {
    return ['GET', 'HEAD'].includes(req.method) && ['/ops', '/openapi.json'].includes(operationPath(req));
}

function operationFor(req) {
    const path = operationPath(req);
    if (/^\/jobs\/[^/]+$/.test(path) || /\/activity$/.test(path)) return {name:'activity',cost:CREDIT_COSTS.activity};
    if (/\/(prepare|ingest)$/.test(path)) return {name:'preparation',cost:CREDIT_COSTS.activity,
        ...(/\/ingest$/.test(path) ? {bucket:'ingest',rate:5,seconds:3600} : {})};
    if (/\/query\.csv$/.test(path)) return {name:'export',cost:CREDIT_COSTS.export,expensive:true,bucket:'export',rate:10};
    if (/\/profile$/.test(path)) return {name:'profile',cost:CREDIT_COSTS.profile,expensive:true,bucket:'profile',rate:20};
    if (/\/map$/.test(path)) return {name:'map',cost:CREDIT_COSTS.map,expensive:true,bucket:'map',rate:60};
    if (/\/map\/tiles\//.test(path)) return {name:'tile',cost:CREDIT_COSTS.tile,bucket:'tile',rate:240};
    if (path === '/insights/featured') return {name:'featured',cost:CREDIT_COSTS.featured,expensive:true};
    if (/\/query$/.test(path) && ['group_by','agg','agg_column','bucket'].some(k=>req.query[k] !== undefined && req.query[k] !== '')) {
        return {name:'aggregate',cost:CREDIT_COSTS.aggregate,expensive:true,bucket:'aggregate',rate:30};
    }
    const name = /\/query$/.test(path) ? 'query' : 'metadata';
    return {name,cost:CREDIT_COSTS[name]};
}
module.exports = { operationFor, isPublicOperation };
