/**
 * The app's overall phase, separate from the per-seat state in useCouncil.
 *
 * Two state machines, not one. useCouncil tracks what the *models* are doing, driven by
 * the server. This tracks what the *screen* is doing, driven by the user and by time.
 * Keeping them apart is what lets the scene hold on "deliberating" for a beat after the
 * data has already arrived -- a UI that jumps the instant a fetch resolves feels abrupt.
 */

export type Phase =
  /** Formation sequence: point splits, table forms, chairs rise, figures arrive. */
  | "forming"
  /** Table is complete, centre button waiting to be pressed. */
  | "ready"
  /** The ask box is open. */
  | "asking"
  /** Stage 1: four seats answering, previews floating at each chair. */
  | "answering"
  /** Stage 2: the avatars turn to each other and judge. */
  | "deliberating"
  /** Stage 2 result: the ranking is revealed. */
  | "ranked"
  /** Every member's position, side by side, before the verdict. */
  | "tabulate"
  /** Stage 3: the Chairman's verdict is on screen. */
  | "verdict";

export const PHASE_ORDER: Phase[] = [
  "forming", "ready", "asking", "answering", "deliberating", "ranked", "tabulate", "verdict",
];

/**
 * Formation choreography, in ms from the start of the sequence.
 * Read by both the 3D scene and the DOM overlay so the title cannot drift out of sync
 * with the geometry it is titling.
 */
export const formation = {
  /* ---- the splash: the mark, before there is a room ---- */
  /** The logo strikes in out of black. */
  splashIn: 0,
  /** A light sweeps across the mark, as if it were struck metal catching a lamp. */
  splashSweep: 650,
  /** It holds, alone. */
  splashHold: 1500,
  /** The mark collapses into a single point of light -- which becomes the table's. */
  splashOut: 2050,

  /* ---- the room assembles around that point ---- */
  /** A single point pulses at the centre of the void. */
  seedIn: 2300,
  /** It splits into five, which arc outward to their places. */
  split: 2800,
  /** A ring sweeps the circle; the table surface rises behind it. */
  ring: 3400,
  tableRise: 3600,
  /** Chairs rise out of the floor, staggered. */
  chairs: 4200,
  chairStagger: 90,
  /** The figures settle into the chairs. */
  figures: 4800,
  figureStagger: 100,
  /** Camera reaches its resting position; the centre button appears. */
  settle: 5500,
  done: 6000,
} as const;

/** How long the deliberation beat holds, even if the data lands sooner. */
export const DELIBERATION_MIN_MS = 2200;

/**
 * How long the camera has the Chairman to itself before the verdict panel arrives.
 *
 * The push-in was written as the one moment the room has a single speaker, and then
 * covered instantly by an 86% scrim -- the payoff existed in code and was never visible.
 * A beat of held frame costs a second and buys the whole move back.
 */
export const VERDICT_HOLD_MS = 1100;

/** Whether the user has asked not to be animated at. Respected everywhere. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * The opening sequence plays once per session, not once per reload.
 *
 * A three-second overture is a delight the first time and an obstacle the tenth. Stored
 * in sessionStorage rather than localStorage so it returns for a genuinely new visit.
 */
const SEEN_KEY = "council:formation-seen";

export function shouldPlayFormation(): boolean {
  if (prefersReducedMotion()) return false;
  try {
    return sessionStorage.getItem(SEEN_KEY) === null;
  } catch {
    return true; // private mode, blocked storage: play it, no harm done
  }
}

export function markFormationSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* nothing to do; it just plays again next time */
  }
}
