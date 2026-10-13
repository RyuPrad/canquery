/**
 * @typedef {Object} PaidPeriod
 * @property {string} id Stable account/subscription/service-period identity.
 * @property {string} accountId
 * @property {string} subscription
 * @property {string} invoiceId
 * @property {number} start Unix seconds from the matching recurring line.
 * @property {number} end Unix seconds, exclusive.
 */

/** Pure provider-boundary validation; null means no matching earned period.
 * @returns {PaidPeriod|null}
 */
function interpretPaidInvoice(account, invoice, lines, { mode, priceId }) {
    if (invoice.status !== 'paid' || invoice.customer !== account.stripe_customer_id || invoice.currency !== 'cad'
        || invoice.livemode !== (mode === 'live')
        || !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason)) return null;
    const matching = lines.filter(line => (line.pricing?.price_details?.price || line.price?.id) === priceId
        && line.quantity === 1 && !line.parent?.subscription_item_details?.proration && !line.proration);
    if (matching.length !== 1) return null;
    const { start, end } = matching[0].period || {};
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 32 * 86400) {
        throw new Error('Invalid billing period');
    }
    const subscription = invoice.parent?.subscription_details?.subscription || invoice.subscription;
    if (typeof subscription !== 'string') throw new Error('Invoice subscription is missing');
    return { id: `business:${account.id}:${subscription}:${start}:${end}`,
        accountId: account.id, subscription, invoiceId: invoice.id, start, end };
}

function matchesBusinessPrice(price, reviewed, mode) {
    return price.livemode === (mode === 'live') && price.active && price.currency === reviewed.currency
        && price.unit_amount === reviewed.amount && price.recurring?.interval === reviewed.interval
        && price.recurring?.interval_count === 1;
}

function matchesCheckoutSession(session, lines, { mode, priceId, taxEnabled }) {
    return session.mode === 'subscription' && session.livemode === (mode === 'live')
        && Boolean(session.automatic_tax?.enabled) === taxEnabled && !lines.has_more
        && lines.data.length === 1 && lines.data[0].quantity === 1 && lines.data[0].price?.id === priceId;
}

module.exports = { interpretPaidInvoice, matchesBusinessPrice, matchesCheckoutSession };
