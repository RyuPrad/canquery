const parameters = names => names.map(name=>({name,in:'query',schema:{type:'string'}}));
const responses = {
    200:{description:'Successful response. JSON endpoints use data, pagination and meta.'},
    400:{description:'Invalid request'},401:{description:'Missing, invalid or revoked API key'},
    403:{description:'Account or key disabled'},404:{description:'Not found'},
    409:{description:'Preparation required or resource conflict'},422:{description:'Unsupported resource'},
    429:{description:'Credit, rate, concurrency, preparation capacity or cooldown limit. Honor Retry-After.'},
    503:{description:'Temporary service or accounting unavailability'}
};
const paths = {};
function add(path,method,summary,credits,query=[]) {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map(match=>({name:match[1],in:'path',required:true,schema:{type:'string'}}));
    paths[path] ||= {};
    paths[path][method]={summary,description:`Credit cost: ${credits}. Publisher availability and documented endpoint bounds apply.`,
        parameters:[...params,...parameters(query)],responses};
}
add('/datasets','get','Search the catalogue',1,['q','org','format','keyword','place','source','mappable','limit','cursor']);
add('/datasets/{idOrName}','get','Dataset metadata',1);
for (const type of ['organizations','places','sources']) {
    add('/'+type,'get','List '+type,1,type==='places' ? ['q','kind','parent','featured','limit','cursor'] : type==='sources' ? ['place'] : ['q','place','source','limit','cursor']);
}
add('/organizations/{name}','get','Publisher metadata',1);
add('/places/{idOrSlug}','get','Place and geographical coverage',1);
add('/resources/recently-unlocked','get','Recently prepared resources',1,['place','limit']);
add('/resources/popular','get','Popular resources',1,['place','days','limit']);
add('/resources/{id}','get','Resource metadata and capabilities',1);
const filters=['q','filters','sort','group_by','agg','agg_column','bucket'];
add('/resources/{id}/query','get','Query rows or aggregate a complete local snapshot','1; aggregation costs 10',[...filters,'limit','offset']);
add('/resources/{id}/query.csv','get','Export at most 10,000 rows',25,filters);
paths['/resources/{id}/query.csv'].get.responses={...responses,200:{description:'CSV attachment; interrupted exports are refunded.',content:{'text/csv':{schema:{type:'string'}}}}};
add('/resources/{id}/profile','get','Whole-file profile',10);
add('/resources/{id}/map','get','Bounded GeoJSON viewport',10,['bbox','zoom','limit']);
paths['/resources/{id}/map'].get.parameters.find(p=>p.name==='bbox').required=true;
add('/resources/{id}/map/tiles/{version}/{z}/{x}/{y}.pbf','get','One vector tile',1);
paths['/resources/{id}/map/tiles/{version}/{z}/{x}/{y}.pbf'].get.responses={...responses,200:{description:'Vector tile',content:{'application/x-protobuf':{schema:{type:'string',format:'binary'}}}},204:{description:'No tile'}};
for (const endpoint of ['prepare','ingest']) {
    add('/resources/{id}/'+endpoint,'post','Prepare an eligible file','100 only for a newly admitted job; existing/shared work is free');
    paths['/resources/{id}/'+endpoint].post.responses={...responses,202:{description:'New or shared preparation job'}};
}
add('/resources/{id}/activity','post','Renew a prepared copy',0);
paths['/resources/{id}/activity'].post.responses={...responses,204:{description:'Activity recorded'}};
add('/jobs/{id}','get','Preparation job status',0);
add('/stats','get','Catalogue statistics',1);
add('/insights/top-downloads','get','Publisher download leaderboard',1,['lang']);
add('/insights/featured','get','Featured prepared-data previews',10,['lang']);
add('/blog','get','Published guides',1,['lang','place','dataset']);
add('/blog/{lang}/{slug}','get','Published guide edition',1);
add('/repo','get','Public repository metadata',1);
add('/ops','get','Operational status',0);
paths['/ops'].get.security=[];
module.exports={openapi:'3.1.0',info:{title:'CanQuery API',version:'1.0.0',description:'Canadian open-data discovery and bounded tables/maps. Use a server-side API key. Free allowances follow UTC months; Business follows confirmed paid periods. Successful cached requests count. No automatic overages.',contact:{email:'support@canquery.com'}},
    servers:[{url:'/api/v1'}],security:[{bearerAuth:[]}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'CanQuery API key'}}},paths};
