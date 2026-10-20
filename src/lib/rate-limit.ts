/**
 * A tiny in-process rate limiter.
 *
 * Deliberately not a general-purpose one: it exists to blunt guessing against the
 * endpoints that are cheap to call and expensive to get wrong — asking for codes
 * and looking up a registration by reference.
 *
 * On serverless each instance keeps its own counters, so this is a speed bump
 * rather than a wall. The durable limit that actually matters — how many codes an
 * address can request — is enforced in the database (see `countRecentOtps`).
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/** Drop buckets with no recent hits so the map cannot grow without bound. */
function prune(now: number, windowMs: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((at) => now - at < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may try again, when `ok` is false. */
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  prune(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Which request header names the real caller, when the deployment says so.
 *
 * The proxy in front of the app is the only thing that can answer this: it knows which
 * incoming headers it overwrote. Setting this is the way to make IP-keyed limits exact.
 * The header is expected to be *overwritten* by that proxy (nginx
 * `proxy_set_header X-Real-IP $remote_addr`, or `X-Forwarded-For` with
 * `$remote_addr`), not appended to.
 */
function trustedHeader(): string | null {
  const configured = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  return configured || null;
}

/** Warned once per process: a busy log should not repeat this on every request. */
let warnedAboutAddressSource = false;

/**
 * Best-effort client address, restricted to headers the caller cannot choose.
 *
 * The previous version trusted `x-vercel-forwarded-for` **unconditionally and first**. On
 * Vercel that is fine — the edge overwrites it — but anywhere else (nginx, Caddy, a
 * container platform, a bare node process) it is simply another header a client may send.
 * An attacker who rotated it got a fresh rate-limit bucket on every request, which defeated
 * every IP-keyed control: OTP request quotas, registration submission limits, and the
 * admin brute-force lockout. Verified: 13 registration attempts from one client, all
 * refused on their merits, none ever throttled.
 *
 * So the order is now: `TRUSTED_IP_HEADER`, then the Vercel edge headers, then give up.
 * There is no fourth step that reads a header the client could have written — see
 * `callerAddress` for why `x-forwarded-for` is not consulted at all.
 */
export function clientKey(request: Request, scope: string) {
  return `${scope}:${callerAddress(request)}`;
}

/**
 * The caller's address, or `"local"` when it genuinely cannot be known.
 *
 * `"local"` is a single shared bucket. That is a deliberate trade: it throttles everybody
 * together rather than handing each caller a bucket they can choose for themselves.
 * Shared throttling is an availability nuisance; attacker-chosen buckets are no limit at
 * all, which is the failure this function has now been fixed twice for.
 *
 * The order, and there is no fallback past it:
 *
 * 1. **`TRUSTED_IP_HEADER`** — the operator has named the header their proxy overwrites.
 *    If that header is *absent*, this returns `"local"` rather than looking elsewhere.
 *    Configuring trust must never end up trusting more than nothing.
 * 2. **`VERCEL` is set** — the platform's edge overwrites `x-vercel-forwarded-for`, so it is
 *    authoritative there. (`VERCEL` is set by Vercel itself on every deployment.)
 * 3. Otherwise `"local"`.
 *
 * **`x-forwarded-for` is not read at all.** It looks safe to take the rightmost entry, on
 * the reasoning that a proxy which appends puts the real address last. That only holds if
 * a proxy is actually there — and if one is, the operator can say so with
 * `TRUSTED_IP_HEADER`, which costs one line and removes the guess. Without a proxy the
 * header is pure client input: rotating it produced a fresh bucket per request, which is
 * precisely the hole this was supposed to close. Verified: a direct client sending three
 * different `X-Forwarded-For` values got three different buckets before this change.
 */
export function callerAddress(request: Request): string {
  const explicit = trustedHeader();
  if (explicit) {
    /* First entry only: a proxy setting this header overwrites it, and one that appends
       puts its own address first. Beyond that, take what is given and nothing else. */
    const value = request.headers.get(explicit)?.split(",")[0]?.trim();
    return value || "local";
  }

  if (process.env.VERCEL) {
    const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (vercel) return vercel;
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }

  if (!warnedAboutAddressSource && process.env.NODE_ENV === "production") {
    warnedAboutAddressSource = true;
    console.warn(
      "[rate-limit] Cannot identify callers: no TRUSTED_IP_HEADER is set and VERCEL is not " +
        "detected. Every caller shares one rate-limit bucket until a trusted header is " +
        "configured. See the README.",
    );
  }

  return "local";
}

/* ------------------------------------------------------------------ */
/* Failure lockout                                                     */
/* ------------------------------------------------------------------ */

const failures = new Map<string, number[]>();

/**
 * Seconds until `key` may try again, or 0 when it is not locked out.
 * Unlike `rateLimit` this only counts *failures*, so a legitimate user making many
 * successful calls is never throttled.
 */
export function lockoutSeconds(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length === 0) failures.delete(key);
  else failures.set(key, recent);
  if (recent.length < limit) return 0;
  return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
}

export function recordFailure(key: string) {
  const list = failures.get(key) ?? [];
  list.push(Date.now());
  failures.set(key, list);
  if (failures.size > 5000) {
    const now = Date.now();
    for (const [k, v] of failures) if (v.every((at) => now - at > 3_600_000)) failures.delete(k);
  }
}

export function clearFailures(key: string) {
  failures.delete(key);
}
