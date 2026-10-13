// Hosted canquery.com pages for initial HTML and crawl files: pricing, terms,
// the developer account and sign-in pages, plus hosted wording for /docs and
// /faq. The text matches what the core served before the extension hooks.
const { BUSINESS_PRICE, TERMS_VERSION } = require('../services/commercialConfig');
const { pricingOverview, hostedDocs } = require('./developerPresentation');

const META = {
    pricing: {path:'/pricing',title:'Canadian open data API pricing - CanQuery',description:`A hosted Canadian public-data API for recurring reports and dashboards. Start free; Business is CA$${BUSINESS_PRICE.amount / 100}/month, with custom requirements scoped separately.`},
    account: {path:'/account',title:'Developer account - CanQuery',description:'Manage your API keys, usage and billing.',noindex:true},
    login: {path:'/login',title:'Sign in - CanQuery',description:'Sign in to your developer account.',noindex:true},
    signup: {path:'/signup',title:'Create an account - CanQuery',description:'Create a free developer account.',noindex:true},
    'forgot-password': {path:'/forgot-password',title:'Reset your password - CanQuery',description:'Request a password reset.',noindex:true},
    'reset-password': {path:'/reset-password',title:'Save a new password - CanQuery',description:'Reset your account password.',noindex:true},
    terms: {path:'/terms',title:'API terms - CanQuery',description:'API service access, allowances, billing and publisher licences.'},
};
const COPY = {
    pricing: {title:'Canadian data for your next client report.',summary:'A hosted API for analytics and research teams. Find supported public datasets, query the records you need, and reuse the integration in your reports and dashboards.',links:[{path:'/docs#quickstart',label:'Try the example free'},{path:'/terms',label:'API terms'}]},
    account: {title:'Developer account',summary:'Sign in to manage API keys, usage and billing. JavaScript is required for account actions.',links:[{path:'/login',label:'Sign in'}]},
    login: {title:'Sign in',summary:'Enable JavaScript to sign in securely. For help, contact support@canquery.com.'},
    signup: {title:'Create a developer account',summary:'Start with a free API allowance and no payment card. Enable JavaScript to create and verify your account.'},
    'forgot-password': {title:'Reset your password',summary:'Enable JavaScript to request a password reset.'},
    'reset-password': {title:'Save a new password',summary:'Enable JavaScript to use your password reset link.'},
    terms: {title:'API terms',summary:`Effective ${TERMS_VERSION}. Subscriptions provide CanQuery service access within published allowances. Publisher licences and attribution remain applicable. Business renews monthly at CA$${BUSINESS_PRICE.amount / 100} plus applicable taxes; cancel before renewal through the billing portal. Access continues through the paid period. No automatic overages or credit rollover. Contact support@canquery.com about billing, deletion or Enterprise agreements.`,links:[{path:'/pricing',label:'Plans and credit costs'},{path:'/privacy',label:'Privacy'}]},
};
// Sitemap order follows this list; private pages are noindex, no-store and
// carry no analytics bootstrap.
const ROUTES = Object.freeze([
    ['pricing', 'PricingPage', { overview: pricingOverview, sitemap: { changefreq: 'monthly', priority: '0.5' } }],
    ['account', 'AccountPage', { private: true }],
    ['login', 'AuthPage', { private: true }],
    ['signup', 'AuthPage', { private: true }],
    ['forgot-password', 'AuthPage', { private: true }],
    ['reset-password', 'AuthPage', { private: true }],
    ['terms', 'TermsPage', { sitemap: { changefreq: 'yearly', priority: '0.3' } }]
].map(([type, module, extra]) => Object.freeze({ type, path: META[type].path, module, meta: META[type], copy: COPY[type], ...extra })));

const OVERRIDE_META = {
    docs: {
        title: 'Canadian open data API documentation - CanQuery',
        description:
            'Build with Canadian public data: working curl, Python and JavaScript examples, endpoint reference, API keys, pagination, preparation and error handling.',
        path: '/docs',
    },
    faq: {
        title: 'Frequently asked questions - CanQuery',
        description: 'Get answers about Canadian open data, supported tables and maps, file preparation, developer accounts and contacting CanQuery support.',
        path: '/faq',
    },
};
const OVERRIDE_COPY = {
    faq: {
        title: 'Frequently asked questions',
        summary: 'A few useful answers about finding data, preparing tables and using your developer account.',
        links: [
            { path: '/docs', label: 'Read the API documentation' },
            { path: '/pricing', label: 'Compare plans and credits' },
            { path: '/terms', label: 'Read the service terms' },
            { path: '/privacy', label: 'Privacy and your data' }
        ]
    },
};
const FAQ = {
    // The account question follows the first "Getting started" question.
    insert: { 'getting-started': { index: 1, questions: [
            { question: 'Do I need an account?',
                answer: 'You can browse the website and use its supported data tools without an account. A verified developer account lets you create API keys and view your API usage. Creating a Free account does not start a paid subscription.' },
    ] } },
    groups: [
        { id: 'accounts-and-api', title: 'Accounts and the API', questions: [
            { question: 'What is the difference between Free and Business?',
                answer: 'Both plans offer the same supported data capabilities. Business provides a larger API allowance, more keys and higher request capacity. It does not remove file, query, export or map limits. See Pricing for current prices and allowances.' },
            { question: 'How do API credits work?',
                answer: 'Keyed API requests use credits according to the operation. Successful cached requests still count. A newly admitted preparation job has its own charge; joining existing work, checking job status and renewing activity cost no credits. Rate and capacity limits still apply. The Pricing and API documentation pages explain current costs and workflow examples.' },
            { question: 'Are credits returned if preparation fails?',
                answer: 'If a charged preparation job ends in failure without publishing a successful copy, its original charge is returned once to the original payer and allowance period. Internal retries or stopping polling do not establish failure. A return to an expired period does not add credits to the current period. These are account credits, not cash refunds.' },
            { question: 'How do I cancel Business or get account help?',
                answer: 'Open the billing portal from your account to cancel before renewal. Access continues through the paid period, then follows Free allowances. Email support for billing questions, account deletion or help with verification and password-reset messages.' }
        ] }
    ]
};

let cached;
function pages() {
    if (!cached) {
        const { docsOverview } = require('../services/developerPresentation');
        const { faqExplanation } = require('../services/seoSnapshot');
        cached = Object.freeze({
            routes: ROUTES,
            overrides: {
                docs: { meta: OVERRIDE_META.docs, overview: () => docsOverview(hostedDocs) },
                faq: { meta: OVERRIDE_META.faq, copy: OVERRIDE_COPY.faq, overview: () => faqExplanation(FAQ) }
            }
        });
    }
    return cached;
}

module.exports = { pages };
