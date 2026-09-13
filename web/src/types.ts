// Shapes mirroring what the API sends. Keep in step with council/council.py and server.py.

export type Stage = "opinions" | "review" | "chairman";

/** Every phase a seat passes through. The 2D cards and the 3D avatars both read this. */
export type SeatStatus = "idle" | "thinking" | "speaking" | "done" | "failed";

export interface SeatConfig {
  id: string;
  label: string;
  provider: string;
  model: string;
  /** Two sentences on who this member is, shown when their emblem is clicked. */
  blurb?: string;
}

export interface CouncilConfig {
  seats: SeatConfig[];
  chairman: SeatConfig;
  providers: Record<string, { rpm: number; rpd: number }>;
  budget_used: Record<string, number>;
}

export interface RankingRow {
  label: string; // the anonymous letter this seat was given
  seat: string;
  score: number;
}

/** Live state of one seat, rebuilt from the event stream. */
export interface SeatState {
  id: string;
  status: SeatStatus;
  /** Text for the CURRENT stage. Cleared when the next stage starts. */
  text: string;
  /**
   * The seat's stage-1 answer, kept for the whole run.
   *
   * `text` is reused stage by stage, so by the time the comparison is on screen it holds
   * the seat's peer review, not its answer -- which is what "expand answers" was showing.
   * This keeps the thing the user actually asked for.
   */
  answer: string;
  error: string | null;
  /** Set when a fallback model answered instead of the configured one. */
  modelUsed: string | null;
  /** Whether this stage's answer came from cache rather than a live call. */
  cached: boolean;
  /** Bumped on every token, so animations can react to speaking rate. */
  tokenCount: number;
  lastTokenAt: number;
}

export interface UsageRow {
  provider: string;
  used: number;
  limit: number;
  remaining: number;
  fraction: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  turns: number;
  updated: number;
}

/** One member's position, in a line, for the comparison table. */
export interface Position {
  label: string;
  seat: string;
  text: string;
}

/** What the Chairman produced alongside the verdict, in the same request. */
export interface SynthesisData {
  positions: Position[];
  disagreement: string[];
  followups: string[];
  verdict: string;
}

export interface Dissent {
  ok: boolean;
  seat?: string;
  text?: string;
  error?: string | null;
}

export interface ConversationTurn {
  run_id: string;
  question: string;
  verdict: string;
  ts: number;
}

/** Server-sent events. `type` discriminates the union. */
export type CouncilEvent =
  | { type: "stage_changed"; t: number; stage: Stage }
  | { type: "seat_started"; t: number; seat: string; stage: Stage }
  | { type: "seat_token"; t: number; seat: string; stage: Stage; text: string }
  | { type: "seat_reset"; t: number; seat: string; stage: Stage }
  | { type: "cache_hit"; t: number; seat: string }
  | {
      type: "seat_finished";
      t: number;
      seat: string;
      stage: Stage;
      ok: boolean;
      error: string | null;
      text: string;
    }
  | { type: "review_finished"; t: number; ranking: RankingRow[] }
  | ({ type: "synthesis_ready"; t: number } & SynthesisData)
  | { type: "run_finished"; t: number; ok: boolean; conversation_id: string | null }
  | { type: "run_failed"; t: number; error: string }
  | { type: "heartbeat"; t: number };
