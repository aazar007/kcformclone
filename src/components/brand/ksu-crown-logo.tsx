"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Chrome crown from the KSU Crown identity.
 *
 * **No longer used by the UI** — the official artwork in `public/ksu-crown-logo.png`
 * replaced it as the brand mark, so nothing renders this any more. It is kept
 * because this project has no version control to recover it from, and it is a
 * self-contained, hand-authored asset that costs nothing to leave in place.
 * Delete it once you are certain the PNG is the mark you want.
 *
 * Rebuilt as SVG so it stays crisp at any size and reads correctly on the dark
 * arena wall — a polished metal body with a bright specular sweep, matching the
 * sampled chrome ramp (#FFFFFF → #E4EBF1 → #BAC6D2 → #7E8B99).
 */
export function ChromeCrown({ className }: { className?: string }) {
  const uid = React.useId().replace(/:/g, "");
  const body = `body-${uid}`;
  const edge = `edge-${uid}`;
  const plate = `plate-${uid}`;
  const glow = `glow-${uid}`;

  return (
    <svg viewBox="0 0 132 108" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="18%" stopColor="#eef4f8" />
          <stop offset="46%" stopColor="#bac6d2" />
          <stop offset="58%" stopColor="#8d9aa8" />
          <stop offset="74%" stopColor="#d7e2ea" />
          <stop offset="100%" stopColor="#f7fbfd" />
        </linearGradient>
        <linearGradient id={plate} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f9fc" />
          <stop offset="35%" stopColor="#c3cfda" />
          <stop offset="62%" stopColor="#7e8b99" />
          <stop offset="100%" stopColor="#e9f1f6" />
        </linearGradient>
        <linearGradient id={edge} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b98a6" />
          <stop offset="100%" stopColor="#5d6a78" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.35" r="0.65">
          <stop offset="0%" stopColor="#67fefe" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#67fefe" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* cyan bloom behind the metal */}
      <ellipse cx="66" cy="46" rx="52" ry="40" fill={`url(#${glow})`} />

      {/* crown body: three peaks with ball finials */}
      <path
        d="M16 88 L21 32 L42 56 L66 16 L90 56 L111 32 L116 88 Z"
        fill={`url(#${body})`}
        stroke={`url(#${edge})`}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {/* band across the base */}
      <rect
        x="13"
        y="85"
        width="106"
        height="17"
        rx="7"
        fill={`url(#${plate})`}
        stroke={`url(#${edge})`}
        strokeWidth="2.4"
      />
      {/* recessed line that reads as the engraved band */}
      <path d="M20 94 H112" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" strokeLinecap="round" />

      {/* ball tips */}
      <circle cx="21" cy="28" r="7" fill={`url(#${body})`} stroke={`url(#${edge})`} strokeWidth="2" />
      <circle cx="66" cy="12" r="8" fill={`url(#${body})`} stroke={`url(#${edge})`} strokeWidth="2" />
      <circle cx="111" cy="28" r="7" fill={`url(#${body})`} stroke={`url(#${edge})`} strokeWidth="2" />
      <circle cx="42" cy="52" r="5.5" fill={`url(#${body})`} stroke={`url(#${edge})`} strokeWidth="1.8" />
      <circle cx="90" cy="52" r="5.5" fill={`url(#${body})`} stroke={`url(#${edge})`} strokeWidth="1.8" />

      {/* specular highlights */}
      <path
        d="M24 80 L28 40 L41 58 L54 30"
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M78 30 L91 58 L104 40 L108 80"
        fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="63" cy="9" r="2.6" fill="rgba(255,255,255,0.95)" />
      <circle cx="64" cy="88" r="1.6" fill="rgba(255,255,255,0.8)" />
    </svg>
  );
}

export type LogoSize = "sm" | "md" | "lg";

/**
 * The official championship artwork, served from `public/`.
 *
 * Replace this one file to rebrand the whole site — the mark appears in the
 * registration header, the success screen, the closed panel, the admin console
 * and the organiser gate. It is 496×286 with a transparent background, so it
 * composites over the arena wall without a plate behind it.
 */
export const BRAND_LOGO_SRC = "/ksu-crown-logo.png";

const MARK_SIZE: Record<LogoSize, string> = {
  sm: "h-8",
  md: "h-14",
  lg: "h-20 sm:h-24",
};

/**
 * The brand mark on its own, with no text and no container.
 *
 * Left unwrapped so each caller can decide how it sits: the form header centres
 * it, the sidebar tucks it next to a line of copy.
 */
export function KsuCrownMark({
  size = "lg",
  className,
  alt = "",
}: {
  size?: LogoSize;
  className?: string;
  alt?: string;
}) {
  return (
    // A plain <img> rather than next/image: the file is served from /public at a
    // fixed size, so there is nothing for the optimiser to do.
    <img
      src={BRAND_LOGO_SRC}
      alt={alt}
      width={496}
      height={286}
      className={cn("w-auto object-contain", MARK_SIZE[size], className)}
    />
  );
}

/**
 * The header lockup: the brand mark, with the configurable tagline beneath it.
 *
 * The artwork already carries the tournament's name, so there is no wordmark
 * text here — the `name` prop only feeds the accessible label and the page
 * title. Renaming the tournament therefore does not redraw this logo; supply a
 * new `BRAND_LOGO_SRC` if the name changes.
 */
export function TournamentLogo({
  name,
  tagline,
  size = "lg",
  className,
}: {
  name: string;
  tagline?: string;
  size?: LogoSize;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <KsuCrownMark
        size={size}
        alt={`${name} logo`}
        className="drop-shadow-[0_12px_30px_rgba(0,0,0,0.55)]"
      />

      {tagline && (
        <p className="mt-3 text-center text-[10px] font-bold tracking-[0.42em] text-ash/90 uppercase sm:text-xs">
          {tagline}
        </p>
      )}
    </div>
  );
}

/** Kept for the parts of the UI that always show the club identity. */
export function KsuCrownLogo({
  size = "lg",
  className,
  subtitle,
}: {
  size?: LogoSize;
  className?: string;
  subtitle?: string;
}) {
  return <TournamentLogo name="KSU Crown" tagline={subtitle} size={size} className={className} />;
}
