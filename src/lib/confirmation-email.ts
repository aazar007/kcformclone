/**
 * The confirmation a team receives once it is registered.
 *
 * Built as HTML with **inline styles and table layout**, because a mail client is
 * not a browser: there is no stylesheet to link, `flex`/`grid` support is
 * inconsistent (Outlook in particular renders through Word), and anything
 * relying on a `<style>` block may be stripped. Tables and inline `style`
 * attributes are the only things every client agrees on.
 *
 * The brand mark travels as an inline (`cid:`) attachment rather than a linked
 * URL. Most clients block remote images until the reader opts in, so a linked
 * logo shows as a grey box on the first open — which is exactly the moment this
 * email has to look trustworthy.
 */

import { MEMBER_ROLE_LABEL, type MemberRole } from "./games";
import { escapeHtml, mailerAllowsLogFallback, mailerConfigured, sendMail } from "./mailer";
import { emailCopy, emailDirection, fill, type EmailCopy } from "./email-copy";
import { DEFAULT_LANGUAGE, arabicDigits, type Language } from "./i18n";
import { appUrl } from "./app-url";
import type { StoredTeam } from "./store";

/** The Content-ID the template references; must match the attachment. */
export const LOGO_CID = "ksucrownlogo";
const LOGO_FILENAME = "ksu-crown-logo.png";
const LOGO_CONTENT_TYPE = "image/png";
const LOGO_PATH = "/ksu-crown-logo.png";

/** Nothing here may hold up a registration response that has already succeeded. */
const LOGO_FETCH_TIMEOUT_MS = 4000;

/**
 * Ceiling for the embedded logo.
 *
 * The whole message has to stay under Gmail's 102 kB clipping limit, and base64
 * inflates whatever we attach by a third. The mark is displayed 150 px wide, so
 * a few hundred pixels is already generous on a retina screen — far smaller than
 * the ~154 kB source file, which is sized for the site header, not for email.
 */
const EMAIL_LOGO_MAX_BYTES = 36 * 1024;

/* -------------------------------------------------------------------------- */
/* Colours — the same ramp the site uses, flattened for mail clients           */
/* -------------------------------------------------------------------------- */

const INK = "#eaf7fb";
const BODY = "#9fc0cc";
const MUTED = "#7ba0ad";
const CYAN = "#5cf0f7";
const CARD = "#0d2a37";
const WALL = "#0b1a20";
const LINE = "#1c4a5a";

const DIVISION_LABEL: Record<string, string> = { male: "Male", female: "Female" };

function formatSubmittedAt(date: Date, language: Language) {
  // Pinned to the tournament's timezone so the mail matches the organisers'
  // clocks rather than whatever region the serverless function runs in.
  try {
    const formatted = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
      timeZone: "Asia/Riyadh",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
    // Node's ICU already renders Arabic dates with Arabic-Indic digits under
    // "ar-SA", so nothing further is needed here.
    return formatted;
  } catch {
    return date.toISOString();
  }
}

function roleLabel(role: string, copy: EmailCopy) {
  switch (role) {
    case "STARTER":
      return copy.roleStarter;
    case "SUBSTITUTE":
      return copy.roleSubstitute;
    case "COACH":
      return copy.roleCoach;
    default:
      return MEMBER_ROLE_LABEL[role as MemberRole] ?? role;
  }
}

function answersOf(value: unknown): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const answer = entry as { label?: unknown; value?: unknown };
    const label = typeof answer.label === "string" ? answer.label : "";
    const text = answer.value === null || answer.value === undefined ? "" : String(answer.value);
    return text ? [{ label, value: text }] : [];
  });
}


/**
 * Escape a template, then substitute one placeholder with pre-built HTML.
 *
 * The alternative — escaping after substituting — would either double-escape the
 * highlight or leave the rest of the sentence unescaped. Splitting first means every
 * literal part goes through `escapeHtml` and only the marked value is trusted, and
 * that value is escaped too.
 */
function boldAt(
  template: string,
  placeholder: string,
  escapedValue: string,
  colour: string,
): string {
  return template
    .split(placeholder)
    .map((part) => escapeHtml(part))
    .join(`<strong style="color:${colour};">${escapedValue}</strong>`);
}

/* -------------------------------------------------------------------------- */
/* Template pieces                                                            */
/* -------------------------------------------------------------------------- */

/** One label/value pair. Rendered as a row so it wraps gracefully on mobile. */
function detailRow(label: string, value: string, mono = false, rtl = false) {
  /* Physical padding on purpose: this is a two-column table, and in RTL the label
     column has to be right-aligned with its gap on the other side. Logical
     properties do not reach `align` in a mail client. */
  const gap = rtl ? "5px 0 5px 12px" : "5px 12px 5px 0";
  const last = rtl ? "5px 12px 5px 0" : "5px 0";
  return `
    <tr>
      <td align="${rtl ? "right" : "left"}" style="padding:${gap};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td align="${rtl ? "right" : "left"}" style="padding:${last};font-size:13px;color:${INK};vertical-align:top;${mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;" : ""}">${escapeHtml(value) || "—"}</td>
    </tr>`;
}

function summaryCell(label: string, value: string) {
  return `
    <td width="50%" style="padding:0 6px 12px 0;vertical-align:top;">
      <div style="background:${CARD};border:1px solid ${LINE};border-radius:10px;padding:10px 12px;">
        <p style="margin:0;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};">${escapeHtml(label)}</p>
        <p style="margin:5px 0 0;font-size:14px;font-weight:700;color:${INK};">${escapeHtml(value)}</p>
      </div>
    </td>`;
}

function memberCard(team: StoredTeam, index: number, copy: EmailCopy, rtl: boolean) {
  const member = team.members[index];
  if (!member) return "";

  const isLeader = index === team.leaderIndex;
  const isCoach = member.role === "COACH";
  const answers = answersOf(member.requirements);

  const rows = [
    detailRow(copy.memberUniversity, member.universityName + (member.universityRegion ? ` · ${member.universityRegion}` : ""), false, rtl),
    /* No email address and no phone number.
     *
     * This message goes to the team leader, and the roster is here so the leader can
     * check it is right — university, student ID and Discord are enough for that, and
     * they are what the university and the tournament already identify a player by.
     * Reproducing every member's personal contact details onto one forwardable email
     * would hand a captain the ability to share four other people's phone numbers, for
     * no gain the leader does not already have by reading the form back. */
    !isCoach ? detailRow(copy.memberStudentId, member.studentId ?? "", true, rtl) : "",
    detailRow(copy.memberDiscord, member.discord, true, rtl),
    ...answers.map((answer) => detailRow(answer.label, answer.value, false, rtl)),
  ]
    .filter(Boolean)
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;background:${CARD};border:1px solid ${isLeader ? "#2f7d8c" : LINE};border-radius:12px;">
      <tr>
        <td style="padding:12px 14px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="${rtl ? "right" : "left"}" style="vertical-align:middle;">
                <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:7px;background:${isLeader ? CYAN : "#1d3d49"};color:${isLeader ? "#06212a" : MUTED};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;">${index + 1}</span>
                <span style="margin-${rtl ? "right" : "left"}:8px;font-size:14px;font-weight:700;color:${INK};">${escapeHtml(member.fullName)}</span>
                ${isLeader ? `<span style="margin-${rtl ? "right" : "left"}:8px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${CYAN};">${copy.teamLeader}</span>` : ""}
              </td>
              <td align="${rtl ? "left" : "right"}" style="vertical-align:middle;">
                <span style="display:inline-block;padding:2px 8px;border-radius:99px;border:1px solid ${LINE};color:${BODY};font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(roleLabel(member.role, copy))}</span>
              </td>
            </tr>
          </table>
          ${
            member.gameTag
              ? `<p style="margin:8px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${CYAN};">${escapeHtml(member.gameTag)}</p>`
              : ""
          }
        </td>
      </tr>
      <tr>
        <td style="padding:0 14px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td>
      </tr>
    </table>`;
}

/* -------------------------------------------------------------------------- */
/* The message                                                                */
/* -------------------------------------------------------------------------- */

export interface ConfirmationEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Build the confirmation.
 *
 * `logoSrc` is injected rather than hardcoded so the caller can decide between
 * the inline attachment (`cid:`, preferred) and a public URL (the fallback when
 * the image could not be loaded).
 */
export function buildConfirmationEmail(
  team: StoredTeam,
  options: { baseUrl: string; logoSrc?: string; language?: Language },
): ConfirmationEmail {
  const { baseUrl, logoSrc = appUrl(baseUrl, LOGO_PATH), language = DEFAULT_LANGUAGE } = options;

  const copy = emailCopy(language);
  const rtl = language === "ar";
  const dir = emailDirection(language);
  /* Arabic reads its own digits; a reference and a phone number stay LTR inside an
     RTL message, or the characters render in the wrong order. */
  const num = (value: string | number) => (rtl ? arabicDigits(value) : String(value));

  const leader = team.members[team.leaderIndex] ?? team.members[0];
  const division = team.gender === "female" ? copy.divisionFemale : copy.divisionMale;
  const submitted = formatSubmittedAt(team.createdAt, language);
  const universities = Array.from(new Set(team.members.map((member) => member.universityName)));

  const starters = team.members.filter((member) => member.role === "STARTER").length;
  const substitutes = team.members.filter((member) => member.role === "SUBSTITUTE").length;
  const coaches = team.members.filter((member) => member.role === "COACH").length;
  const composition = [
    starters === 1 ? copy.startersOne : fill(copy.startersMany, { count: num(starters) }),
    substitutes > 0
      ? substitutes === 1
        ? copy.subsOne
        : fill(copy.subsMany, { count: num(substitutes) })
      : null,
    coaches > 0
      ? coaches === 1
        ? copy.coachesOne
        : fill(copy.coachesMany, { count: num(coaches) })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rosterHtml = team.members
    .map((_, index) => memberCard(team, index, copy, rtl))
    .join("");

  const html = `<!doctype html>
<html lang="${language}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>${escapeHtml(fill(copy.subjectTeam, { team: team.teamName }))}</title>
  </head>
  <body dir="${dir}" style="margin:0;padding:0;background:${WALL};direction:${dir};">
    <!-- Preheader: the snippet clients show next to the subject. Hidden in the body. -->
    <div style="display:none;font-size:1px;color:${WALL};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${escapeHtml(fill("{reference} — {team} · {tournament}", { reference: team.reference, team: team.teamName, tournament: team.tournamentName }))}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background:${WALL};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#082330;border:1px solid ${LINE};border-radius:18px;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">

            <!-- Masthead -->
            <tr>
              <td align="center" style="padding:26px 24px 18px;">
                <img src="${escapeHtml(logoSrc)}" width="150" alt="${escapeHtml(team.tournamentName)}" style="display:block;width:150px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px;">
                <div style="height:3px;border-radius:99px;background:linear-gradient(90deg,#0f3a46,${CYAN},#0f3a46);"></div>
              </td>
            </tr>

            <!-- Headline -->
            <tr>
              <td style="padding:24px 24px 0;">
                <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${CYAN};">${copy.confirmed}</p>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;color:#ffffff;">${escapeHtml(team.teamName)}</h1>
                <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:${BODY};">
                  ${escapeHtml(fill(copy.confirmedLead, { tournament: team.tournamentName })).replace(escapeHtml(team.tournamentName), `<strong style="color:${INK};">${escapeHtml(team.tournamentName)}</strong>`)}
                </p>
              </td>
            </tr>

            <!-- Reference -->
            <tr>
              <td style="padding:20px 24px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px dashed #2f7d8c;border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:18px 16px;">
                      <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${MUTED};">${copy.referenceLabel}</p>
                      <p dir="ltr" style="margin:10px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:27px;font-weight:700;letter-spacing:0.14em;color:${CYAN};">${escapeHtml(team.reference)}</p>
                      <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
                        ${copy.referenceNote}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Summary -->
            <tr>
              <td style="padding:20px 24px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    ${summaryCell(copy.fieldGame, team.gameName)}
                    ${summaryCell(copy.fieldDivision, division)}
                  </tr>
                  <tr>
                    ${summaryCell(copy.fieldRoster, team.members.length === 1 ? copy.membersOne : fill(copy.membersMany, { count: num(team.members.length) }))}
                    ${summaryCell(copy.fieldSubmitted, submitted)}
                  </tr>
                </table>
                <p style="margin:0;font-size:12px;color:${MUTED};">${escapeHtml(composition)}</p>
              </td>
            </tr>

            <!-- Roster -->
            <tr>
              <td style="padding:26px 24px 0;">
                <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${CYAN};">${copy.rosterHeading}</p>
                ${rosterHtml}
              </td>
            </tr>

            <!-- Universities -->
            <tr>
              <td style="padding:14px 24px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:12px;">
                  <tr>
                    <td style="padding:12px 14px;">
                      <p style="margin:0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">
                        ${universities.length === 1 ? copy.universitiesOne : copy.universitiesMany}
                      </p>
                      <p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${INK};">${universities.map(escapeHtml).join("<br />")}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Next steps -->
            <tr>
              <td style="padding:22px 24px 0;">
                <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${CYAN};">${copy.nextHeading}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}">
                  ${[
                    escapeHtml(copy.nextOne),
                    boldAt(
                      copy.nextTwo,
                      "{leader}",
                      escapeHtml(leader?.fullName ?? ""),
                      INK,
                    ),
                    escapeHtml(copy.nextThree),
                  ]
                    .map(
                      (line) => `
                  <tr>
                    <td style="padding:0 0 8px;vertical-align:top;width:16px;color:${CYAN};font-size:13px;">&bull;</td>
                    <td style="padding:0 0 8px;font-size:13px;line-height:1.7;color:${BODY};">${line}</td>
                  </tr>`,
                    )
                    .join("")}
                </table>
              </td>
            </tr>

            <!-- Call to action -->
            <tr>
              <td align="center" style="padding:14px 24px 0;">
                <a href="${escapeHtml(appUrl(baseUrl, `/?tab=edit&lang=${language}`))}" style="display:inline-block;padding:13px 26px;border-radius:11px;background:${CYAN};color:#04222a;font-size:14px;font-weight:700;text-decoration:none;">${copy.editCta}</a>
                <p style="margin:10px 0 0;font-size:11px;color:${MUTED};">
                  ${fill(copy.openFrom, { host: "" }).trim().split("{host}")[0]}<a href="${escapeHtml(baseUrl)}" style="color:${CYAN};text-decoration:none;">${escapeHtml(baseUrl.replace(/^https?:\/\//, ""))}</a>
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:26px 24px 28px;">
                <div style="height:1px;background:${LINE};margin-bottom:16px;"></div>
                <p style="margin:0;font-size:11px;line-height:1.7;color:${MUTED};">
                  ${escapeHtml(team.tournamentName)} &middot; ${escapeHtml(copy.footer)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  /* Plain text is not an afterthought: some members will read this in a client
     that strips HTML, and a confirmation nobody can read is not a confirmation. */
  const textLines = [
    team.tournamentName,
    copy.textHeadingConfirmed,
    "",
    team.teamName,
    copy.textRecord,
    "",
    `${copy.textReferenceCode}: ${team.reference}`,
    "",
    `${copy.textGame}     : ${team.gameName}`,
    `${copy.textDivision} : ${division}`,
    `${copy.textRoster}   : ${num(team.members.length)} (${composition})`,
    `${copy.textSubmitted}: ${submitted}`,
    "",
    copy.textRosterHeading,
    "",
  ];

  team.members.forEach((member, index) => {
    const isLeader = index === team.leaderIndex;
    textLines.push(
      `${num(index + 1)}. ${member.fullName}${
        isLeader ? ` ${copy.textLeaderSuffix}` : ""
      } — ${roleLabel(member.role, copy)}`,
      `   ${copy.textUniversity} : ${member.universityName}${member.universityRegion ? ` · ${member.universityRegion}` : ""}`,
    );
    if (member.gameTag) textLines.push(`   ${copy.textGameTag}   : ${member.gameTag}`);
    if (member.studentId) textLines.push(`   ${copy.textStudentId} : ${member.studentId}`);
    textLines.push(`   ${copy.textDiscord}    : ${member.discord}`);
    for (const answer of answersOf(member.requirements)) {
      textLines.push(`   ${answer.label}: ${answer.value}`);
    }
    textLines.push("");
  });

  textLines.push(
    universities.length === 1 ? copy.textUniversitiesOne : copy.textUniversitiesMany,
    universities.join(", "),
    "",
    copy.nextHeading.toUpperCase(),
    `- ${copy.nextOne}`,
    `- ${fill(copy.nextTwo, { leader: leader?.fullName ?? "" })}`,
    `- ${copy.nextThree}`,
    "",
    `${copy.textEditLabel}: ${appUrl(baseUrl, `/?tab=edit&lang=${language}`)}`,
    "",
    copy.textRemovalNote,
  );

  return {
    subject: fill(copy.subjectTeam, { team: team.teamName }),
    html: minifyHtml(html),
    text: textLines.join("\n"),
  };
}

/**
 * Trim the HTML's indentation.
 *
 * Only the *leading* whitespace of each line is removed, replaced by a single
 * space. Deleting it outright would glue words together wherever a sentence
 * wraps across two lines in the template, which is most of them.
 *
 * The saving is a few kilobytes, but every kilobyte counts against Gmail's
 * 102 kB clipping threshold — which the embedded logo already dominates.
 */
function minifyHtml(html: string): string {
  return html.replace(/\n[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the brand mark so it can be attached inline.
 *
 * Read from disk first because that is what works locally, then over HTTP, which
 * is what works on Vercel — where `public/` is served by the CDN and is not
 * guaranteed to be on the function's filesystem. Cached for the life of the
 * instance: the file changes only on deploy.
 *
 * Never throws. A missing logo must not cost the team their confirmation.
 */
let logoCache: { content: Buffer } | null | undefined;

async function loadLogo(baseUrl: string): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache?.content ?? null;

  const shrink = async (bytes: Buffer) => {
    const { shrinkPng } = await import("./png");
    const resized = shrinkPng(bytes, EMAIL_LOGO_MAX_BYTES);
    if (resized.byteLength < bytes.byteLength) {
      console.info(
        `[mailer] email logo ${(bytes.byteLength / 1024).toFixed(0)} kB → ${(resized.byteLength / 1024).toFixed(0)} kB`,
      );
    }
    return resized;
  };

  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = await shrink(
      await readFile(join(process.cwd(), "public", LOGO_PATH.replace(/^\//, ""))),
    );
    logoCache = { content };
    return content;
  } catch {
    // Not on disk (the serverless case) — fall through to the network.
  }

  try {
    const response = await fetch(appUrl(baseUrl, LOGO_PATH), {
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const content = await shrink(Buffer.from(await response.arrayBuffer()));
    logoCache = { content };
    return content;
  } catch (error) {
    console.warn("[mailer] could not load the brand mark for email:", (error as Error).message);
    logoCache = null;
    return null;
  }
}

/**
 * Send the team their confirmation.
 *
 * The registration is already stored by the time this runs, so **nothing here
 * may throw**: a mail failure has to be reported, not turned into a failed
 * registration the player would try to submit again. Returns whether it went out.
 */
export async function sendRegistrationConfirmation(
  team: StoredTeam,
  baseUrl: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<boolean> {
  const leader = team.members[team.leaderIndex] ?? team.members[0];
  if (!leader?.email) {
    console.warn(`[mailer] ${team.reference} has no leader address; no confirmation sent`);
    return false;
  }

  if (!(await (await mailerConfigured("confirmation"))) && !(await mailerAllowsLogFallback("confirmation"))) {
    console.error(
      `[mailer] ${team.reference} registered but no confirmation was sent — the confirmation SMTP account is not configured.`,
    );
    return false;
  }

  try {
    const logo = await loadLogo(baseUrl);
    const { subject, html, text } = buildConfirmationEmail(team, {
      baseUrl,
      logoSrc: logo ? `cid:${LOGO_CID}` : undefined,
      language,
    });

    const outcome = await sendMail({
      to: leader.email,
      channel: "confirmation",
      subject,
      html,
      text,
      inline: logo
        ? [{ cid: LOGO_CID, filename: LOGO_FILENAME, content: logo, contentType: LOGO_CONTENT_TYPE }]
        : undefined,
    });

    if (outcome.logged) {
      console.warn(`[mailer] ${team.reference}: confirmation logged, not sent (logged=${outcome.logged})`);
    }

    return outcome.delivered;
  } catch (error) {
    console.error(`[mailer] confirmation for ${team.reference} failed:`, error);
    return false;
  }
}
