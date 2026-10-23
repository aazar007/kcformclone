/**
 * Render the confirmation email to `email-preview.html` so it can be looked at in
 * a browser.
 *
 *   npx tsx scripts/preview-email.ts
 *   npx tsx scripts/preview-email.ts KSU-26-AA53TG
 *
 * Read-only: it borrows a real registration to fill the template with real names
 * and writes nothing to the database. Leaving the preview file in the repository
 * root is deliberate — it is the thing to open when the wording or layout of the
 * email needs a second opinion, and it costs nothing to regenerate.
 */

import { writeFileSync } from "node:fs";
import { loadEnv } from "./lib/sheet-client";

loadEnv();

import { buildConfirmationEmail } from "../src/lib/confirmation-email";
import { getPrisma } from "../src/lib/db";

/** Where the preview points its links, so the edit button and footer are real. */
const BASE_URL = process.env.PREVIEW_BASE_URL ?? "http://localhost:3001";

/** Gmail clips a message past this size. */
const GMAIL_CLIP_BYTES = 102 * 1024;

async function main() {
  const reference = process.argv[2];

  const team = reference
    ? await (await getPrisma()).team.findUnique({
        where: { reference },
        include: { members: { orderBy: { position: "asc" } } },
      })
    : await (await getPrisma()).team.findFirst({
        include: { members: { orderBy: { position: "asc" } } },
        orderBy: { createdAt: "asc" },
      });

  if (!team) {
    console.error(
      reference
        ? `No registration is stored under ${reference}.`
        : "There are no registrations to borrow, so there is nothing to preview.",
    );
    process.exit(1);
  }

  console.log(`borrowed : ${team.teamName} — ${team.members.length} member(s), ${team.reference}`);

  for (const language of ["en", "ar"] as const) {
    const { html, subject, text } = buildConfirmationEmail(team, {
      baseUrl: BASE_URL,
      /* The real logo is referenced by URL rather than embedded, so the preview is
         self-contained. The sent email inlines it as a CID attachment. */
      logoSrc: `${BASE_URL}/ksu-crown-logo.png`,
      language,
    });

    const file = language === "ar" ? "email-preview-ar.html" : "email-preview.html";
    writeFileSync(file, html);

    const bytes = Buffer.byteLength(html);
    console.log("");
    console.log(`${language === "ar" ? "Arabic" : "English"}`);
    console.log(`  subject : ${subject}`);
    console.log(`  html    : ${bytes.toLocaleString()} bytes`);
    console.log(`  text    : ${Buffer.byteLength(text).toLocaleString()} bytes (plain-text alternative)`);
    console.log(
      `  gmail   : ${bytes > GMAIL_CLIP_BYTES ? `WILL CLIP (limit ${GMAIL_CLIP_BYTES.toLocaleString()})` : "under the clipping limit"}`,
    );
    /* The one thing worth failing loudly about: personal contact details must not
       travel in this message. */
    const leaked = team.members.filter(
      (member) => html.includes(member.email) || html.includes(member.phone) || text.includes(member.email) || text.includes(member.phone),
    );
    console.log(
      `  privacy : ${leaked.length === 0 ? "no member email or phone included" : `LEAKS ${leaked.length} member(s)`}`,
    );
    console.log(`  written : ${file}`);
  }
}

void main().then(() => process.exit(0));
