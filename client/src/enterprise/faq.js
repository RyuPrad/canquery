// The account question under Getting started, the Accounts and the API group,
// and links to pricing, terms and the credit policy.
export default {
  groups: groups => [
    ...groups.map(([group, items]) => [group, group === 'getting_started' ? [items[0], 'account', ...items.slice(1)] : items]),
    ['accounts_and_api', ['plans', 'credits', 'refunds', 'cancellation']],
  ],
  links: {
    account: ['/pricing', 'faq.pricing_link'],
    sources: ['/terms', 'faq.terms_link'],
    plans: ['/pricing', 'faq.pricing_link'],
    credits: ['/pricing', 'faq.pricing_link'],
    refunds: ['/docs#reliability', 'faq.docs_link'],
    cancellation: ['/terms', 'faq.terms_link'],
  },
};
