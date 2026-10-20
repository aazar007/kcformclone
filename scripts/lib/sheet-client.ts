/**
 * Shared Google Sheets connection for the maintenance scripts.
 *
 * The sheet is an export target now, not the registration store: the database is
 * the source of truth and the scripts here inspect and sync the mirror.
 *
 * Deliberately standalone: it loads `.env` itself and speaks the same two-hop
 * Apps Script protocol as `src/lib/sheets.ts`, so these scripts need neither
 * Next.js nor the project's path aliases. Keep the redirect handling in step
 * with that file — a POST is answered with a 302 whose target carries the JSON,
 * and the target must be fetched with GET.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Apps Script serves the version a deployment was created from; must match Code.gs. */
export const EXPECTED_SCRIPT_VERSION = 5;

export type SheetRow = Record<string, string>;

export interface ScriptResponse {
  ok?: boolean;
  error?: string;
  rows?: SheetRow[];
  appended?: number;
  players?: number;
  sheet?: string;
  version?: number;
}

/** Load `.env.local` then `.env`, without overwriting anything already set. */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(trimmed);
      if (!match) continue;

      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  }
}

export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function endpoint(action: string): string {
  const raw = process.env.SHEET_WEBHOOK_URL?.trim();
  if (!raw) fail("SHEET_WEBHOOK_URL is not set — add it to .env (see README).");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("SHEET_WEBHOOK_URL is not a valid URL.");
  }

  url.searchParams.set("action", action);

  const secret = process.env.SHEET_WEBHOOK_SECRET?.trim();
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
}

/** Which deployment this is, for log lines — the id is the unguessable part. */
export function deploymentId(): string {
  const match = /\/s\/([A-Za-z0-9_-]{12})/.exec(process.env.SHEET_WEBHOOK_URL ?? "");
  return match ? `${match[1]}…` : "unknown";
}

interface Hop {
  status: number;
  text: string;
  location: string | null;
}

async function hop(url: string, init?: RequestInit): Promise<Hop> {
  const response = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    ...init,
  });

  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get("location"),
  };
}

/**
 * Call the web app and return its JSON.
 *
 * GET actions answer with the JSON directly; POST answers 302 to an echo
 * endpoint that must be fetched with GET (Apps Script only accepts GET there).
 */
export async function callScript(
  action: string,
  payload?: unknown,
): Promise<ScriptResponse> {
  const url = endpoint(action);

  let first: Hop;
  try {
    first = await hop(
      url,
      payload === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload),
          },
    );
  } catch (error) {
    fail(`Could not reach the web app: ${(error as Error).message}`);
  }

  let body = first.text;
  let status = first.status;

  if (first.location) {
    const host = new URL(first.location, "https://script.google.com").hostname;
    if (host.endsWith("accounts.google.com")) {
      fail(
        'The deployment is not public — Google redirected to its sign-in page.\n' +
          '  In the Apps Script editor: Deploy → Manage deployments → Edit,\n' +
          '  set "Who has access" to "Anyone", then deploy a new version.',
      );
    }

    let second: Hop;
    try {
      second = await hop(first.location);
    } catch (error) {
      fail(
        `Google's echo hop failed (${(error as Error).message}).\n` +
          "  This is usually brief — run the command again.",
      );
    }
    body = second.text;
    status = second.status;
  }

  if (status === 405) {
    fail(
      "The deployed script has no doPost function (HTTP 405).\n" +
        "  Paste google-apps-script/Code.gs into the Apps Script editor, Save,\n" +
        "  then Deploy → Manage deployments → Edit → Version: New version.",
    );
  }

  let parsed: ScriptResponse;
  try {
    parsed = JSON.parse(body) as ScriptResponse;
  } catch {
    fail(
      `The web app returned a non-JSON response (HTTP ${status}).\n` +
        "  Usually a transient Google error — run the command again.",
    );
  }

  if (parsed.ok !== true) {
    const reason = parsed.error ?? `HTTP ${status}`;
    if (/unauthoris|unauthoriz/i.test(reason)) {
      fail(
        "The shared secret was rejected.\n" +
          "  In the Apps Script editor run diagnose() and copy the value it prints\n" +
          "  into SHEET_WEBHOOK_SECRET in .env, then run this again.",
      );
    }
    fail(reason);
  }

  return parsed;
}

export async function ping(): Promise<Required<Pick<ScriptResponse, "sheet" | "players">> & ScriptResponse> {
  return (await callScript("ping")) as never;
}

export async function listPlayers(): Promise<SheetRow[]> {
  const { rows } = await callScript("list");
  return rows ?? [];
}

export async function appendRows(rows: SheetRow[]): Promise<{ appended: number }> {
  const response = await callScript("append", { action: "append", rows });
  return { appended: typeof response.appended === "number" ? response.appended : rows.length };
}
