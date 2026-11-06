"use client";

import * as React from "react";

/** A character's box, in the coordinate space of the sentence's own border box. */
interface Glyph {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The visual line this character was painted on. */
  line: number;
}

/** One line of the sentence, in reading order. */
interface LineBox {
  index: number;
  top: number;
  bottom: number;
  /** Where reading starts and ends on this line — right-to-left flips these. */
  start: number;
  end: number;
  width: number;
  centerY: number;
}

/**
 * A leg of the crown's route.
 *
 * `line` travels along a line of text and reveals it; `hop` carries the mark from the
 * end of one line to the start of the next and reveals nothing. Modelling the gap as
 * a leg of its own is what stops the crown teleporting diagonally when a sentence
 * wraps.
 */
type Leg =
  | { kind: "line"; line: LineBox; length: number }
  | { kind: "hop"; length: number; fromX: number; fromY: number; toX: number; toY: number };

interface Route {
  lines: LineBox[];
  legs: Leg[];
  total: number;
  width: number;
  height: number;
}

/** Where the crown is, and how much of each line has been uncovered. */
interface Pose {
  x: number;
  y: number;
  reveal: Map<number, number>;
}

/** How long the whole sweep takes. Long enough to read as a glide, short enough not to drag. */
const DURATION_MS = 2600;

/** Width of the soft band at the leading edge, in CSS pixels. */
const FEATHER_PX = 34;

/**
 * The headline, uncovered by the spinning crown.
 *
 * The sentence starts hidden; a crown glides across it and the words are uncovered in
 * one continuous movement. It runs left→right in English and right→left in Arabic.
 *
 * **Why the text is never split.** Arabic joins letters contextually — كوّن is not the
 * four separate glyphs ك و ّ ن, it is one shaped run. Rendering each letter as its own
 * element re-shapes and un-joins every word. So the sentence is painted **once,
 * whole**, and the reveal is a mask over that finished paint: shaping, kerning and the
 * chrome gradient are computed a single time and only the visible region changes.
 *
 * **Why the mask is measured per character.** A single rectangular edge moves as one
 * straight line, so on a wrapped headline it would cut the second line at the same x
 * as the first — the last words appearing before the middle ones. The characters are
 * measured instead (with a `Range`, which reads where each was painted without
 * touching the DOM), grouped into lines, and the mask becomes one soft-edged gradient
 * per line. Each line's edge is a *fraction*, not a whole number of letters, so the
 * reveal is continuous: no stepping, no pauses between letters.
 *
 * **Why it stays smooth.** Everything is precomputed once into a route: the per-frame
 * work is arithmetic over cached numbers, a single transform on the crown, and one
 * mask string. Nothing reads layout, mutates the DOM tree, or triggers a re-render, so
 * the sentence never reflows and revealed letters never move.
 *
 * **Progressive enhancement.** The CSS default is the finished sentence with the crown
 * hidden. This component hides it before the first paint, so a reader without
 * JavaScript — or before hydration — still gets the headline.
 */
export function CrownReveal({
  text,
  /** Which way the crown travels. Passed in rather than read from `<html dir>`. */
  rtl = false,
  className,
}: {
  text: string;
  rtl?: boolean;
  className?: string;
}) {
  const host = React.useRef<HTMLSpanElement>(null);
  const clip = React.useRef<HTMLSpanElement>(null);
  const mark = React.useRef<HTMLSpanElement>(null);
  const textNode = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const hostEl = host.current;
    const clipEl = clip.current;
    const markEl = mark.current;
    const textEl = textNode.current;
    if (!hostEl || !clipEl || !markEl || !textEl) return;

    /** Put the sentence back to a known state, with no crown. */
    const restore = (visible: boolean) => {
      applyMask(clipEl, visible ? "none" : "linear-gradient(transparent, transparent)");
      delete hostEl.dataset.animating;
    };

    /*
     * The hidden state is already on screen — a script in `<head>` set it before the
     * first paint, so there is no flash of the whole sentence to undo here. This only
     * has to decide whether to animate, and hand the sentence over to the mask.
     */
    const page = document.documentElement;

    /* Reduced motion: the CSS default is the finished sentence with no crown. The
       pre-paint script has already recorded that, so nothing else is needed. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      page.setAttribute("data-crown", "done");
      applyMask(clipEl, "none");
      return;
    }

    /* Close the mask first, then drop the pre-paint opacity rule in the same frame.
       Writing the mask before flipping the attribute is what keeps the handoff
       invisible: the browser never gets a chance to paint the sentence unmasked. */
    restore(false);
    page.setAttribute("data-crown", "run");

    /* Geometry, cached. A cold load paints the fallback face first, so the route is
       rebuilt when the webfonts settle — see `fontsReady` below. */
    let route: Route | null = null;
    let halfWidth = 0;
    let halfHeight = 0;
    let fontSize = 16;

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const fontsReady = fonts ? fonts.ready.catch(() => undefined) : Promise.resolve();

    const measure = () => {
      const { width, height } = textEl.getBoundingClientRect();
      const glyphs = measureGlyphs(textEl);
      route = buildRoute(glyphs, width, height, rtl);
      if (!route) return false;

      /* The crown's own box, so it can be centred on the reveal edge with a transform
         rather than by writing `left`/`top` (which would cost layout every frame). */
      fontSize = Number.parseFloat(window.getComputedStyle(textEl).fontSize) || 16;
      halfWidth = halfWidthFor(fontSize);
      halfHeight = fontSize / 2;
      return true;
    };

    let frame = 0;
    let started = 0;

    const draw = (pose: Pose) => {
      if (!route) return;

      /* --- the sentence ---
         The `mask` **shorthand** is what carries the per-layer position and size. The
         `mask-image` longhand takes images only, so a value with `0 -6px / 900px 90px`
         in it is discarded outright and nothing moves. */
      if (!route.lines.some((line) => (pose.reveal.get(line.index) ?? 0) < 1)) {
        /* Every line is whole: drop the mask entirely. A mask that still covers the
           full box leaves an antialiasing seam along its edge in some browsers. */
        applyMask(clipEl, "none");
      } else {
        applyMask(clipEl, buildMask(route, pose, rtl));
      }

      /* --- the crown ---
         Kept most of its own width ahead of the edge, in the direction of travel, so
         the mark sits over the words that are *about* to appear. That is what makes the
         movement read as uncovering; centred exactly on the edge it looked like it was
         chasing the letters, and the ones it had just passed stayed half-hidden under
         the artwork. */
      const lead = rtl ? -halfWidth * 0.85 : halfWidth * 0.85;
      markEl.style.transform = `translate3d(${(pose.x + lead - halfWidth).toFixed(2)}px, ${(
        pose.y - halfHeight
      ).toFixed(2)}px, 0)`;
    };

    const step = (now: number) => {
      if (!started) started = now;
      const t = Math.min(1, (now - started) / DURATION_MS);
      /* Ease-in-out: the mark gathers speed, crosses, and settles. A linear run looks
         mechanical, and an ease-out alone starts with a jerk. */
      const p = easeInOutCubic(t);

      if (route) draw(locate(route, t >= 1 ? route.total + 1 : p * route.total));

      if (t < 1) {
        frame = requestAnimationFrame(step);
        return;
      }

      /* Finished. The crown fades out through CSS; the sentence stays whole. */
      delete hostEl.dataset.animating;
      page.setAttribute("data-crown", "done");
    };

    const begin = () => {
      if (!measure()) {
        /* Nothing measurable (an empty sentence, or a layout the browser will not
           measure yet): leave the sentence visible rather than blank. */
        restore(true);
        return;
      }
      hostEl.dataset.animating = "true";
      frame = requestAnimationFrame(step);
    };

    /*
     * A change of size moves every character, so the route is rebuilt.
     *
     * `ResizeObserver` and not just `window.resize`: on a phone the headline can rewrap
     * *without* the window changing — the webfont swapping in, or a scrollbar appearing
     * and taking fifteen pixels. Measured boxes from before that rewrap would put the
     * mask on the wrong letters, which is exactly the kind of half-drawn frame this is
     * here to avoid. Re-measuring costs nothing until it actually happens.
     */
    const remeasure = () => {
      if (!route) return;

      const elapsed = started ? performance.now() - started : 0;
      const progress = elapsed / DURATION_MS;

      if (!measure()) return;

      /*
       * Barely started: start the clock again instead of moving the mark to a new
       * set of coordinates.
       *
       * A rewrap in the first fraction of a second is routine — the webfont swapping
       * in, or a scrollbar taking fifteen pixels — and the new line boxes put the crown
       * hundreds of pixels from where it was. Repositioning it mid-flight is a visible
       * teleport; restarting when almost nothing has been revealed is not visible at
       * all, and the sweep then measures true from the first frame.
       */
      if (progress < 0.35) {
        cancelAnimationFrame(frame);
        started = performance.now();
        frame = requestAnimationFrame(step);
        return;
      }

      /* Well into the sweep (a rotation, a window resize): keep the progress, redraw
         from the new geometry at once so the mask is never stale. */
      if (frame) {
        const t = Math.min(1, progress);
        draw(locate(route!, t >= 1 ? route!.total + 1 : easeInOutCubic(t) * route!.total));
      }
    };

    window.addEventListener("resize", remeasure, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => remeasure());
      observer.observe(textEl);
    }

    /* Start now. The requirement is that the sweep begins as soon as the homepage is
       on screen — no waiting for a scroll, an interaction, or a font swap. */
    begin();

    /*
     * Metrics are only provisional until the webfont lands: a cold load lays the
     * sentence out in the fallback face first, so the boxes measured a moment ago
     * describe glyphs that are about to move. `remeasure` rebuilds the route (and
     * restarts the clock while almost nothing has been revealed, so the correction is
     * invisible) — it is here rather than gating the start, because a gate would be
     * exactly the delay this is meant to avoid.
     */
    void fontsReady.then(remeasure);

    return () => {
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rtl]);

  return (
    <span
      ref={host}
      data-dir={rtl ? "rtl" : "ltr"}
      className={className ? `crown-reveal ${className}` : "crown-reveal"}
    >
      <span ref={clip} className="crown-reveal-clip">
        {/* The whole sentence, painted once. */}
        <span ref={textNode} className="crown-reveal-text chrome-text">
          {text}
        </span>
      </span>

      {/* Decorative: the sentence is the content. The wrapper carries the transform, so
          the glow and the artwork move as one composited layer. The WebP is already an
          animated crown, so its own motion continues while it travels. */}
      <span ref={mark} className="crown-reveal-mark" aria-hidden="true">
        <span className="crown-reveal-glow" />
        <img
          src="/crown-spin.webp?v=4"
          alt=""
          width={720}
          height={480}
          className="crown-reveal-crown"
          draggable={false}
        />
      </span>
    </span>
  );
}

/** Write a mask, prefixed and unprefixed. The shorthand sets position and size too. */
function applyMask(el: HTMLElement, value: string) {
  el.style.mask = value;
  el.style.setProperty("-webkit-mask", value);
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Half the mark's rendered width.
 *
 * The artwork is 3:2 and drawn one `em` tall (see the stylesheet), so it is 1.5em wide.
 * Deriving it from the font size keeps this correct if the stylesheet's size changes.
 */
function halfWidthFor(fontSize: number): number {
  return (fontSize * 1.5) / 2;
}

/**
 * Every visible character's box, in the coordinate space of `textEl`.
 *
 * A `Range` reads where a character was painted without splitting it out of the run,
 * so joined scripts keep the glyphs the font actually chose.
 */
function measureGlyphs(textEl: HTMLElement): Glyph[] {
  const node = textEl.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];

  const box = textEl.getBoundingClientRect();
  const range = document.createRange();
  const length = node.textContent?.length ?? 0;
  const found: Omit<Glyph, "line">[] = [];

  for (let index = 0; index < length; index += 1) {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    /* A zero-size rect is a control character or a collapsed space: there is nothing
       to reveal, so it must not consume part of the route. */
    if (rect.width === 0 && rect.height === 0) continue;

    found.push({
      left: rect.left - box.left,
      right: rect.right - box.left,
      top: rect.top - box.top,
      bottom: rect.bottom - box.top,
    });
  }

  const lineOf = (glyph: { top: number; bottom: number }) =>
    Math.round((glyph.top + glyph.bottom) / 2 / 4);

  return found.map((glyph) => ({ ...glyph, line: lineOf(glyph) }));
}

/** Group the glyphs into lines and turn them into one continuous route. */
function buildRoute(
  glyphs: Glyph[],
  width: number,
  height: number,
  rtl: boolean,
): Route | null {
  if (glyphs.length === 0 || width <= 0 || height <= 0) return null;

  const groups = new Map<number, Glyph[]>();
  for (const glyph of glyphs) {
    const group = groups.get(glyph.line);
    if (group) group.push(glyph);
    else groups.set(glyph.line, [glyph]);
  }

  const lines: LineBox[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group], index) => {
      const left = Math.min(...group.map((glyph) => glyph.left));
      const right = Math.max(...group.map((glyph) => glyph.right));
      const top = Math.min(...group.map((glyph) => glyph.top));
      const bottom = Math.max(...group.map((glyph) => glyph.bottom));

      return {
        index,
        top,
        bottom,
        /* Right-to-left reads from the right edge of the line, so the route starts
           there and runs back the other way. */
        start: rtl ? right : left,
        end: rtl ? left : right,
        width: Math.max(0, right - left),
        centerY: (top + bottom) / 2,
      };
    })
    .filter((line) => line.width > 0.5);

  if (lines.length === 0) return null;

  const legs: Leg[] = [];
  let total = 0;

  lines.forEach((line, index) => {
    if (index > 0) {
      const previous = lines[index - 1];
      const fromX = previous.end;
      const fromY = previous.centerY;
      const toX = line.start;
      const toY = line.centerY;
      const length = Math.hypot(toX - fromX, toY - fromY);
      legs.push({ kind: "hop", length, fromX, fromY, toX, toY });
      total += length;
    }

    legs.push({ kind: "line", line, length: line.width });
    total += line.width;
  });

  return { lines, legs, total: Math.max(total, 1), width, height };
}

/** Where the crown is, and how much of each line it has uncovered, at a given distance. */
function locate(route: Route, distance: number): Pose {
  const reveal = new Map<number, number>();
  const last = route.lines[route.lines.length - 1];
  const first = route.lines[0];

  let remaining = Math.max(0, Math.min(distance, route.total));
  let x = first.start;
  let y = first.centerY;

  /* Half a pixel of slack on every comparison. The last frame asks for exactly
     `route.total`, but summing floating-point leg lengths lands a hair short of it —
     which used to leave the final letter 0.02% unrevealed while the crown faded out,
     so the sentence finished visibly incomplete. */
  const EPS = 0.5;

  for (const leg of route.legs) {
    if (leg.kind === "line") {
      if (remaining >= leg.length - EPS) {
        reveal.set(leg.line.index, 1);
        remaining -= leg.length;
        x = leg.line.end;
        y = leg.line.centerY;
        continue;
      }

      /* A fraction, not a count of letters: the edge lands between glyphs and the
         crown sits exactly on it. */
      const t = leg.length > 0 ? remaining / leg.length : 1;
      reveal.set(leg.line.index, t);
      x = leg.line.start + (leg.line.end - leg.line.start) * t;
      y = leg.line.centerY;
      return { x, y, reveal };
    }

    if (remaining >= leg.length - EPS) {
      remaining -= leg.length;
      x = leg.toX;
      y = leg.toY;
      continue;
    }

    const t = leg.length > 0 ? remaining / leg.length : 1;
    x = leg.fromX + (leg.toX - leg.fromX) * t;
    y = leg.fromY + (leg.toY - leg.fromY) * t;
    return { x, y, reveal };
  }

  return { x: last.end, y: last.centerY, reveal };
}

/**
 * A mask that uncovers exactly what the crown has passed.
 *
 * One soft-edged gradient per line: opaque where the line has been read, feathered over
 * the last few pixels so a letter fades in rather than snapping on, and transparent
 * ahead of the mark. Layers are additive by default, and each is positioned over its
 * own line, so a wrapped headline reveals line by line without cutting across.
 */
function buildMask(route: Route, pose: Pose, rtl: boolean): string {
  const layers: string[] = [];

  for (const line of route.lines) {
    const fraction = pose.reveal.get(line.index) ?? 0;
    if (fraction <= 0) continue;

    const revealed = line.width * fraction;
    const edgeX = rtl ? line.start - revealed : line.start + revealed;

    /* Distance from the side the gradient starts on: the left for English, the right
       for Arabic. */
    const fromOrigin = rtl ? route.width - edgeX : edgeX;
    const feather = Math.min(FEATHER_PX, Math.max(6, line.width * 0.3));

    const fadeStart = Math.max(0, fromOrigin - feather);
    const stop = Math.min(route.width, fromOrigin);

    const a = ((fadeStart / route.width) * 100).toFixed(2);
    const b = ((stop / route.width) * 100).toFixed(2);

    const top = `${Math.round(line.top - 6)}px`;
    const size = `${Math.ceil(route.width)}px ${Math.ceil(line.bottom - line.top + 12)}px`;

    layers.push(
      `linear-gradient(${rtl ? "270deg" : "90deg"}, #000 0, #000 ${a}%, transparent ${b}%) 0 ${top} / ${size} no-repeat`,
    );
  }

  if (layers.length === 0) return "linear-gradient(transparent, transparent)";
  return layers.join(", ");
}
