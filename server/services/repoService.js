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

const REPO_URL = 'https://api.github.com/repos/RyuPrad/canquery';
const USER_AGENT = process.env.USER_AGENT || 'canquery/1.0';

// One successful fetch keeps the count fresh for 10 min; a failure
// negative-caches null for 5 min so we don't hammer a struggling API.
const repoCache = createCache({ name: 'github-repo', ttlMs: 10 * 60 * 1000, negativeTtlMs: 5 * 60 * 1000 });

// Resolves null on any failure (never throws): the cache only negative-caches
// resolved nulls, and the endpoint's contract is 200 + data: null when GitHub
// is unreachable. A single attempt (no retries) keeps it to at most one
// upstream call per cache window, and a rate-limited GitHub (403/429) is not
// worth retrying anyway.
async function fetchGitHubRepo() {
    try {
        const response = await fetchWithBackoff(REPO_URL, {
            headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
            timeoutMs: 8000,
            maxRetries: 0
        });
        if (!response.ok) {
            console.warn('[repo] GitHub upstream returned ' + response.status);
            return null;
        }
        const body = await response.json();
        const stars = typeof body.stargazers_count === 'number' ? body.stargazers_count : null;
        return stars == null ? null : { stars };
    } catch (err) {
        console.warn('[repo] GitHub fetch failed: ' + err.message);
        return null;
    }
}

async function getRepoStats() {
    return repoCache.get('canquery', fetchGitHubRepo);
}

module.exports = { getRepoStats };
