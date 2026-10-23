import { getEnv } from "./env";

/**
 * The public address of this deployment.
 *
 * Email is the one place that has to spell out absolute URLs: a `cid:` image and
 * a relative link are meaningless in a mail client, which is not on the site.
 *
 * Resolution order, most deliberate first:
 *
 * 1. `APP_URL` — the canonical public address. Set it in production so every
 *    message links to the real domain rather than whichever host happened to
 *    serve the request.
 * 2. the request's own origin — correct for a preview deployment and for local
 *    development, with no configuration.
 * 3. `VERCEL_URL` — Vercel sets this to the deployment host (no scheme).
 * 4. localhost, as a last resort so a missing variable degrades instead of
 *    throwing in the middle of a registration.
 */
export async function appBaseUrl(request?: Request): Promise<string> {
  const configured =
    (await getEnv("APP_URL"))?.trim() || (await getEnv("NEXT_PUBLIC_APP_URL"))?.trim();
  if (configured) return stripTrailingSlash(configured);

  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // Fall through to the environment.
    }
  }

  const vercel = (await getEnv("VERCEL_URL"))?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;

  return `http://localhost:${(await getEnv("PORT"))?.trim() || "3001"}`;
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** Join a path onto the base URL safely. */
export function appUrl(baseUrl: string, path: string) {
  return `${stripTrailingSlash(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}
