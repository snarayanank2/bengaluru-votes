/**
 * k6 election-day load test (Task 65; architecture.md §12).
 *
 * Proves three things about the single 4 vCPU / 16 GB Hostinger VPS
 * (Mumbai; architecture §14.1) before election week:
 *
 *   1. Cached-page RPS at election-day volume holds p95 < 500 ms.
 *   2. Legitimate-shaped traffic through the CGNAT-sized rate-limit zones
 *      (deploy/nginx/snippets/rate-limits.conf) sees ZERO 429s.
 *   3. The nginx micro-cache — not the app origin — absorbs the load: a
 *      high proportion of cached-page responses are cache HITs.
 *
 * This file is the REAL VALIDATION IS DEFERRED artifact: the run itself
 * happens off-box, against staging, before election week (see the "Run
 * procedure" section added to deploy/runbook.md). This file only needs to
 * be correct and realistic; it is not executed automatically or by the app
 * test suite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY k6-FROM-ONE-IP *IS* THE CGNAT TEST, NOT A DISTORTION OF IT
 * ─────────────────────────────────────────────────────────────────────────
 * k6 issues every request in this run from one source IP, driven by many
 * virtual users (VUs). nginx's `limit_req_zone` buckets are keyed on
 * `$binary_remote_addr` (rate-limits.conf) — i.e. per source IP. Many real
 * citizens sharing one carrier egress IP (Jio/Airtel CGNAT, architecture
 * §7/§13) is *exactly* this shape: lots of independent legitimate requests,
 * one IP. So k6's own topology is the scenario under test, not an artifact
 * to work around.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PEAK-LOAD ASSUMPTION — READ BEFORE TUNING (this is a hypothesis, not a
 * measurement; the real run on the VPS is what validates or refutes it)
 * ─────────────────────────────────────────────────────────────────────────
 * GTM plan (docs/gtm-plan.md): 300,000 unique visitors is the WHOLE-CAMPAIGN
 * target, not a single day's number. Assume election day itself concentrates
 * a disproportionate share of that traffic (citizens checking their ward,
 * candidates, and booth right before voting) — say 10-15% of the campaign
 * total inside one active day, i.e. ~30,000-45,000 visits across ~12 hours.
 * At ~5 page views/visit (architecture §5's "~5 pages per ward" shape:
 * home, ward result, candidates, compare, issues/guide) that's roughly
 * 150,000-225,000 requests / 43,200s ≈ 3.5-5 req/s AVERAGE. Real traffic is
 * never flat: a press mention, a WhatsApp-forwarded partner link
 * (docs/prd.md §5.12), or the last two hours before polls close can produce
 * a burst 20-50x the daily average for a short window.
 *
 * Rather than trust that multiplier precisely, this test targets a
 * deliberately generous PEAK_CACHED_RPS in the "low hundreds" band as a
 * stress margin — a number chosen to be defensible-but-uncomfortable for a
 * single Node process rather than a tightly-derived forecast. If the box
 * holds this, real election-day traffic (almost certainly lower) is safe
 * with headroom; if it doesn't, the remediation is a Hostinger plan
 * upgrade (architecture §14.1), not a re-architecture.
 * Tune PEAK_CACHED_RPS below (or via -e PEAK_CACHED_RPS=<n>) once the real
 * run gives actual numbers to react to.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * X-Cache-Status DEPENDENCY
 * ─────────────────────────────────────────────────────────────────────────
 * Assertion 3 reads the `X-Cache-Status` response header
 * (`$upstream_cache_status`). This build adds
 * `add_header X-Cache-Status $upstream_cache_status always;` to
 * deploy/nginx/snippets/security-headers.conf — inside the shared snippet,
 * not as a per-location add_header, so it does NOT trip the Task-60
 * add_header-inheritance gotcha (a location that sets its OWN add_header
 * inherits none of the parent's; this line lives in the file every cached
 * location already inherits, so nothing regresses). See that file's own
 * comment for the reasoning.
 *
 * KNOWN GAP: staging's nginx location (`deploy/nginx/conf.d/site.conf`,
 * the block commented "No cache anywhere on staging") deliberately does
 * NOT set `proxy_cache` — every request goes straight to app-staging. That
 * means $upstream_cache_status (and therefore this header) will read empty
 * on staging AS CURRENTLY CONFIGURED, and the cache-HIT-ratio assertion
 * cannot be satisfied by pointing BASE_URL at staging until that's
 * addressed. See deploy/runbook.md's "k6 election-day load test" section
 * for the two remediation options and why this script still defaults to
 * targeting staging for the RPS/429 assertions regardless.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CANDIDATE SLUGS
 * ─────────────────────────────────────────────────────────────────────────
 * `/candidate/{slug}` is real curator-authored content — no slug exists
 * until curators publish candidates (PRD §9.1 readiness gating). Pass a
 * small seeded list via `-e CANDIDATE_SLUGS=slug-one,slug-two,...` once
 * some exist on the target environment. Absent that, candidate-page
 * traffic is a no-op and its weight is folded into ward-page traffic
 * instead (see PAGE_MIX below) — the mix still exercises the cache and the
 * home/ward/guide pages that need no seed data.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// ───────────────────────── Tunable constants ──────────────────────────────
// Keep these here, not buried in scenario logic, so they're easy to tune
// from the box after seeing the first real run's numbers.

const BASE_URL = (__ENV.BASE_URL || 'https://staging-bengaluruvotes.opencity.in').replace(/\/$/, '');

// Peak sustained arrival rate (requests/sec) for the cached-page scenario.
// See the big comment above for the justification. Override with
// `-e PEAK_CACHED_RPS=<n>` to explore other assumptions without editing
// the script.
const PEAK_CACHED_RPS = Number(__ENV.PEAK_CACHED_RPS) || 250;

// How long to ramp up to peak, hold, and ramp down.
const RAMP_UP = __ENV.RAMP_UP || '2m';
const HOLD_AT_PEAK = __ENV.HOLD_AT_PEAK || '5m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '1m';

// Modest, sustained legitimate `/api/ward-lookup` traffic — well under the
// `api` zone's 30 req/s (burst 60, nodelay; rate-limits.conf) so the zone
// is genuinely exercised by realistic ward-lookup volume without the test
// itself being the reason it would ever 429. This runs CONCURRENTLY with
// the cached-page scenario, from the same k6 source IP, which is the point:
// both scenarios' /api/ traffic (there is none from the cached scenario —
// see note below) plus this scenario together must never exceed the zone.
const WARD_LOOKUP_RPS = Number(__ENV.WARD_LOOKUP_RPS) || 15;

// Share of requests that go to the /kn/ Kannada twin of a page rather than
// the English original. 15% is a starting assumption (no real bilingual
// split data exists pre-launch); tune once real analytics exist.
const KN_SHARE = Number(__ENV.KN_SHARE) || 0.15;

// Optional seeded candidate slugs (comma-separated) — see the big comment
// above. Empty by default; candidate-page weight folds into ward pages
// when this is empty.
const CANDIDATE_SLUGS = (__ENV.CANDIDATE_SLUGS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Optional basic-auth. Vestigial as of 2026-08-13: staging's `auth_basic` was
// removed (architecture §14.2), so neither target needs credentials and both
// of these stay unset in practice. Kept because it costs nothing and is what
// you would reach for if staging is ever put back behind a password.
const STAGING_USER = __ENV.STAGING_USER || '';
const STAGING_PASS = __ENV.STAGING_PASS || '';
const AUTH_HEADERS = STAGING_USER
  ? { Authorization: 'Basic ' + encoding_b64(`${STAGING_USER}:${STAGING_PASS}`) }
  : {};

// k6 doesn't ship btoa in all contexts; implement the tiny bit of base64
// we need directly rather than pulling in an external jslib dependency
// (this script is deliberately self-contained — no network fetch of helper
// libs at test-start time).
function encoding_b64(str) {
  const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  const bytes = [];
  for (let idx = 0; idx < str.length; idx++) bytes.push(str.charCodeAt(idx));
  while (i < bytes.length) {
    const b1 = bytes[i++];
    const b2 = i < bytes.length ? bytes[i++] : NaN;
    const b3 = i < bytes.length ? bytes[i++] : NaN;
    const enc1 = b1 >> 2;
    const enc2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
    const enc3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
    const enc4 = isNaN(b3) ? 64 : b3 & 63;
    result += b64chars[enc1] + b64chars[enc2] + (enc3 === 64 ? '=' : b64chars[enc3]) + (enc4 === 64 ? '=' : b64chars[enc4]);
  }
  return result;
}

// ───────────────────────── Ward-id space ──────────────────────────────────
// wards.id is a SYNTHESIZED composite key: corporation_id*1000 + a
// per-corporation ward number that restarts at 1 for each corporation
// (scripts/seed-wards.ts). It is NOT a sequential 1..369 range — building
// that wrong range would silently 404 every request. The real ranges,
// straight from that script's own inspection notes:
//   Central (1) 1001-1063   North (2) 2001-2072   East (3) 3001-3050
//   South  (4) 4001-4072   West  (5) 5001-5112
// The full 369-id set is built here (cheap) so "a range of the 369 ward
// ids" means the REAL id space, not a guessed one.
const WARD_ID_RANGES = [
  { base: 1000, count: 63 }, // central
  { base: 2000, count: 72 }, // north
  { base: 3000, count: 50 }, // east
  { base: 4000, count: 72 }, // south
  { base: 5000, count: 112 }, // west
];
const WARD_IDS = WARD_ID_RANGES.flatMap(({ base, count }) =>
  Array.from({ length: count }, (_, i) => base + i + 1),
);

// Addresses for the /api/ward-lookup path.
//
// READ THIS BEFORE RUNNING AT SCALE. Until 2026-08-14 this pool held
// pincodes, and lookup answered them from a committed table — free, and
// safe to fire at production. Pincode lookup was removed; every request
// here now goes to the Google Geocoding API.
//
// `geocode_cache` (normalized address -> ward id) absorbs repeats, so this
// fixed pool costs at most ~20 real geocodes for a whole run no matter how
// many VUs — that is the entire reason it is a fixed pool and not generated
// addresses. Do NOT randomize these into unique strings: that would spend
// one unit of GEOCODE_DAILY_BUDGET per request, and exhausting the budget
// now takes ward lookup DOWN for real citizens (there is no fallback since
// pincode was removed). A load test must not be able to cause the outage it
// is meant to measure.
const SAMPLE_ADDRESSES = [
  'MG Road, Bengaluru', 'Jayanagar 4th Block, Bengaluru',
  'Indiranagar 100 Feet Road, Bengaluru', 'Koramangala 5th Block, Bengaluru',
  'Malleshwaram 8th Cross, Bengaluru', 'Whitefield Main Road, Bengaluru',
  'Yelahanka New Town, Bengaluru', 'Basavanagudi Bull Temple Road, Bengaluru',
  'HSR Layout Sector 2, Bengaluru', 'Rajajinagar 1st Block, Bengaluru',
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function withLang(pathEn) {
  // Every route in this mix has a /kn/ twin (docs/information-architecture.md
  // §1: "every public path exists in both languages"). Applying the KN
  // prefix here, uniformly, keeps each page-builder below simple.
  if (Math.random() >= KN_SHARE) return pathEn;
  return pathEn === '/' ? '/kn/' : `/kn${pathEn}`;
}

// ───────────────────────── Page mix (cached scenario) ─────────────────────
// Weights are a realistic READ shape for election-day traffic: home and
// ward-result dominate (the ward lookup is the entry point for almost
// every visit — architecture §5, PRD §5.1), candidates/compare/issues
// trail off, guides are a steady minority. All figures are assumptions,
// clearly separated here so they're easy to revisit once real analytics
// exist (there are none pre-launch).
const HAS_CANDIDATE_SLUGS = CANDIDATE_SLUGS.length > 0;

const PAGE_MIX = [
  { weight: 0.25, build: () => withLang('/') },
  // Candidate-list traffic is part of the ward page now. Candidate report-card
  // weight folds into it when no candidate slugs are seeded.
  { weight: HAS_CANDIDATE_SLUGS ? 0.35 : 0.50, build: () => withLang(`/ward/${randomFrom(WARD_IDS)}`) },
  { weight: 0.05, build: () => withLang(`/ward/${randomFrom(WARD_IDS)}/compare`) },
  { weight: 0.10, build: () => withLang(`/ward/${randomFrom(WARD_IDS)}`) },
  {
    weight: HAS_CANDIDATE_SLUGS ? 0.15 : 0,
    build: () => withLang(`/candidate/${randomFrom(CANDIDATE_SLUGS)}`),
  },
  {
    weight: 0.10,
    build: () =>
      withLang(
        randomFrom([
          '/voting-guide',
          '/voting-guide/voter-id',
          '/voting-guide/how-to-vote',
          '/voting-guide/find-booth',
        ]),
      ),
  },
];
const PAGE_MIX_TOTAL_WEIGHT = PAGE_MIX.reduce((sum, p) => sum + p.weight, 0);

function pickCachedPath() {
  let r = Math.random() * PAGE_MIX_TOTAL_WEIGHT;
  for (const entry of PAGE_MIX) {
    if (r < entry.weight) return entry.build();
    r -= entry.weight;
  }
  return '/'; // unreachable in practice; defensive fallback
}

// ───────────────────────── Metrics ─────────────────────────────────────────

// Assertion 2: zero 429s for legitimate-shaped traffic. Counted across
// BOTH scenarios (cached pages are not rate-limited by `api`/`otp`, but a
// 429 from ANY of this test's traffic is a failure of the "legitimate
// traffic never 429s" property, so both scenarios feed this one counter).
const rateLimited429 = new Counter('rate_limited_429');

// Assertion 3: cache HIT ratio on the cached-page scenario. Only sampled
// for requests that got a 200 (a MISS on first-ever hit of a URL in a TTL
// window is expected and fine; what matters under sustained load is that
// the overwhelming majority of requests land on an already-warm cache
// entry, proving the origin is not re-rendering per request). See the
// X-Cache-Status dependency note in the file header comment.
const cacheHitRate = new Rate('cache_hit_rate');

// ───────────────────────── Scenarios / thresholds ──────────────────────────

export const options = {
  scenarios: {
    // Assertion 1 + 3: ramping arrival rate of cached, anonymous public-page
    // GETs, climbing to PEAK_CACHED_RPS and holding.
    cached: {
      executor: 'ramping-arrival-rate',
      exec: 'cachedReads',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(50, Math.ceil(PEAK_CACHED_RPS / 2)),
      maxVUs: Math.max(200, PEAK_CACHED_RPS * 3),
      stages: [
        { target: PEAK_CACHED_RPS, duration: RAMP_UP },
        { target: PEAK_CACHED_RPS, duration: HOLD_AT_PEAK },
        { target: 0, duration: RAMP_DOWN },
      ],
    },
    // Assertion 2: a modest, sustained, concurrent stream of legitimate
    // /api/ward-lookup traffic through the coarse `api` zone (30r/s burst
    // 60, rate-limits.conf) — proving real ward lookups don't 429 even
    // while the cached scenario above is simultaneously hammering the box
    // from the same k6 source IP (the CGNAT shape).
    ward_lookup: {
      executor: 'ramping-arrival-rate',
      exec: 'wardLookup',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 60,
      stages: [
        { target: WARD_LOOKUP_RPS, duration: RAMP_UP },
        { target: WARD_LOOKUP_RPS, duration: HOLD_AT_PEAK },
        { target: 0, duration: RAMP_DOWN },
      ],
    },
  },
  thresholds: {
    // Assertion 1: p95 < 500ms on the cached-page scenario specifically.
    // k6 auto-tags every request with `scenario:<name>`, no manual tagging
    // needed.
    'http_req_duration{scenario:cached}': ['p(95)<500'],
    // General health backstop — a handful of non-429 errors (a cold
    // Postgres connection, a transient timeout) shouldn't silently blow the
    // budget, but this is not the primary assertion.
    http_req_failed: ['rate<0.01'],
    // Assertion 2: legitimate-shaped traffic through the CGNAT-sized zones
    // must see ZERO 429s. Any 429 at all fails this test outright.
    rate_limited_429: ['count==0'],
    // Assertion 3: the micro-cache, not the origin, absorbs the load.
    // Requires deploy/nginx/snippets/security-headers.conf's
    // X-Cache-Status header (added in this change) to actually reach the
    // target. See the KNOWN GAP note in the file header: this threshold
    // will report "no data"/fail against staging as currently configured,
    // because staging's nginx location has no proxy_cache at all.
    cache_hit_rate: ['rate>0.9'],
  },
};

// ───────────────────────── Scenario bodies ─────────────────────────────────

export function cachedReads() {
  const path = pickCachedPath();
  const res = http.get(`${BASE_URL}${path}`, {
    headers: AUTH_HEADERS,
    tags: { name: 'cached_page' }, // groups all cached-page URLs under one metric series
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  if (res.status === 429) rateLimited429.add(1);

  const cacheStatus = res.headers['X-Cache-Status'];
  if (res.status === 200 && cacheStatus) {
    cacheHitRate.add(cacheStatus === 'HIT');
  }

  sleep(0.1); // trivial pacing so a stalled response doesn't self-DoS the VU pool
}

export function wardLookup() {
  const res = http.post(
    `${BASE_URL}/api/ward-lookup`,
    JSON.stringify({ address: randomFrom(SAMPLE_ADDRESSES) }),
    {
      // A real browser same-origin POST always carries an `Origin` header
      // (and, in modern browsers, `Sec-Fetch-Site: same-origin`). The k6 Go
      // HTTP client sends neither by default. src/middleware.ts's
      // passesOriginCheck() fails CLOSED when both are absent (by design —
      // "forged curator publishes are the worst outcome this design can
      // produce"), so every ward-lookup POST would otherwise get a 403 that
      // has nothing to do with capacity/cache/rate-limiting. Send both here
      // so this scenario exercises the real /api/ward-lookup code path
      // instead of 403-spamming.
      headers: Object.assign(
        { 'Content-Type': 'application/json', Origin: BASE_URL, 'Sec-Fetch-Site': 'same-origin' },
        AUTH_HEADERS,
      ),
      tags: { name: 'ward_lookup' },
    },
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  if (res.status === 429) rateLimited429.add(1);

  sleep(0.1);
}
