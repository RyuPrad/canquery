const { interpretPaidInvoice } = require('../services/billingPolicy');
const account = { id: 'account', stripe_customer_id: 'customer' };
const invoice = { id: 'invoice', status: 'paid', customer: 'customer', currency: 'cad',
    livemode: false, billing_reason: 'subscription_cycle', subscription: 'subscription' };
const line = { price: { id: 'price' }, quantity: 1, period: { start: 1000, end: 1000 + 30 * 86400 } };
const settings = { mode: 'sandbox', priceId: 'price' };

test('pure interpretation returns the stable earned service period without side effects', () => {
    const result = interpretPaidInvoice(account, invoice, [line], settings);
    expect(result).toEqual({ id: 'business:account:subscription:1000:2593000', accountId: 'account',
        subscription: 'subscription', invoiceId: 'invoice', start: 1000, end: 2593000 });
});
test.each([{ status: 'open' }, { customer: 'other' }, { currency: 'usd' }, { livemode: true },
    { billing_reason: 'subscription_update' }])('rejects unmatched invoice %j', change => {
    expect(interpretPaidInvoice(account, { ...invoice, ...change }, [line], settings)).toBeNull();
});
test.each([[{ ...line, quantity: 2 }], [{ ...line, proration: true }], [line, line], []].map(lines => ({ lines })))(
    'rejects missing, multiple and prorated recurring matches %j', ({ lines }) => {
        expect(interpretPaidInvoice(account, invoice, lines, settings)).toBeNull();
    });
test.each([{ start: 1000, end: 999 }, { start: 1.5, end: 2000 }, { start: 0, end: 33 * 86400 }])(
    'fails invalid service bounds %j', period => {
        expect(() => interpretPaidInvoice(account, invoice, [{ ...line, period }], settings)).toThrow('Invalid billing period');
    });
