jest.mock('../services/authRuntime', () => ({
    authHandler: (req,res) => res.json({ body:req.body ?? null }),
    requireOwner: (_req,_res,next) => next()
}));
jest.mock('../services/billingService', () => ({
    receiveWebhook: jest.fn(), checkout: jest.fn(), portal: jest.fn()
}));

const request = require('supertest');
const http = require('node:http');
const { once } = require('node:events');
const app = require('../app');

test('auth accepts bounded JSON and form bodies', async () => {
    const json = await request(app).post('/api/auth/ok').send({ fixture:'json' });
    expect(json.status).toBe(200);
    expect(json.body.body).toEqual({ fixture:'json' });

    const form = await request(app).post('/api/auth/ok')
        .type('form').send({ fixture:'form' });
    expect(form.status).toBe(200);
    expect(form.body.body).toEqual({ fixture:'form' });
});

test('auth rejects unsupported media types before its handler', async () => {
    const response = await request(app).post('/api/auth/ok')
        .set('Content-Type','application/octet-stream').send('fixture');
    expect(response.status).toBe(415);
    expect(response.body.error).toBe('Authentication requests require JSON or form data');
});

test('auth rejects oversized chunked JSON before its handler', async () => {
    const server = app.listen(0,'127.0.0.1');
    try {
        await once(server,'listening');
        const result = await new Promise((resolve,reject) => {
            const outbound = http.request({
                host:'127.0.0.1', port:server.address().port, path:'/api/auth/ok', method:'POST',
                headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}
            }, response => {
                const chunks = [];
                response.on('data',chunk => chunks.push(chunk));
                response.on('end',() => resolve({
                    status:response.statusCode,
                    body:JSON.parse(Buffer.concat(chunks).toString('utf8'))
                }));
            });
            outbound.on('error',reject);
            outbound.write('{"value":"');
            outbound.write('x'.repeat(70 * 1024));
            outbound.end('"}');
        });
        expect(result.status).toBe(413);
        expect(result.body.error).toBe('Invalid request');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
