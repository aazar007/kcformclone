/**
 * Turn a password into a value for `ADMIN_SECRET`.
 *
 *   npm run admin:hash
 *
 * Reads the password from a hidden prompt, or from stdin when piped:
 *
 *   pbpaste | npm run admin:hash
 *
 * **Never on the command line.** `npm run admin:hash -- "hunter2"` would put the
 * password into the shell history *and* into the process list, where any other process
 * on the machine can read it while it runs. There is deliberately no argument for it.
 *
 * The hash is produced by `hashAdminSecret` in `src/lib/admin-auth.ts` — the same module
 * that verifies it, so the generator cannot drift from the verifier. It then checks the
 * value round-trips before printing, because a published instruction that produces a
 * value the app rejects is worse than no instruction.
 */

import { createInterface } from "node:readline";
import { checkAdminSecret, hashAdminSecret } from "../src/lib/admin-auth";

/** Prompt without echoing, for a TTY. Falls back to a plain read when piped. */
function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    });
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    /* Everything the user types is replaced in the echo, so the password is never drawn
       on screen — including over a shoulder or in a screen recording. */
    const mute = () => {
      const write = (process.stdout as unknown as { write: (s: string) => boolean }).write.bind(
        process.stdout,
      );
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (text: string) => {
        if (text.includes("\n") || text.includes("\r")) write(text);
      };
    };

    process.stdout.write("Password to hash: ");
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
  const password = await readPassword();

  if (!password.trim()) {
    console.error("\n✖ Nothing was entered — no hash produced.\n");
    process.exit(1);
  }

  const hashed = hashAdminSecret(password);

  /* Prove it before recommending it. `hashAdminSecret` is scrypt, so this costs one more
     run of the same work — worth it to guarantee the instructions below are correct.
     The variant appends a character rather than a space: the verifier trims the submitted
     value, so " password" is the *same* candidate and would not prove anything. */
  const previous = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = hashed;
  const roundTrips = await checkAdminSecret(password);
  const rejects = !(await checkAdminSecret(`${password}x`));
  if (previous === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = previous;

  if (!roundTrips || !rejects) {
    console.error(
      "\n✖ The generated hash did not verify. This is a bug in `hashAdminSecret` — " +
        "do not use the value below.\n",
    );
    process.exit(1);
  }

  console.log("\nPut this line in .env (replace the existing ADMIN_SECRET), then restart the app:\n");
  console.log(`ADMIN_SECRET="${hashed}"\n`);

  console.log("Notes");
  line("password length", `${password.length} characters`);
  line("format", "scrypt, 16-byte salt, N=16384");
  line("verified", "the hash accepts the password and rejects a variant");
  console.log("");
  console.log("The password itself is never printed and never stored — only the hash is.");
  console.log("");
  console.log("Two consequences of changing ADMIN_SECRET:");
  console.log("  • the console's web address changes, because it is derived from this");
  console.log("    value — run `npm run check` to be told the new one");
  console.log("  • every signed-in organiser is signed out, which is intended");
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
