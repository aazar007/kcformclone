/**
 * Reading settings and secrets.
 *
 * Every setting the app reads at run time goes through `getEnv()` rather than
 * `process.env` directly. It is async because some hosts only hand the code its
 * variables per request, not at start-up:
 * hi
 * - **Cloudflare Workers** (OpenNext) keep the Worker's variables and secrets in
 *   the request context's `env`. OpenNext publishes that context on a well-known
 *   global symbol, which is read here so no Cloudflare package has to be imported
 *   (and the app still builds and runs on Node, Vercel and Prisma).
 * - **Everywhere else** the value comes from `process.env`, exactly as before.
 *
 * A Worker binding wins over `process.env` when both exist, because the binding is
 * the value set in the Cloudflare dashboard for this deployment.
 *
 * The result is the raw string, never trimmed: callers decide whether whitespace
 * matters (passwords are taken literally; names and hosts are trimmed).
 */

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

interface CloudflareContext {
  env?: Record<string, unknown>;
}

function workerBinding(name: string): string | undefined {
  const context = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT] as
    | CloudflareContext
    | undefined;
  const value = context?.env?.[name];
  return typeof value === "string" ? value : undefined;
}

/** The named setting, or `undefined` when it is not set anywhere. */
export async function getEnv(name: string): Promise<string | undefined> {
  return workerBinding(name) ?? process.env[name];
}
