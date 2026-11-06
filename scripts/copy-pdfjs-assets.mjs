/**
 * Copy pdf.js's CMap and standard-font assets into `public/pdfjs/`.
 *
 *   npm run pdfjs:assets
 *
 * **Why these are needed.** A PDF can describe its text two ways. Embedding the font with
 * a `ToUnicode` map is the safe one — the viewer never has to interpret the bytes. The
 * other refers to a **predefined CMap** (`Identity-H`, `UniGB-UCS2-H`, …) or uses one of
 * the fourteen standard fonts without embedding it. For those, pdf.js looks the mapping
 * up in `cmaps/` and the glyph outlines in `standard_fonts/`.
 *
 * If those two URLs are not configured, the lookup fails and **non-Latin text renders as
 * garbage instead of as missing glyphs** — Arabic looks corrupted rather than blank. That
 * is the bug these files fix, and it applies to any rulebook an organiser uploads, not
 * only the ones that happen to need it today.
 *
 * **Copied, not committed by hand, and re-copied on install.** The CMap tables are
 * versioned with pdf.js: a `cmaps/` directory from a different release can map code
 * points differently, so a stale copy would be worse than none. Running this from
 * `postinstall` keeps the two in step automatically.
 *
 * The destination is `public/`, which Next serves at the site root and OpenNext copies to
 * `.open-next/assets` — so the same paths work on Vercel and on Cloudflare Workers, and
 * the files fall under the existing `connect-src 'self'` / `font-src 'self'` policies.
 * Nothing here is fetched unless a document actually asks for a CMap or a standard font.
 */

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Where pdf.js ships its asset directories. */
function pdfjsRoot() {
  try {
    // Resolve through the package's own manifest so this works with any install layout.
    return dirname(require.resolve("pdfjs-dist/package.json"));
  } catch {
    return null;
  }
}

const destination = join("public", "pdfjs");

const root = pdfjsRoot();
if (!root) {
  /* A dependency that is not installed yet is not an error for `postinstall` in every
     workflow (a pruned install, for instance), but silently shipping without the assets
     would reintroduce the corruption. Say so and carry on. */
  console.warn("⚠ pdfjs-dist is not installed — skipped copying its CMap/font assets.");
  process.exit(0);
}

const assets = ["cmaps", "standard_fonts"];

await mkdir(destination, { recursive: true });

for (const name of assets) {
  const from = join(root, name);
  const to = join(destination, name);

  try {
    await stat(from);
  } catch {
    console.warn(`⚠ pdfjs-dist is missing ${name}/ — skipped.`);
    continue;
  }

  /* Removed first: a version bump can *drop* files, and a leftover CMap from the previous
     release would quietly answer a lookup with the wrong table. */
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

/*
 * The pdf.js worker, copied here too so its URL does not depend on the bundler.
 *
 * The reader used to derive this from `new URL("pdfjs-dist/…", import.meta.url)`, which
 * webpack turns into a **content-hashed** path under `/_next/static/media/`. That works on
 * a Node host and inside OpenNext's asset manifest, but it makes the worker's location a
 * build artefact that has to be tracked across two different asset pipelines (Next's and
 * OpenNext's). A fixed path under `public/` is served by both, identically, with no
 * hashing involved — and the reader can state it as a constant.
 */
const workerSource = join(root, "legacy", "build", "pdf.worker.min.mjs");
const workerTarget = join(destination, "pdf.worker.min.mjs");
try {
  await stat(workerSource);
  await cp(workerSource, workerTarget);
} catch {
  console.warn("⚠ pdfjs-dist is missing legacy/build/pdf.worker.min.mjs — skipped.");
}

console.log(`✔ pdf.js assets → ${destination} (cmaps/, standard_fonts/, pdf.worker.min.mjs)`);
