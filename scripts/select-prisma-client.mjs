/**
 * Choose which generated Prisma client the application will import.
 *
 *   node scripts/select-prisma-client.mjs node      → Vercel, `next start`, local scripts
 *   node scripts/select-prisma-client.mjs workers   → Cloudflare Workers
 *
 * **Why this exists.** Prisma's client is not portable across the two runtimes.
 * `runtime = "workerd"` compiles the query compiler into
 * `query_compiler_fast_bg.wasm?module`, and that `?module` suffix is a Cloudflare
 * convention: Wrangler resolves it and Node cannot. Loading the Workers build under Node
 * throws
 *
 *   The loaded wasm module was unexpectedly `undefined` or `null` once loaded
 *
 * from the client constructor, so *every* database call fails — locally, under
 * `next start`, and on Vercel — no matter how correct `DATABASE_URL` is. The Node build
 * uses `@prisma/client/runtime/client` instead and has no such import.
 *
 * `prisma/schema.prisma` therefore declares one generator per runtime and writes them to
 * separate folders. This script copies the right one into `generated/prisma-client`,
 * which is the single path `src/lib/db.ts` imports, so the application never has to know
 * which flavour it got.
 *
 * Copying rather than symlinking: a symlink into `node_modules`-adjacent paths resolves
 * differently inside the Workers bundler, and a plain directory copy is what both
 * toolchains already expect from a generated client.
 */

import { cp, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const TARGETS = {
  node: "generated/prisma-client-node",
  workers: "generated/prisma-client-workers",
};

const destination = join("generated", "prisma-client");

const which = process.argv[2];
if (!which || !(which in TARGETS)) {
  console.error(
    `usage: node scripts/select-prisma-client.mjs <${Object.keys(TARGETS).join("|")}>`,
  );
  process.exit(1);
}

const source = TARGETS[which];

try {
  await stat(source);
} catch {
  /* A missing folder means `prisma generate` has not run for this runtime — which is a
     build-order bug, not a runtime one, and worth failing loudly rather than shipping a
     half-copied client. */
  console.error(
    `✖ ${source} does not exist. Run \`npm run prisma:gen\` first.\n` +
      "  (It regenerates both flavours; the engine only needs one pass.)",
  );
  process.exit(1);
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

console.log(`✔ Prisma client: ${which} (${source} → ${destination})`);
