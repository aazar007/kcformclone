/**
 * The prize money on offer, added up.
 *
 * A game's prize pool is free text — "10,000 SAR", "Gaming PC + 5,000 SAR", "Trophy
 * only" — because the organisers announce prizes the way they want them read, not the
 * way a database column would prefer. That makes a total a reading problem rather than
 * an arithmetic one, and this file is deliberately narrow about what it will claim:
 *
 *   - the **largest** number in a string is the prize. Anything smaller is a placement
 *     ("1st", "2nd") or a fragment, and adding those would inflate the headline;
 *   - a game that publishes no figure contributes nothing, and is not counted. "Trophy
 *     only" is a real prize that cannot be summed, so it is left out rather than
 *     counted as zero;
 *   - the unit is whatever the organisers wrote after the number ("SAR", "ريال"). When
 *     two games are described in different units the unit is dropped, because
 *     "55,000 SAR" and "55,000 ريال" are the same money but "55,000 SAR + 20,000 ريال,
 *     total 75,000" would be a wrong claim.
 *
 * Nothing here rounds or guesses. A pool it cannot read is a pool it does not count.
 */

import { toWesternDigits } from "./i18n";

export interface PrizeTotal {
  /** The sum of every readable pool. */
  amount: number;
  /** "SAR", "ريال" — empty when the organisers wrote none, or wrote two different ones. */
  unit: string;
  /** How many games contributed a figure. */
  games: number;
  /** What to print: "55,000 SAR", or "55,000" when there is no agreed unit. */
  display: string;
}

/** The largest number written in a string, or null when it holds none. */
function largestFigure(text: string): number | null {
  /* Arabic-Indic digits are converted first: `١٠٠٠٠` is a number the organisers typed,
     and a total that silently skipped it would be wrong on the Arabic page only. */
  const western = toWesternDigits(text);
  const groups = western.match(/\d[\d.,]*/g) ?? [];
  const values = groups
    .map((group) => Number(group.replace(/[^\d]/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : null;
}

/** The unit written after the figure — "SAR", "ريال" — or empty. */
function unitOf(text: string): string {
  const western = toWesternDigits(text);
  const tail = western.match(/([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s]*)$/);
  const unit = tail?.[1].trim() ?? "";
  /* A "unit" longer than a dozen characters is a sentence that happened to end in
     letters, not a currency. Better no unit than "SAR and a gaming PC prize". */
  return unit.length <= 12 ? unit : "";
}

export function totalPrizePool(
  games: readonly { prizePool?: string | null }[],
): PrizeTotal | null {
  let amount = 0;
  let gamesCounted = 0;
  let unit = "";
  let mixedUnits = false;

  for (const game of games) {
    const pool = game.prizePool?.trim();
    if (!pool) continue;

    const figure = largestFigure(pool);
    if (figure === null) continue;

    amount += figure;
    gamesCounted += 1;

    const found = unitOf(pool);
    if (!unit) unit = found;
    else if (found && found !== unit) mixedUnits = true;
  }

  if (gamesCounted === 0) return null;

  const formatted = new Intl.NumberFormat("en-US").format(amount);
  const shared = mixedUnits ? "" : unit;

  return {
    amount,
    unit: shared,
    games: gamesCounted,
    display: shared ? `${formatted} ${shared}` : formatted,
  };
}
