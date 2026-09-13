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
  name: "ultra" | "high" | "medium" | "low";
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
 * Every tier keeps the lighting and the filmic grade. Only resolution moves.
 *
 * Two things were tried here and both were wrong. The lowest tier first dropped the
 * EffectComposer, which leaves the canvas black. Then it dropped the five per-seat lamps
 * and the shadow pass -- which worked, and looked like a bug: a cold load spends its
 * first seconds compiling shaders and decoding the armchair, the governor read that as a
 * slow GPU, and the room settled into flat unlit figures. Refreshing "fixed" it, because
 * the second load is cached and fast.
 *
 * Lighting is not a performance setting. It is what the room IS, and a user cannot tell
 * "my machine is struggling" from "this software is broken" when the difference is that
 * everyone at the table went dark. Resolution can slide; the light stays.
 */
export const TIERS: QualityTier[] = [
  // A discrete GPU can pay for more than the scene was ever asking. Nothing here is
  // reachable unless the machine actually holds it for four consecutive samples, so the
  // ceiling costs a weak laptop nothing.
  { name: "ultra", dpr: 2, multisampling: 8, bloom: "large", shadowMap: 4096 },
  { name: "high", dpr: 1.5, multisampling: 4, bloom: "large", shadowMap: 2048 },
  { name: "medium", dpr: 1.1, multisampling: 0, bloom: "large", shadowMap: 2048 },
  { name: "low", dpr: 0.75, multisampling: 0, bloom: "small", shadowMap: 1024 },
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
/**
 * Nothing is judged until the room has finished arriving.
 *
 * The opening is the worst-performing part of the whole app and the least representative
 * of it: shaders compile, the armchair decodes, and the formation animates, all at once.
 * Sampling through that told the governor the machine was slow when it simply had not
 * warmed up yet.
 */
const GRACE_MS = 7000;
/** Consecutive samples before the tier moves. Down quickly, up cautiously. */
const DECLINE_SAMPLES = 2;
const INCLINE_SAMPLES = 4;
/** Above this, the frame did not happen: it was throttled, paused, or the tab was away. */
const IMPLAUSIBLE_MS = 250;

export const PERF_ENABLED = new URLSearchParams(window.location.search).has("perf");

/**
 * ?off=post,shadows,lamps,emblems -- turn subsystems off to find what actually costs.
 *
 * Written because the room ran at 7.6fps and every candidate was a guess: nine lights,
 * a bloom chain, a shadow pass, five DOM overlays repositioned every frame. Bisecting by
 * editing code and reloading is slow and needs me; a URL flag lets anyone with the page
 * open answer it in a minute. Diagnosis only -- nothing here changes what ships.
 */
const OFF = new Set(
  (new URLSearchParams(window.location.search).get("off") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
);
export const disabled = (part: "post" | "shadows" | "lamps" | "emblems") => OFF.has(part);

/**
 * "ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)"
 * -> "Intel(R) UHD Graphics".
 *
 * Splitting on the first comma gives the vendor, not the chip, and a chip name of its own
 * contains both commas and brackets -- the first attempt at this printed "Intel(R", which
 * is worse than printing nothing.
 */
export function shortGPU(raw: string): string {
  const inner = raw.replace(/^ANGLE \(/, "").replace(/\)$/, "");
  const device = inner.split(", ")[1] ?? inner;
  return device.replace(/\s*\(0x[0-9A-Fa-f]+\).*$/, "").trim() || raw;
}

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
  /**
   * Hysteresis by consecutive samples, not a permanent floor.
   *
   * The first version pinned a tier the moment it failed once and never tried higher
   * again. That is wrong whenever the bad sample was not the GPU's fault -- a browser
   * throttling an occluded window to 10fps, a one-off stall while a model's answer lands,
   * a background tab compiling shaders. The room would drop to its lowest setting and
   * stay there for the rest of the session on hardware that could run it at full quality.
   *
   * Two bad samples in a row to step down; four good ones in a row to step back up. Wide
   * enough apart that the tier cannot oscillate, forgiving enough that a transient stall
   * is not a life sentence.
   */
  const badRun = useRef(0);
  const goodRun = useRef(0);

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

    // Which GPU actually answered. powerPreference is a request, and on a hybrid laptop
    // it is routinely ignored -- so the readout names the chip rather than assuming the
    // fast one won. A frame rate is meaningless without knowing what drew it.
    try {
      const ctx = gl.getContext();
      const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
      const name = dbg
        ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        : "unknown GPU";
      (window as unknown as { __councilGPU?: string }).__councilGPU = shortGPU(name);
    } catch { /* diagnostics never break the scene */ }
  }, [gl]);

  const born = useRef(performance.now());

  useFrame((_, delta) => {
    if (!visible.current || document.hidden) return;
    if (performance.now() - born.current < GRACE_MS) return;

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

    if (avg > DECLINE_MS) {
      badRun.current += 1;
      goodRun.current = 0;
    } else if (avg < INCLINE_MS) {
      goodRun.current += 1;
      badRun.current = 0;
    } else {
      badRun.current = 0;
      goodRun.current = 0;
    }

    if (badRun.current >= DECLINE_SAMPLES && tier < TIERS.length - 1) {
      badRun.current = 0;
      onTier(tier + 1);
    } else if (goodRun.current >= INCLINE_SAMPLES && tier > 0) {
      goodRun.current = 0;
      onTier(tier - 1);
    }
  });

  return null;
}

/**
 * Everything the scene needs to know about the current tier.
 *
 * Starts at medium, not high. The governor needs about a second of frames before it can
 * judge anything, and starting at the most expensive setting spends that second on the
 * splash and the room forming -- the first thing anyone sees, and the part with the most
 * happening at once. A capable machine climbs to high a few seconds later and loses
 * nothing; a weak one never pays for a tier it was never going to hold.
 */
export function useQualityTier(): [QualityTier, number, (i: number) => void] {
  const [index, setIndex] = useState(1); // "high": one step below the ceiling
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
        const gpu = (window as unknown as { __councilGPU?: string }).__councilGPU;
        setText(
          `${p.fps} fps · ${p.frameMs}ms · ${p.tier} @${p.dpr}x · ` +
          `${p.calls} calls · ${p.programs} programs` +
          (gpu ? ` · ${gpu}` : ""),
        );
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (!PERF_ENABLED) return null;
  return <p className="perf-readout">{text}</p>;
}
