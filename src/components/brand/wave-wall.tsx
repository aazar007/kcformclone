"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The arena backdrop.
 *
 * **The wave bands are gone.** They were generated flame-like stripes meant to echo
 * the club artwork, but at any opacity that could be seen they read as a texture
 * competing with the form; at any opacity that did not compete, they were invisible.
 * The backdrop is now just the artwork's own gradient with a slow moving bright —
 * the surface carries the brand without drawing the eye away from the questions.
 *
 * The name is kept (`WaveWall`) so the twenty-odd call sites do not churn for a
 * rename; it is the page backdrop, whatever it is drawn from.
 *
 * The motion is a drifting highlight rather than a scrolling pattern: the light
 * travels across the top of the page, which reads as a lit arena rather than as an
 * animation. It is disabled outright under `prefers-reduced-motion`.
 */
export function WaveWall({ className }: { className?: string }) {
  /* Nothing here depends on state or the device, so it is a single static tree —
     no effects, no randomness, nothing to mismatch between server and client. */
  return (
    <div
      aria-hidden
      className={cn(
        /* No `bg-wall-900`: that flat fill was the dark band showing against the teal,
           and the gradient above already covers this layer completely. */
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {/* **The club artwork's own gradient, top to bottom.**
          The card is lit teal-blue at the top edge (#125067), darkens through #0B384D
          and #052635, and settles to near-black navy (#010C12) at the foot. Shared with
          the page canvas through `--arena-gradient`, so the two can never drift apart. */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: "var(--arena-gradient)" }}
      />

      {/* **The moving bright.**
          Two wide, soft lights with different periods, so their overlap never repeats
          on an obvious beat. Each is a `background-size: 200%` gradient whose
          `background-position` is animated — that moves the light itself across the
          surface, unlike a transform, which would carry the whole layer's edges with it
          and leave a visible seam. */}
      <div className="wall-light" />
      <div className="wall-light wall-light-late" />

      {/* Edge vignette, so the corners settle instead of competing with the centre. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(135% 125% at 50% 50%, transparent 58%, rgba(1,12,18,0.5) 100%)",
        }}
      />
    </div>
  );
}
