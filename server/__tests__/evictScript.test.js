jest.mock('../db/pool', () => ({}));
jest.mock('../services/retiredIngestTables', () => ({ cleanRetiredTables: jest.fn() }));
jest.mock('../services/evictService', () => ({ withStoreBudgetLock: jest.fn(), evictUntilUnderBudget: jest.fn() }));
const { parseOptions, runEviction } = require('../scripts/evict-store');
const { withStoreBudgetLock, evictUntilUnderBudget } = require('../services/evictService');
const { cleanRetiredTables } = require('../services/retiredIngestTables');

beforeEach(() => { jest.clearAllMocks(); withStoreBudgetLock.mockImplementation((_db, fn) => fn()); evictUntilUnderBudget.mockResolvedValue({ dropped: 1, freedBytes: 100 }); });
test('uses a 24-hour default and permits explicit disablement', () => {
    expect(parseOptions([], {})).toMatchObject({ idleHours: 24, dryRun: false });
    expect(parseOptions(['--dry-run'], { STORE_IDLE_TTL_HOURS: '0' })).toMatchObject({ idleHours: 0, dryRun: true });
});
test.each(['-1', '1.5', 'wrong', 'Infinity', ' ', '876001'])('rejects invalid idle TTL %s', value => {
    expect(() => parseOptions([], { STORE_IDLE_TTL_HOURS: value })).toThrow('STORE_IDLE_TTL_HOURS');
});
test('a dry run writes neither cleanup nor history', async () => {
    const db = { query: jest.fn() };
    await runEviction(db, parseOptions(['--dry-run'], {}));
    expect(cleanRetiredTables).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
});
test('a busy maintenance lock skips without overwriting job health', async () => {
    withStoreBudgetLock.mockResolvedValue(null);
    const db = { query: jest.fn() };
    expect(await runEviction(db, parseOptions([], {}))).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(evictUntilUnderBudget).not.toHaveBeenCalled();
    expect(withStoreBudgetLock).toHaveBeenCalledWith(db, expect.any(Function), { tryLock: true });
});
