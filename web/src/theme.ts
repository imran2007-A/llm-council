/**
 * Dark chamber, warm gold.
 *
 * One source of truth for both worlds: CSS custom properties drive the DOM, and the same
 * numbers are exported as hex for three.js materials and lights. A colour defined twice
 * is a colour that will drift apart.
 */

export const palette = {
  // The room. Not pure black -- pure black kills the sense of depth, because there is
  // nothing left for shadow to be darker than.
  void: "#0a0806",
  chamber: "#120e0a",
  surface: "#1a1410",
  raised: "#241c15",

  // Walnut table, brass fittings.
  walnut: "#3a2a1c",
  walnutDark: "#241a11",
  brass: "#b8893a",
  brassLight: "#e8c07a",

  // The warm key light every seat sits under.
  amber: "#ffc470",
  amberDim: "#a8763a",

  ink: "#f2e9dc",
  inkMuted: "#a99883",
  inkFaint: "#97846e",

  good: "#8fbf7a",
  bad: "#cf6b5a",
  line: "#2e2419",
} as const;

/**
 * One accent per seat, warm-biased so nothing fights the gold.
 * Keyed by seat id from council/config.py.
 */
export const seatColors: Record<string, string> = {
  nemotron: "#7db87d", // green
  gptoss: "#6fa8c7", // steel blue
  qwen: "#c77d9e", // rose
  gemini: "#d9a441", // gold
  chairman: "#e8c07a", // brass, brightest
};

export const seatColor = (id: string) => seatColors[id] ?? palette.brass;

/** Numeric forms for three.js, which wants 0xRRGGBB rather than strings. */
export const hex = (color: string) => parseInt(color.replace("#", ""), 16);

export const font = {
  display: "'Cormorant Garamond', Georgia, serif",
  body: "'Jost', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

/**
 * Motion.
 *
 * Durations in ms, easings as cubic-beziers. Kept together so the whole app can be
 * slowed down or sped up by changing one file, and so nothing is animated with an
 * arbitrary duration typed inline at 2am.
 */
export const motion = {
  /** Press feedback, hover, anything the hand should feel answer instantly. */
  fast: 180,
  /** Panels arriving and leaving. */
  normal: 320,
  /** The big moves: a panel crossing the screen, the camera settling. */
  slow: 560,
  // Decelerate hard: things arrive quickly then settle. Reads as weight.
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  // Exponential ease-out. Not a spring: overshoot is the wrong physics for a room made
  // of walnut and brass, and bounce dates an interface faster than almost anything else.
  settle: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/**
 * Stacking order, named rather than numbered.
 *
 * There were eleven hand-picked z-index values across two stylesheets, and two unrelated
 * things both sitting at 60 -- which is not a layering system, it is a queue of guesses.
 * Naming the layers means the question "does this go above the scrim?" has an answer you
 * can read instead of a number you have to beat.
 */
export const layers = {
  scene: 0,
  sceneOverlay: 20,   // prompts and hints drawn over the 3D canvas
  emblem: 25,         // the marks above each seat
  stage: 30,          // stage narration
  panel: 40,          // ranking, comparison, verdict
  sheet: 50,          // the full answer drawer, over a panel
  splash: 60,         // the opening card, over everything
  toast: 70,          // errors, which must never be covered
  instrument: 90,     // the perf readout, which is a tool and sits above the product
} as const;

/**
 * Injected once at startup so CSS and three.js cannot disagree about a colour.
 *
 * This was exported, documented, and imported by nothing -- and the two files had already
 * drifted (inkFaint here still read #6b5d4d after the CSS was raised to #97846e for
 * contrast). Now applyTheme() actually writes these onto :root at boot, so the palette
 * has one owner and the stylesheet's own values are the fallback, not a second source.
 */
export function cssVariables(): string {
  const lines = Object.entries(palette).map(([k, v]) => `  --${k}: ${v};`);
  const seats = Object.entries(seatColors).map(([k, v]) => `  --seat-${k}: ${v};`);
  return `:root{\n${lines.join("\n")}\n${seats.join("\n")}\n  --font-display:${font.display};\n  --font-body:${font.body};\n  --ease-out:${motion.out};\n  --ease-settle:${motion.settle};\n}`;
}


/** Write the palette onto :root. Called once from main.tsx before React mounts. */
export function applyTheme(): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(`--${kebab(key)}`, value);
  }
  for (const [key, value] of Object.entries(seatColors)) {
    root.style.setProperty(`--seat-${key}`, value);
  }
  root.style.setProperty("--font-display", font.display);
  root.style.setProperty("--font-body", font.body);
  for (const [key, value] of Object.entries(layers)) {
    root.style.setProperty(`--layer-${kebab(key)}`, String(value));
  }
  // Durations too. These existed here and were used by nothing: the stylesheets carried
  // eleven different hand-typed millisecond values instead.
  root.style.setProperty("--dur-fast", `${motion.fast}ms`);
  root.style.setProperty("--dur-normal", `${motion.normal}ms`);
  root.style.setProperty("--dur-slow", `${motion.slow}ms`);
  root.style.setProperty("--ease-out", motion.out);
  root.style.setProperty("--ease-in-out", motion.inOut);
  root.style.setProperty("--ease-settle", motion.settle);
}

/** brassLight -> brass-light, so the token names match what the stylesheets already use. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
