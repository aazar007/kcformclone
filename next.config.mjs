import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /** Do not advertise the framework in a response header. */
  poweredByHeader: false,

  /**
   * Browser-side protections, sent on every response.
   *
   * - CSP: only this origin may serve scripts/styles/images/connections. The two
   *   extra allowances exist for the admin logo tool, which loads its background-
   *   removal model from staticimgly.com and runs it as a WebAssembly web worker.
   *   `'unsafe-inline'` stays for scripts because Next's own hydration data and the
   *   language bootstrap in layout.tsx are inline; move to nonces if you want it gone.
   * - frame-ancestors / X-Frame-Options: nobody may embed the site (clickjacking).
   * - nosniff, Referrer-Policy, Permissions-Policy: close off MIME sniffing, URL
   *   leaks through the Referer header, and unused browser features.
   */
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    /* The real policy is built per request in src/middleware.ts, with a nonce. This
       looser one is only the fallback when CSP_STRICT=0 turns the middleware off. */
    const legacyCsp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
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

    return [
      {
        /* Personal data travels through these routes, so no cache — browser or
           intermediary — may keep a copy. The public game logos are the one
           exception: they are images, versioned by URL, and cached on purpose. */
        source: "/api/:path((?!games/).*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        /* A rulebook must be frameable *by this site*, because the public page renders
           it in a PDF viewer inside an iframe — one document per game.
           
           This is why it has its own rule: the blanket `X-Frame-Options: DENY` below
           applies to every path, and DENY refuses the frame even when the request is
           same-origin, so the viewer would render an empty box. The rulebook paths are
           excluded from that rule (see its `source`) and get SAMEORIGIN here instead:
           this site may embed them, nobody else may.
           
           Also no-store, so replacing a rulebook is visible immediately rather than
           after a cache expiry — which matters when the document defines the rules
           people are being held to. */
        source: "/api/games/:gameId/rulebook",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          /* HSTS again here on purpose. This path is *excluded* from the blanket rule
             below (that is how it gets SAMEORIGIN), so anything the blanket rule sets
             would otherwise be missing from it — and it was: verified, this response
             carried no Strict-Transport-Security at all. */
          ...(dev
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains",
                },
              ]),
        ],
      },
      {
        /* Everything except a rulebook, which needs the framing exception above. */
        source: "/:path((?!api/games/[^/]+/rulebook).*)",
        headers: [
          ...(process.env.CSP_STRICT === "0"
            ? [{ key: "Content-Security-Policy", value: legacyCsp }]
            : []),
          /* HSTS. Two years, subdomains included, no `preload`.
             Without this a first request over `http:` stays interceptable even though the
             site is served over TLS — and `upgrade-insecure-requests` in the CSP only
             protects resources the page loads, not that first navigation.
             Not in development: HSTS is honoured per host and would pin `localhost` to
             HTTPS for every other project on the machine. `preload` is left out
             deliberately — it is a commitment to HTTPS for the domain and its subdomains
             that is slow to undo, and it should be a decision, not a default. */
          ...(dev
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains",
                },
              ]),
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },

  /**
   * Serve `/.well-known/security.txt` from a route handler.
   *
   * A `.well-known` directory under `app/` is possible but behaves inconsistently — the
   * leading dot invites a private-folder rule somewhere down the line — so the file is
   * generated by a route and mapped here. The handler itself answers 404 unless a real
   * disclosure contact is configured; see `src/app/api/security-txt/route.ts`.
   */
  async rewrites() {
    return [
      { source: "/.well-known/security.txt", destination: "/api/security-txt" },
    ];
  },

  /**
   * Pin the tracing root to this project.
   *
   * Next walks up looking for a lockfile to decide what belongs in a serverless
   * bundle. There is a stray `package-lock.json` in a parent directory on some
   * machines, which makes it guess wrong — it warns about the ambiguity, and the
   * traced output can then include or leave out the wrong files. Naming the root
   * removes the guesswork.
   */
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
