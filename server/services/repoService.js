// Live GitHub repo stats (star count) for the footer badge. Fetched
// server-side and cached so the browser never talks to api.github.com
// (the strict CSP blocks cross-origin connect), and so the 60 req/hour
// unauthenticated limit is never a concern: at most one upstream call
// per cache window regardless of traffic.
//
// Degrades gracefully: any upstream failure negative-caches null, and the
// controller returns data: null so the client shows a static fallback.
const { createCache } = require('../utils/cache');
const { fetchWithBackoff } = require('../utils/fetchWithBackoff');
const AppError = require('../utils/AppError');

const REPO_URL = 'https://api.github.com/repos/RyuPrad/canquery';
const USER_AGENT = process.env.USER_AGENT || 'canquery/1.0';

// One successful fetch keeps the count fresh for 10 min; a failure
// negative-caches null for 5 min so we don't hammer a struggling API.
const repoCache = createCache({ name: 'github-repo', ttlMs: 10 * 60 * 1000, negativeTtlMs: 5 * 60 * 1000 });

async function fetchGitHubRepo() {
    const response = await fetchWithBackoff(REPO_URL, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        timeoutMs: 8000
    });
    if (!response.ok) {
        throw new AppError('GitHub upstream returned ' + response.status, 502);
    }
    const body = await response.json();
    const stars = typeof body.stargazers_count === 'number' ? body.stargazers_count : null;
    return stars == null ? null : { stars };
}

async function getRepoStats() {
    return repoCache.get('canquery', fetchGitHubRepo);
}

module.exports = { getRepoStats };
