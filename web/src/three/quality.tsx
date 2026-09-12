import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";

/**
 * Quality that adapts to the machine it is running on.
 *
 * The room was built and checked on a discrete GPU and shipped at roughly ten frames a
 * second on an Intel UHD laptop -- which is what most people actually have. Rather than
 * pick one setting and hope, the scene measures its own frame time and steps down until
 * it can hold the target, stepping back up when it has headroom.
 *
 * The order the tiers give things up matters. Resolution goes first: on an integrated GPU
 * this is a fill-rate problem, and every full-screen pass costs pixels squared. Antialias
 * sampling goes next. The look -- bloom, grain, vignette, the warm grade -- is given up
 * last, and only on hardware that cannot render the room at all otherwise.
 */

export interface QualityTier {
  name: "high" | "medium" | "low";
  /** Render scale. The single biggest lever on an integrated GPU. */
  dpr: number;
  /** MSAA samples on the post-processing render target. */
  multisampling: number;
  /** Bloom blur kernel. The grade never switches off -- see the note on TIERS. */
  bloom: "large" | "small";
  /** Shadow map resolution for the key light. */
  shadowMap: number;
}

/**
 * Every tier keeps the filmic grade.
 *
 * The lowest tier originally dropped the EffectComposer entirely. Unmounting it at
 * runtime leaves the canvas black -- the room was still rendering at 23fps behind a
 * blank screen. Beyond the bug, dropping it was the wrong lever: bloom on an already
 * tone-mapped frame is a fraction of what a full-resolution render costs, and the grade
 * is most of what makes this room look like a room. Resolution and antialias sampling
 * carry the whole adaptation instead.
 */
export const TIERS: QualityTier[] = [
  { name: "high", dpr: 1.5, multisampling: 4, bloom: "large", shadowMap: 2048 },
  { name: "medium", dpr: 1.1, multisampling: 0, bloom: "large", shadowMap: 1024 },
  { name: "low", dpr: 0.8, multisampling: 0, bloom: "small", shadowMap: 1024 },
];

/** 60fps is 16.7ms. Stepping down above 21ms keeps a margin rather than chasing the edge. */
const DECLINE_MS = 21;
/** Only climb back up with real headroom, or the tier oscillates once per second. */
const INCLINE_MS = 12;
const SAMPLE_MS = 900;
/**
 * A window with fewer frames than this is not evidence about the GPU.
 *
 * requestAnimationFrame is throttled to roughly 2fps in a hidden or backgrounded tab, and
 * suspended entirely in some embedded views. Measured naively that is a 500ms frame, and
 * the governor concludes the machine cannot cope. document.hidden catches most of it, but
 * not the window that straddles the moment the page is hidden -- which is exactly when a
 * load happens behind another window.
 */
const MIN_FRAMES = 6;
/** Above this, the frame did not happen: it was throttled, paused, or the tab was away. */
const IMPLAUSIBLE_MS = 250;

export const PERF_ENABLED = new URLSearchParams(window.location.search).has("perf");

/**
 * Samples frame time and moves the tier.
 *
 * Lives inside the Canvas because that is the only place with a render loop. It reports
 * upward rather than owning the tier, so the composer and the lights can read the same
 * value without a context.
 */
export function QualityGovernor({
  tier, onTier,
}: {
  tier: number;
  onTier: (index: number) => void;
}) {
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const elapsed = useRef(0);
  const visible = useRef(!document.hidden);
  // A tier that has already failed is not tried again. Without this the governor climbs
  // back up the moment the scene goes quiet, drops on the next busy frame, and the user
  // watches the resolution breathe.
  const floor = useRef(0);

  useEffect(() => { setDpr(TIERS[tier].dpr); }, [tier, setDpr]);

  /**
   * Never judge the machine on frames the browser was not drawing.
   *
   * A backgrounded or hidden page has requestAnimationFrame throttled to a couple of
   * frames a second. Measured naively that reads as 500ms frames, and the governor
   * concludes the GPU cannot cope and drops to the lowest tier permanently -- so tabbing
   * away for a moment would leave you with a permanently degraded room on a machine that
   * was rendering it perfectly. Samples taken while hidden are discarded, and the window
   * restarts on the way back.
   */
  useEffect(() => {
    const onVisibility = () => {
      visible.current = !document.hidden;
      frames.current = 0;
      elapsed.current = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // With ?perf=1 the renderer itself is reachable, so counts can be read AFTER a frame
  // has been drawn rather than from inside one. Read mid-frame they describe the previous
  // frame at best, and zero at worst.
  useEffect(() => {
    if (!PERF_ENABLED) return;
    (window as unknown as { __councilGL?: unknown }).__councilGL = gl;
  }, [gl]);

  useFrame((_, delta) => {
    if (!visible.current || document.hidden) return;

    frames.current += 1;
    elapsed.current += delta * 1000;
    if (elapsed.current < SAMPLE_MS) return;

    const sampled = frames.current;
    const avg = elapsed.current / sampled;
    frames.current = 0;
    elapsed.current = 0;

    if (sampled < MIN_FRAMES || avg > IMPLAUSIBLE_MS) return;

    if (PERF_ENABLED) {
      (window as unknown as { __councilPerf?: unknown }).__councilPerf = {
        fps: +(1000 / avg).toFixed(1),
        frameMs: +avg.toFixed(2),
        tier: TIERS[tier].name,
        dpr: TIERS[tier].dpr,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length ?? 0,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      };
    }

    if (avg > DECLINE_MS && tier < TIERS.length - 1) {
      floor.current = tier + 1;
      onTier(tier + 1);
    } else if (avg < INCLINE_MS && tier > floor.current) {
      onTier(tier - 1);
    }
  });

  return null;
}

/** Everything the scene needs to know about the current tier. */
export function useQualityTier(): [QualityTier, number, (i: number) => void] {
  const [index, setIndex] = useState(0);
  return [TIERS[index], index, setIndex];
}

/**
 * A readout, only with ?perf=1.
 *
 * Plain DOM rather than drei's Stats: this reports the numbers that actually decide the
 * tier, and it has to survive being read from a script rather than only looked at.
 */
export function PerfReadout() {
  const [text, setText] = useState("measuring…");

  useEffect(() => {
    if (!PERF_ENABLED) return;
    const id = setInterval(() => {
      const p = (window as unknown as { __councilPerf?: Record<string, unknown> }).__councilPerf;
      if (p) {
        setText(
          `${p.fps} fps · ${p.frameMs}ms · ${p.tier} @${p.dpr}x · ` +
          `${p.calls} calls · ${p.triangles} tris · ${p.programs} programs`,
        );
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (!PERF_ENABLED) return null;
  return <p className="perf-readout">{text}</p>;
}
