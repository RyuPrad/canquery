const Stripe = require('stripe');
const { config } = require('./commercialConfig');
const { failure } = require('../db/commercialQueries');

function stripeClient() {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw failure('Billing is not configured', 'BILLING_UNAVAILABLE', 503);
    }
    config(); // Refuse a key from another environment before any provider I/O.
    return new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-09-30.endive', timeout: 10000, maxNetworkRetries: 1
    });
}

// Complete provider work before taking the global meter lock. The caller still
// owns its existing customer/event transaction; changing that claim protocol is
// a separate semantic change, not part of this extraction.
async function capturePaidInvoices(stripe, customerId, event) {
    const invoices = await stripe.invoices.list({ customer: customerId, status: 'paid', limit: 100 });
    if (event?.type.startsWith('invoice.') && !invoices.data.some(invoice => invoice.id === event.object_id)) {
        invoices.data.push(await stripe.invoices.retrieve(event.object_id));
    }
    const captured = [];
    for (const invoice of invoices.data) {
        const lines = invoice.lines?.has_more
            ? await stripe.invoices.listLineItems(invoice.id, { limit: 100 }).autoPagingToArray({ limit: 1000 })
            : invoice.lines?.data || [];
        captured.push({ invoice, lines });
    }
    return captured;
}

module.exports = { stripeClient, capturePaidInvoices };
