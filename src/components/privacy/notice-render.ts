/**
 * Render the organisers' privacy notice.
 *
 * The markup is deliberately tiny — `##` for a heading, a line for a paragraph,
 * `**bold**`, and `{{tournament}}` — because the people editing it are tournament
 * organisers, not developers. Anything richer would need a preview to be usable,
 * and anything less would not produce a readable page.
 *
 * Rendered as React elements rather than injected HTML, so a notice containing
 * `<script>` is displayed as text. The notice is organiser-authored, but it is
 * shown to every entrant, and "trusted because the author is an admin" is how
 * stored-XSS bugs get shipped.
 */

export interface NoticeSection {
  title: string;
  paragraphs: string[];
}

/** Split a notice into sections. Text before the first `##` is a lead-in. */
export function parseNotice(raw: string): { lead: string[]; sections: NoticeSection[] } {
  const lead: string[] = [];
  const sections: NoticeSection[] = [];
  let current: NoticeSection | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("##")) {
      const title = line.replace(/^#+/, "").trim();
      current = { title: title || "Section", paragraphs: [] };
      sections.push(current);
      continue;
    }

    if (current) current.paragraphs.push(line);
    else lead.push(line);
  }

  return { lead, sections };
}

/**
 * Replace `{{tournament}}` and friends.
 *
 * Doing this at render time rather than when saving means a notice keeps working
 * after the tournament is renamed, instead of quietly naming the old one.
 */
export function fillNoticeTokens(text: string, tournamentName: string): string {
  return text.replace(/\{\{\s*tournament\s*\}\}/gi, tournamentName);
}

/**
 * Split a paragraph into plain runs and bold runs.
 *
 * `**text**` becomes bold. Unterminated markers are left as literal text rather
 * than swallowing the rest of the line — a half-typed marker while editing should
 * look wrong, not eat the paragraph.
 */
export function splitEmphasis(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf("**");
    if (open === -1) {
      parts.push({ text: rest, bold: false });
      break;
    }
    const close = rest.indexOf("**", open + 2);
    if (close === -1) {
      // Unmatched marker: keep it visible.
      parts.push({ text: rest, bold: false });
      break;
    }

    if (open > 0) parts.push({ text: rest.slice(0, open), bold: false });
    parts.push({ text: rest.slice(open + 2, close), bold: true });
    rest = rest.slice(close + 2);
  }

  return parts.filter((part) => part.text.length > 0);
}
