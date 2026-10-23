/**
 * Google Sheets — export only.
 *
 * The database (`store.ts`) is the source of truth for registrations. A deployed
 * Google Apps Script Web App (see `google-apps-script/Code.gs`) is still
 * supported, but purely as a way to push the stored rows into a spreadsheet the
 * organisers already know how to filter and pivot.
 *
 *   GET  <SHEET_WEBHOOK_URL>?action=list            → every stored player row
 *   GET  <SHEET_WEBHOOK_URL>?action=ping            → deployment health
 *   POST <SHEET_WEBHOOK_URL>  {"action":"append"}   → append one row per player
 *
 * The layout is deliberately flat — one row per player, with the team and leader
 * columns repeated on each row — so organisers can pivot without joining tabs.
 */

import { getEnv } from "./env";

/**
 * Header labels this app writes, in column order. Must stay in sync with
 * `COLUMNS` in `Code.gs`, which appends one further column the app never sends:
 * `Flags`, a formula the script fills in with its own duplicate warning.
 *
 * Every member carries their own university and contact details (a roster may
 * mix institutions), so those columns repeat per player row rather than being a
 * single team-level value.
 */
export const PLAYER_COLUMNS = [
  "Reference",
  "Submitted At",
  "Tournament",
  "Team Name",
  "Division",
  "Game",
  "Roster Size",
  "Player #",
  "Player Name",
  "Game Tag",
  "University",
  "Region",
  "Player Email",
  "Student ID",
  "Discord",
  "Phone",
  "Role",
  "Is Leader",
  "Team Leader",
  "Additional Requirements",
] as const;

export type PlayerColumn = (typeof PLAYER_COLUMNS)[number];

/** One spreadsheet row, keyed by its header label. */
export type PlayerRow = Record<PlayerColumn, string>;

/** Anything unexpected from Apps Script surfaces as this, so the API can respond. */
export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** True when retrying the same request could plausibly succeed. */
    readonly retryable = false,
    readonly code: SheetsErrorCode = "unknown",
  ) {
    super(message);
    this.name = "SheetsError";
  }
}

export type SheetsErrorCode =
  | "unknown"
  | "not-public"
  | "unauthorised"
  | "timeout";

const ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 45_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [400, 1200];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The export is unavailable until the web app URL is configured. */
export async function sheetsConfigured(): Promise<boolean> {
  return Boolean((await getEnv("SHEET_WEBHOOK_URL"))?.trim());
}

/**
 * The spreadsheet's own address, for a link the organiser can click.
 *
 * **This is not `SHEET_WEBHOOK_URL`.** That one is the Apps Script deployment — a
 * write-only endpoint — and the spreadsheet ID lives only in the script's properties on
 * Google's side, so the app has no way to derive the real address from it. It has to be
 * configured.
 *
 * Returned only when it is a plain `http(s)` URL. The value reaches an `href`, and an
 * operator-set value is the last place to be relaxed about schemes: a `javascript:` or
 * `data:` URL there would be a way to run script in the console, which is the one page
 * that holds every setting and every registration. Returns null on anything else, so a
 * typo shows no link rather than a broken or dangerous one.
 *
 * Null also when unset, which is the normal case — the link simply does not appear.
 */
export async function sheetUrl(): Promise<string | null> {
  const raw = (await getEnv("SHEET_URL"))?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      console.warn(
        `[sheets] SHEET_URL is a ${url.protocol} URL, which is not linkable. ` +
          `Use the https://docs.google.com/spreadsheets/… address.`,
      );
      return null;
    }
    return url.toString();
  } catch {
    console.warn("[sheets] SHEET_URL is not a valid URL, so no sheet link is shown.");
    return null;
  }
}

/** True for an address that looks like a Google Sheets document. Used by diagnostics. */
export function looksLikeSheetUrl(raw: string | undefined | null): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(raw?.trim() ?? "");
}

/**
 * The web app URL with the shared secret attached. Apps Script Web Apps are
 * publicly reachable, so the secret is what stops a stranger posting rows —
 * `Code.gs` rejects any request that does not carry it.
 */
async function endpoint(): Promise<string> {
  const raw = (await getEnv("SHEET_WEBHOOK_URL"))?.trim();
  if (!raw) throw new SheetsError("SHEET_WEBHOOK_URL is not configured", 503);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SheetsError("SHEET_WEBHOOK_URL is not a valid URL", 503);
  }

  const secret = (await getEnv("SHEET_WEBHOOK_SECRET"))?.trim();
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
}

interface ScriptResponse {
  ok?: boolean;
  error?: string;
  rows?: unknown;
  players?: unknown;
  sheet?: unknown;
}

/**
 * The single most common way to break this integration: deploying the web app
 * with the default "Who has access: Only myself". Google then answers every
 * anonymous request with a redirect to its sign-in page, which arrives as HTML
 * and looks like a random network failure.
 */
const NOT_PUBLIC_HINT =
  "The Apps Script deployment is not public — Google redirected the request to its sign-in page. " +
  'Fix it in the Apps Script editor: Deploy → Manage deployments → edit the web app, set ' +
  '"Who has access" to "Anyone", and deploy a new version.';

const DEV_URL_HINT =
  "That looks like an Apps Script /dev test URL, which only works while you are signed in. " +
  "Use the /exec URL from Deploy → Manage deployments instead.";

const MISSING_POST_HINT =
  "The deployed Apps Script has no doPost function — Google answered 405 Method Not Allowed. " +
  "Paste the current google-apps-script/Code.gs into the editor, Save, then " +
  "Deploy → Manage deployments → Edit → Version: New version.";

const PERMISSION_HINT =
  "Google refused the request. Check the deployment's access setting: " +
  '"Who has access" must be "Anyone".';

const UNAUTHORISED_HINT =
  "The shared secret was rejected. In the Apps Script editor run diagnose() — it prints the exact " +
  'value to put in SHEET_WEBHOOK_SECRET in .env — then restart the app.';

function asString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function hostOf(location: string) {
  try {
    return new URL(location, "https://script.google.com").hostname;
  } catch {
    return null;
  }
}

/**
 * Work out why Google sent a web page where JSON was expected. Only the
 * configuration mistakes are worth spelling out; the rest are Google-side
 * hiccups that a retry usually fixes.
 */
function htmlError(text: string, where: string): SheetsError {
  const sample = text.slice(0, 4000);

  if (/accounts\.google\.com|ServiceLogin|<title>\s*Sign in/i.test(sample)) {
    return new SheetsError(NOT_PUBLIC_HINT, 503, false, "not-public");
  }
  if (/Authoris?ation is required|You need permission/i.test(sample)) {
    return new SheetsError(DEV_URL_HINT, 503, false);
  }

  return new SheetsError(
    `Google returned an HTML error page ${where} instead of JSON. This is usually brief — try again.`,
    502,
    true,
  );
}

/** Turn a raw script response into JSON, or throw a diagnosis worth reading. */
function parseResponse(text: string, status: number): ScriptResponse {
  let parsed: ScriptResponse;
  try {
    parsed = JSON.parse(text) as ScriptResponse;
  } catch {
    if (/^\s*(<!doctype|<html)/i.test(text)) throw htmlError(text, "at the first hop");
    throw new SheetsError(`The Google Sheet returned an unexpected response (HTTP ${status})`, 502, true);
  }

  if (parsed.ok !== true || status >= 400) {
    const reported = parsed.error || "The Google Sheet rejected the request";

    if (/unauthoris|unauthoriz|not configured/i.test(reported)) {
      throw new SheetsError(UNAUTHORISED_HINT, 503, false, "unauthorised");
    }

    throw new SheetsError(reported, 502, false);
  }

  return parsed;
}

function statusError(status: number, text: string, where: string): SheetsError {
  if (status === 405) return new SheetsError(MISSING_POST_HINT, 503, false);
  if (status === 401 || status === 403) return new SheetsError(PERMISSION_HINT, 503, false);
  if (/^\s*(<!doctype|<html)/i.test(text)) return htmlError(text, where);
  return new SheetsError(`The Google Sheet returned HTTP ${status} ${where}.`, 502, true);
}

/** Fill in any column the sheet is missing so downstream code never sees undefined. */
export function normaliseRow(raw: unknown): PlayerRow {
  const source = (raw ?? {}) as Record<string, unknown>;
  const row = {} as PlayerRow;
  for (const column of PLAYER_COLUMNS) row[column] = asString(source[column]);
  return row;
}

/** One trip through the two-hop Apps Script redirect chain. */
async function attempt(
  action: "list" | "append" | "ping",
  payload: unknown,
  timeoutMs: number,
): Promise<ScriptResponse> {
  const url = new URL(await endpoint());
  url.searchParams.set("action", action);

  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const signal = AbortSignal.timeout(Math.max(1000, Math.round(timeoutMs)));

  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      // Apps Script only accepts simple content types here; a JSON content type
      // makes it drop the body. The script parses `e.postData.contents` itself.
      headers: body ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
      body,
      // Redirects are resolved by hand so a sign-in redirect can be recognised
      // instead of followed — following it downloads Google's sign-in page.
      redirect: "manual",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    const name = (error as Error).name;
    throw new SheetsError(`Could not reach the Google Sheet (${name})`, 502, true);
  }

  /* A healthy /exec answers with a 302 to script.googleusercontent.com, which is
     where the JSON the script returned actually lives. A redirect back to the
     configured host is also accepted — that is what a local mock server does. */
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";
    const host = hostOf(location);

    if (host && (host.endsWith("googleusercontent.com") || host === new URL(url).hostname)) {
      let echo: Response;
      try {
        echo = await fetch(location, { redirect: "follow", cache: "no-store", signal });
      } catch (error) {
        throw new SheetsError(
          `Could not read the Google Sheet response (${(error as Error).name})`,
          502,
          true,
        );
      }

      const text = await echo.text();
      if (echo.status >= 400) {
        throw statusError(echo.status, text, `at the second hop (HTTP ${echo.status})`);
      }
      return parseResponse(text, echo.status);
    }

    if (host && host.endsWith("google.com")) {
      throw new SheetsError(NOT_PUBLIC_HINT, 503, false, "not-public");
    }
    throw new SheetsError(
      `The Google Sheet redirected to an unexpected location (${host ?? "unknown host"})`,
      502,
      false,
    );
  }

  const text = await response.text();
  if (response.status >= 400) throw statusError(response.status, text, `(HTTP ${response.status})`);
  return parseResponse(text, response.status);
}

/**
 * Apps Script load-balances across instances and its echo hop fails often enough
 * that a single attempt is not a fair test.
 *
 * `retry` is false for `append`: a blind retry could write the same rows twice,
 * so the caller re-reads the sheet and decides instead.
 */
async function request(
  action: "list" | "append" | "ping",
  payload?: unknown,
  retry = true,
): Promise<ScriptResponse> {
  const startedAt = Date.now();
  const maxAttempts = retry ? MAX_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attemptNumber = 0; attemptNumber < maxAttempts; attemptNumber++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 3000) break;

    try {
      return await attempt(action, payload, Math.min(ATTEMPT_TIMEOUT_MS, remaining));
    } catch (error) {
      lastError = error;
      if (!(error instanceof SheetsError) || !error.retryable) throw error;

      const delay = RETRY_DELAYS_MS[attemptNumber];
      if (delay === undefined) break;

      console.warn(
        `[sheets] ${action} attempt ${attemptNumber + 1}/${maxAttempts} failed (${error.message}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  if (!retry && lastError instanceof SheetsError) throw lastError;

  const detail = lastError instanceof Error ? lastError.message : "unknown error";
  throw new SheetsError(
    `The Google Sheet did not respond in time. Last error: ${detail}`,
    502,
    false,
    "timeout",
  );
}

/** Whether the web app is reachable, for the diagnostics endpoints. */
export interface SheetHealth {
  ok: boolean;
  configured: boolean;
  sheet?: string;
  players?: number;
  error?: string;
}

/** Probe the deployment. */
export async function checkSheetConnection(): Promise<SheetHealth> {
  if (!(await sheetsConfigured())) {
    return { ok: false, configured: false, error: "SHEET_WEBHOOK_URL is not set" };
  }

  try {
    const { sheet, players } = await request("ping");
    return {
      ok: true,
      configured: true,
      sheet: typeof sheet === "string" ? sheet : undefined,
      players: typeof players === "number" ? players : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Every player row currently in the spreadsheet. */
export async function listPlayers(): Promise<PlayerRow[]> {
  const response = await request("list");
  if (!Array.isArray(response.rows)) {
    throw new SheetsError("The Google Sheet did not return any rows");
  }
  return (response.rows as unknown[]).map(normaliseRow);
}

/** Append one row per player. */
async function appendPlayers(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;

  /* Deliberately NOT retried: a v1 script stores whatever it receives, so
     re-sending after a lost response writes the team twice. `exportRows`
     re-reads the sheet instead, which detects a landed write before repeating. */
  await request("append", { action: "append", rows }, false);
}

export interface ExportOutcome {
  /** Rows written by this call. */
  appended: number;
  /** Rows already present and therefore skipped. */
  skipped: number;
  /** Total rows in the sheet afterwards, when the script reports it. */
  total?: number;
}

/**
 * Push rows to the spreadsheet, skipping any that are already there.
 *
 * Deduplicated by `Reference` + `Player #`: the sheet is an append-only mirror,
 * so without this a second export would double every team. Re-reading first is
 * what makes the retry safe.
 */
export async function exportRows(rows: PlayerRow[]): Promise<ExportOutcome> {
  if (rows.length === 0) return { appended: 0, skipped: 0 };

  const existing = await listPlayers().catch(() => [] as PlayerRow[]);
  const seen = new Set(
    existing.map((row) => `${row.Reference}|${row["Player #"]}`).filter((key) => key !== "|"),
  );

  const fresh = rows.filter((row) => !seen.has(`${row.Reference}|${row["Player #"]}`));
  const skipped = rows.length - fresh.length;

  if (fresh.length === 0) return { appended: 0, skipped, total: existing.length };

  await appendPlayers(fresh);
  return { appended: fresh.length, skipped, total: existing.length + fresh.length };
}
