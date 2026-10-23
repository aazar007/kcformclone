import { NextResponse, type NextRequest } from "next/server";
import { CONSOLE_HEADER, adminPath, staffPath } from "@/lib/admin-path";
import { getEnv } from "@/lib/env";

/**
 * A path that matches no route, so Next renders its ordinary 404.
 *
 * The console used to be reachable at `/admin`. Anything typed there is now answered
 * exactly as a path that does not exist, rather than with a "forbidden" — a distinct
 * refusal would confirm the route is there, which is the one thing being avoided.
 */
const NOT_FOUND = "/_admin-not-found";

/**
 * The two addresses the console answers on, and the internal route each maps to.
 *
 * Both are resolved through `@/lib/admin-path`, which derives them from `ADMIN_SECRET`
 * (or `ADMIN_PATH` / `STAFF_PATH`). Two separate segments rather than one path with a
 * mode parameter, so the grand admin's address and the staff address are independent:
 * handing out the staff address does not reveal the grand admin's, and neither page can
 * be reached by tweaking the other.
 */
async function consoleRoutes() {
  const [owner, staff] = await Promise.all([adminPath(), staffPath()]);
  return [
    { segment: owner, internal: "/admin" },
    { segment: staff, internal: "/admin/staff" },
  ].filter((entry): entry is { segment: string; internal: string } => Boolean(entry.segment));
}

/**
 * Move the organiser console off `/admin` and onto its secret segments.
 *
 * Returns the URL to rewrite to, plus the segment that matched — the pages require that
 * segment as proof the request came through here. Null when the request is not about the
 * console at all, in which case the caller carries on with the security headers.
 *
 * The absence of a segment is meaningful: with no secret in production there is no
 * console, so nothing is mapped and `/admin` still 404s.
 */
async function consoleRoute(
  request: NextRequest,
): Promise<{ url: URL; segment: string | null } | null> {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return { url: new URL(NOT_FOUND, request.url), segment: null };
  }

  for (const { segment, internal } of await consoleRoutes()) {
    const prefix = `/${segment}`;
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;

    /* `/crown-ab12…/anything` → `/admin/anything`, so any sub-paths a page grows move
       with it and the files on disk stay where they are. */
    const url = request.nextUrl.clone();
    url.pathname = `${internal}${pathname.slice(prefix.length)}`;
    return { url, segment };
  }

  return null;
}

/**
 * Content-Security-Policy with a fresh nonce per request.
 *
 * Only scripts that carry this request's nonce (Next's own, plus the language
 * bootstrap in layout.tsx), or that those scripts load, may run. An injected
 * `<script>` or inline handler has no nonce and is refused — which is what keeps a
 * future script-injection bug from becoming account takeover.
 *
 * Kill switch: set CSP_STRICT=0 in the environment and redeploy to fall back to the
 * older, looser policy in next.config.mjs if this ever breaks a page.
 */
export async function middleware(request: NextRequest) {
  /* Runs first, and on both branches below: moving the console is not a policy the
     CSP kill switch should be able to turn off. */
  const route = await consoleRoute(request);

  const dev = process.env.NODE_ENV !== "production";
  const hsts = "max-age=63072000; includeSubDomains";

  /*
   * Known limitation, verified rather than assumed: **a trailing-slash redirect carries none
   * of these headers.** Next answers `/privacy/` with a 308 before the request reaches this
   * middleware — tried `skipTrailingSlashRedirect`, and it made no difference; the response
   * is emitted by the normaliser with no headers at all, not even CSP. So HSTS on redirects
   * has to come from the TLS terminator (Vercel, nginx, Cloudflare), which is where it
   * belongs anyway. Recorded here because it looks like an oversight and is not one.
   */

  if ((await getEnv("CSP_STRICT")) === "0") {
    const response = route ? NextResponse.rewrite(route.url) : NextResponse.next();
    if (!dev) response.headers.set("Strict-Transport-Security", hsts);
    return response;
  }

  const nonce = btoa(crypto.randomUUID());

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced scripts load their own chunks; 'self' and
    // 'unsafe-inline' are ignored by browsers that understand it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://staticimgly.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  // Next reads the nonce from the request's CSP header and stamps it on its scripts.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  /* The console page refuses to render without this, so reaching it requires coming
     through the rewrite above rather than typing its on-disk path. Only set on the
     console's real address — never on the 404 rewrite. */
  if (route?.segment) headers.set(CONSOLE_HEADER, route.segment);

  const response = route
    ? NextResponse.rewrite(route.url, { request: { headers } })
    : NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);

  /* HSTS here as well as in `next.config.mjs`.
     Not because this covers the redirects — it does not, see the note at the top of this
     function — but because middleware is the one place that also serves the
     `CSP_STRICT=0` branch and any rewrite, and a security header that is set on most
     responses and not others is the kind of gap that is only noticed after it matters.
     The header is idempotent, so the duplicate is free.

     Development is excluded for the same reason as in the config: HSTS is per-host and
     would pin `localhost` to HTTPS for every other project on the machine. */
  if (!dev) {
    response.headers.set("Strict-Transport-Security", hsts);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
