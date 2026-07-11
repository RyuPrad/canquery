const mockPool = jest.fn(() => ({ on: jest.fn() }));

jest.mock('pg', () => ({ Pool: mockPool }));

const { createPool } = require('../db/poolFactory');

describe('poolFactory', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.DB_POOL_MAX;
        delete process.env.DB_LONG_POOL_MAX;
        delete process.env.DB_CONNECTION_TIMEOUT_MS;
        delete process.env.DB_IDLE_TIMEOUT_MS;
        delete process.env.DB_STATEMENT_TIMEOUT_MS;
        delete process.env.DB_QUERY_TIMEOUT_MS;
        delete process.env.DB_LONG_STATEMENT_TIMEOUT_MS;
        delete process.env.DB_LONG_QUERY_TIMEOUT_MS;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('bounds API pool acquisition and query execution by default', () => {
        createPool();

        expect(mockPool).toHaveBeenCalledWith(expect.objectContaining({
            max: 10,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            statement_timeout: 30000,
            query_timeout: 35000,
            application_name: 'canquery-api'
        }));
    });

    it('uses a small pool with generous finite limits for long-running ingest work', () => {
        createPool({ longRunning: true });

        expect(mockPool).toHaveBeenCalledWith(expect.objectContaining({
            max: 2,
            connectionTimeoutMillis: 5000,
            statement_timeout: 1800000,
            query_timeout: 1860000,
            application_name: 'canquery-long-running'
        }));
    });

    it('fails fast on invalid timeout configuration', () => {
        process.env.DB_QUERY_TIMEOUT_MS = 'not-a-number';
        expect(() => createPool()).toThrow(/DB_QUERY_TIMEOUT_MS/);
    });

    it('rejects an API pool too small for worker coordination connections', () => {
        process.env.DB_POOL_MAX = '3';
        expect(() => createPool()).toThrow(/DB_POOL_MAX.*4/);
    });
});
