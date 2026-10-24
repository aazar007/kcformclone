/**
 * Set, or clear, the grand admin's password directly in the database.
 *
 *   npm run admin:reset            set a new password (prompted, hidden)
 *   npm run admin:reset -- --clear remove it, restoring bootstrap mode
 *
 * **Why this exists.** The stored password is now the *only* thing the console's sign-in
 * accepts; `ADMIN_SECRET` is a bootstrap credential that stops working the moment a
 * password exists. That is the property the organisers asked for — a leaked deployment
 * secret must not be a permanent way in — but it removes the old recovery path, so a
 * forgotten password would otherwise mean being shut out of your own tournament.
 *
 * This is that recovery path, and it is deliberately *out of band*: it needs database
 * credentials and a shell on a trusted machine, which is a much narrower thing to hold
 * than a value the console accepts from a browser.
 *
 * Two properties it keeps:
 *
 * - **Never on the command line.** `npm run admin:reset -- "hunter2"` would put the
 *   password into the shell history and the process list. It is read from a hidden prompt,
 *   or from stdin when piped (`pbpaste | npm run admin:reset`).
 * - **The same policy as the console.** `passwordProblem` runs here too, so a password
 *   this tool accepts is one the console would also have accepted. A reset that produced
 *   something the UI refuses would be a trap.
 *
 * `--clear` is not a convenience: it is how you deliberately return a deployment to
 * bootstrap mode (for instance after rotating `ADMIN_PEPPER`, which invalidates every
 * existing hash).
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import "dotenv/config";
import { adminPepper } from "../src/lib/admin-auth";
import { hashCredentialAsync, passwordProblem } from "../src/lib/admin-credential";
import { Client } from "pg";

/**
 * Direct SQL, deliberately, rather than the Prisma client.
 *
 * The application's Prisma client is generated for **Cloudflare Workers**
 * (`runtime = "workerd"` in the schema's generator block), and its query compiler is a
 * WASM module that only a bundler can load — under plain Node it fails with
 * "The loaded wasm module was unexpectedly `undefined` or `null` once loaded".
 *
 * That is fine for the deployed app and useless for a recovery tool, which has to run on a
 * laptop or a CI box at the exact moment somebody cannot get into their own console. `pg`
 * is already a dependency and speaks to the same database, so this script does not depend
 * on the Worker build at all.
 */
const ADMIN_CREDENTIAL_ID = "owner";

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Reads the password, twice, from a hidden prompt or from piped input.
 *
 * The piped form reads **all** of stdin once and hands out one line per prompt. The
 * obvious version — attaching `data` handlers per prompt — silently produced nothing at
 * all: by the time the second prompt ran, stdin had already ended, so its promise never
 * settled and node exited with the event loop empty. A script that can only be used
 * interactively is exactly the wrong shape for a recovery tool somebody runs under
 * pressure.
 */
const piped = process.stdin.isTTY ? null : readFileSync(0, "utf8").split(/\r?\n/);
let pipedIndex = 0;

function readSecret(prompt: string): Promise<string> {
  if (piped) {
    const value = piped[pipedIndex] ?? "";
    pipedIndex += 1;
    process.stdout.write(`${prompt}${value ? "(from stdin)" : "(empty)"}\n`);
    return Promise.resolve(value);
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    /* Everything typed is replaced in the echo, so the password is never drawn on screen. */
    const mute = () => {
      const write = (process.stdout as unknown as { write: (s: string) => boolean }).write.bind(
        process.stdout,
      );
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (text: string) => {
        if (text.includes("\n") || text.includes("\r")) write(text);
      };
    };

    process.stdout.write(prompt);
    mute();
    rl.question("", (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(18)} ${value}`);
}

async function main() {
  const clear = process.argv.includes("--clear");

  if (!process.env.DATABASE_URL?.trim()) {
    console.error("\n✖ DATABASE_URL is not set, so there is no password to change.\n");
    process.exitCode = 1;
    return;
  }

  if (clear) {
    await withClient((client) => client.query("DELETE FROM \"AdminCredential\" WHERE id = $1", [ADMIN_CREDENTIAL_ID]));
    console.log("\n✓ The stored password has been removed.\n");
    console.log("The console now accepts ADMIN_SECRET again (bootstrap mode), and will do so");
    console.log("until a new password is set from the console. Set one promptly.\n");
    return;
  }

  const existing = await withClient(async (client) => {
    const { rows } = await client.query('SELECT "passwordHash" FROM "AdminCredential" WHERE id = $1', [ADMIN_CREDENTIAL_ID]);
    return rows[0]?.passwordHash ? String(rows[0].passwordHash).split(":")[0] : null;
  }).catch(() => null);

  const password = await readSecret("New grand admin password: ");
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`\n✖ ${problem}\n`);
    process.exitCode = 1;
    return;
  }

  const confirm = await readSecret("Repeat it: ");
  if (confirm !== password) {
    console.error("\n✖ The two entries do not match. Nothing was changed.\n");
    process.exitCode = 1;
    return;
  }

  const pepper = await adminPepper();
  const hash = await hashCredentialAsync(password, pepper);
  await withClient((client) =>
    client.query(
      `INSERT INTO "AdminCredential" (id, "passwordHash", "updatedVia", "updatedAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE
         SET "passwordHash" = EXCLUDED."passwordHash",
             "updatedVia"  = EXCLUDED."updatedVia",
             "updatedAt"   = NOW()`,
      [ADMIN_CREDENTIAL_ID, hash, "reset"],
    ),
  );

  console.log("\n✓ The password has been replaced.\n");
  line("length", `${password.length} characters`);
  line("pepper", pepper.length > 0 ? "in use (ADMIN_PEPPER)" : "none");
  line("replaced", existing ? `an existing password (${existing})` : "nothing — this is the first one");
  console.log("");
  console.log("From now on the console accepts only this password for the grand admin.");
  console.log("ADMIN_SECRET no longer signs in — it is only the bootstrap credential for a");
  console.log("deployment that has never had a password.");
  console.log("");
  if (pepper.length === 0) {
    console.log("⚠ No ADMIN_PEPPER is set, so the stored hash depends only on the password and");
    console.log("  the database. Setting one makes a stolen database useless to an attacker,");
    console.log("  but it must match everywhere and changing it invalidates this password.\n");
  }
  console.log("The password itself is never printed and never logged.");
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
