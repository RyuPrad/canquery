const AppError = require('../utils/AppError');
const errorHandler = require('../middleware/errorHandler');
const requestId = require('../middleware/requestId');

function responseDouble() {
    const res = {
        status: jest.fn(),
        json: jest.fn()
    };
    res.status.mockReturnValue(res);
    return res;
}

describe('production error handling', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
        console.error.mockRestore();
    });

    it('hides unexpected exception details and returns a request id', () => {
        const req = { id: 'request-123', method: 'GET', path: '/api/private' };
        const res = responseDouble();

        errorHandler(new Error('password=secret at /srv/internal/file.js'), req, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error', request_id: 'request-123' });
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('request-123'));
    });

    it('preserves intentional AppError messages and safe metadata', () => {
        const req = { id: 'request-456', method: 'GET', path: '/api/resource' };
        const res = responseDouble();
        const err = new AppError('Resource is not ingested yet', 409);
        err.hint = 'POST /ingest';

        errorHandler(err, req, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Resource is not ingested yet',
            hint: 'POST /ingest',
            request_id: 'request-456'
        });
    });

    it('delegates failures after a streaming response has already started', () => {
        const req = { id: 'request-stream', method: 'GET', path: '/api/export.csv' };
        const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
        const next = jest.fn();
        const err = new Error('socket failed');

        errorHandler(err, req, res, next);

        expect(next).toHaveBeenCalledWith(err);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});

describe('requestId middleware', () => {
    it('generates its own UUID and returns it as a response header', () => {
        const req = { headers: { 'x-request-id': 'caller-controlled' } };
        const res = { setHeader: jest.fn() };
        const next = jest.fn();

        requestId(req, res, next);

        expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(req.id).not.toBe('caller-controlled');
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
