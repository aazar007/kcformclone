"use client";

import * as React from "react";
import { cn, mulberry32 } from "@/lib/utils";

/**
 * The arena wall from the club identity.
 *
 * Organic flame-like bands flowing top to bottom, drawn as closed SVG paths from
 * a deterministic RNG so the artwork is identical on every render and between
 * server and client. Bands are split into "lit" and "shaded" groups, matching
 * the sampled palette (#3D444B highlights over a #243035 wall with #1D2327
 * shaded stripes).
 */

const VIEW_W = 1440;
const VIEW_H = 900;
const BAND_COUNT = 17;
const SAMPLE_STEP = 16;

interface Band {
  d: string;
  opacity: number;
  lit: boolean;
}

function buildBands(): Band[] {
  const rand = mulberry32(0x4b535543); // "KSUC"
  const bands: Band[] = [];

  for (let i = 0; i < BAND_COUNT; i++) {
    const slot = VIEW_W / BAND_COUNT;
    const baseX = (i + 0.5) * slot + (rand() - 0.5) * slot * 0.82;
    const width = 16 + rand() * 58;

    // Three stacked sine waves keep each band organic rather than mechanical.
    const c1 = 0.55 + rand() * 0.85;
    const c2 = 1.3 + rand() * 1.7;
    const c3 = 2.1 + rand() * 2.5;
    const a1 = 26 + rand() * 58;
    const a2 = 8 + rand() * 26;
    const a3 = 6 + rand() * 20;
    const p1 = rand() * Math.PI * 2;
    const p2 = rand() * Math.PI * 2;
    const p3 = rand() * Math.PI * 2;

    // Bands narrow toward both edges so the wall fades out rather than cutting off.
    const pinch = 0.45 + rand() * 0.5;

    const centerAt = (y: number) =>
      baseX +
      a1 * Math.sin((c1 * Math.PI * 2 * y) / VIEW_H + p1) +
      a2 * Math.sin((c2 * Math.PI * 2 * y) / VIEW_H + p2);

    const halfAt = (y: number) => {
      const edge = Math.sin((Math.PI * y) / VIEW_H) ** 0.42;
      const wobble = 1 + 0.42 * Math.sin((c3 * Math.PI * 2 * y) / VIEW_H + p3);
      return (width / 2) * wobble * (pinch + (1 - pinch) * edge);
    };

    const left: string[] = [];
    const right: string[] = [];
    for (let y = 0; y <= VIEW_H; y += SAMPLE_STEP) {
      left.push(`${(centerAt(y) - halfAt(y)).toFixed(1)} ${y}`);
      right.push(`${(centerAt(y) + halfAt(y)).toFixed(1)} ${y}`);
    }
    right.reverse();

    bands.push({
      d: `M ${left[0]} L ${left.slice(1).join(" L ")} L ${right.join(" L ")} Z`,
      opacity: 0.5 + rand() * 0.45,
      lit: rand() > 0.4,
    });
  }

  return bands;
}

export function WaveWall({ className }: { className?: string }) {
  const bands = React.useMemo(buildBands, []);
  const lit = React.useMemo(() => bands.filter((b) => b.lit), [bands]);
  const shaded = React.useMemo(() => bands.filter((b) => !b.lit), [bands]);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-wall-700",
        className,
      )}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {/* shaded stripes cut into the wall */}
        <g fill="#1a2024">
          {shaded.map((band, index) => (
            <path key={`d${index}`} d={band.d} opacity={band.opacity} />
          ))}
        </g>
        {/* lit bands catching the light */}
        <g fill="#3d444b">
          {lit.map((band, index) => (
            <path key={`l${index}`} d={band.d} opacity={band.opacity * 0.85} />
          ))}
        </g>
      </svg>

      {/* cyan ambience from the wordmark */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(1100px 620px at 18% -8%, rgba(92,240,247,0.14), transparent 62%), radial-gradient(900px 560px at 88% 6%, rgba(103,254,254,0.09), transparent 66%)",
        }}
      />
      {/* edge vignette — kept light so the wall texture still reads */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(135% 125% at 50% 50%, transparent 58%, rgba(14,20,23,0.5) 100%)",
        }}
      />
    </div>
  );
}
