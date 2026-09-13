import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CouncilConfig,
  CouncilEvent,
  Dissent,
  RankingRow,
  SeatState,
  Stage,
  SynthesisData,
} from "../types";

/**
 * Turns the SSE stream into state.
 *
 * This is the only place that knows about EventSource. Everything else -- the cards, the
 * ranking table, the 3D avatars -- reads the state machine it produces, which is why a
 * completely different visual design can be dropped on top without touching this file.
 */

const STAGES: Stage[] = ["opinions", "review", "chairman"];

/** Mirrors the flag in App.tsx, so a dry run never spends a request on a dissent either. */
const DRY_RUN = new URLSearchParams(window.location.search).has("dry");

function blankSeat(id: string): SeatState {
  return {
    id,
    status: "idle",
    text: "",
    answer: "",
    error: null,
    modelUsed: null,
    cached: false,
    tokenCount: 0,
    lastTokenAt: 0,
  };
}

export interface CouncilState {
  config: CouncilConfig | null;
  seats: Record<string, SeatState>;
  /** Seat order for layout: council members first, Chairman last. */
  seatOrder: string[];
  stage: Stage | null;
  stagesDone: Stage[];
  ranking: RankingRow[];
  verdict: string;
  /** The comparison table, the conflicts and the follow-ups, from the Chairman's own reply. */
  synthesis: SynthesisData | null;
  dissent: Dissent | null;
  dissentPending: boolean;
  askDissenter: (seatId?: string) => Promise<void>;
  running: boolean;
  question: string;
  conversationId: string | null;
  error: string | null;
  ask: (question: string, options?: AskOptions) => Promise<void>;
  reset: () => void;
  clearError: () => void;
  startNewConversation: () => void;
}

export interface AskOptions {
  dryRun?: boolean;
  cache?: boolean;
  seats?: number;
}

export function useCouncil(): CouncilState {
  const [config, setConfig] = useState<CouncilConfig | null>(null);
  const [seats, setSeats] = useState<Record<string, SeatState>>({});
  const [stage, setStage] = useState<Stage | null>(null);
  const [stagesDone, setStagesDone] = useState<Stage[]>([]);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [verdict, setVerdict] = useState("");
  const [synthesis, setSynthesis] = useState<SynthesisData | null>(null);
  const [dissent, setDissent] = useState<Dissent | null>(null);
  const [dissentPending, setDissentPending] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError("Could not reach the council API. Is the server running?"));
    // Leaving the page mid-run should not leak the connection.
    return () => sourceRef.current?.close();
  }, []);

  const seatOrder = config ? [...config.seats.map((s) => s.id), config.chairman.id] : [];

  const patchSeat = useCallback((id: string, patch: Partial<SeatState>) => {
    setSeats((prev) => ({ ...prev, [id]: { ...(prev[id] ?? blankSeat(id)), ...patch } }));
  }, []);

  const handle = useCallback(
    (event: CouncilEvent) => {
      switch (event.type) {
        case "stage_changed":
          setStage(event.stage);
          setStagesDone(STAGES.slice(0, STAGES.indexOf(event.stage)));
          break;

        case "seat_started":
          // Stage 2 reuses the same seats, so the previous stage's text is cleared here.
          patchSeat(event.seat, {
            status: "thinking",
            text: "",
            error: null,
            cached: false,
            tokenCount: 0,
            // A follow-up question re-enters stage 1 without a reset, so the previous
            // question's answer has to go here or the comparison shows the old one.
            ...(event.stage === "opinions" ? { answer: "" } : {}),
          });
          break;

        case "seat_token":
          // Tokens advance the seat's state but are NOT accumulated into visible text
          // during the run. Four blocks of prose racing each other cannot be read at that
          // speed, and they bury the only thing worth watching, which is who is still
          // thinking. The full answer arrives in one piece on seat_finished.
          setSeats((prev) => {
            const seat = prev[event.seat] ?? blankSeat(event.seat);
            return {
              ...prev,
              [event.seat]: {
                ...seat,
                status: "speaking",
                tokenCount: seat.tokenCount + 1,
                lastTokenAt: performance.now(),
              },
            };
          });
          break;

        case "seat_reset":
          // The attempt failed; a retry or fallback is starting over. The ring resets so
          // the seat visibly begins again rather than appearing to stall.
          patchSeat(event.seat, { text: "", status: "thinking", tokenCount: 0 });
          break;

        case "cache_hit":
          patchSeat(event.seat, { cached: true });
          break;

        case "seat_finished":
          patchSeat(event.seat, {
            status: event.ok ? "done" : "failed",
            error: event.error,
            // Non-streaming paths (cache hits, dry runs) deliver the text only here.
            text: event.ok ? event.text : "",
            // Stage 1 is the only stage whose output has to outlive its own stage: the
            // comparison and the answer sheet both show it long after stage 2 has
            // overwritten `text`.
            ...(event.ok && event.stage === "opinions" ? { answer: event.text } : {}),
          });
          if (event.ok && event.stage === "chairman") setVerdict(event.text);
          break;

        case "review_finished":
          setRanking(event.ranking);
          break;

        case "synthesis_ready":
          setSynthesis({
            positions: event.positions,
            disagreement: event.disagreement,
            followups: event.followups,
            verdict: event.verdict,
          });
          // The Chairman's raw reply includes the trailing sections; show the verdict
          // alone once they have been separated out.
          if (event.verdict) setVerdict(event.verdict);
          break;

        case "run_finished":
          setStagesDone(STAGES);
          setStage(null);
          setRunning(false);
          if (event.conversation_id) setConversationId(event.conversation_id);
          break;

        case "run_failed":
          setError(event.error);
          setRunning(false);
          break;

        case "heartbeat":
          break;
      }
    },
    [patchSeat],
  );

  const ask = useCallback(
    async (text: string, options: AskOptions = {}) => {
      if (!text.trim() || running) return;

      sourceRef.current?.close();
      setQuestion(text);
      setError(null);
      setRanking([]);
      setVerdict("");
      setSynthesis(null);
      setDissent(null);
      setStage(null);
      setStagesDone([]);
      // Every council seat is marked thinking straight away, rather than waiting for the
      // server's seat_started events. Those arrive after a POST, an SSE connection and
      // the run actually beginning -- close to a second in which you have pressed Enter,
      // the ask box has gone, and nothing on the table has changed. The seats genuinely
      // are queued at that point, so showing them working is honest as well as faster.
      // The Chairman is not: it does not speak until stage three.
      setSeats(Object.fromEntries(seatOrder.map((id) => [
        id,
        id === config?.chairman.id
          ? blankSeat(id)
          : { ...blankSeat(id), status: "thinking" as const },
      ])));
      setRunning(true);

      let runId: string;
      try {
        const response = await fetch("/api/council", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: text,
            dry_run: options.dryRun ?? false,
            cache: options.cache ?? true,
            seats: options.seats,
            conversation_id: conversationId,
          }),
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const started = await response.json();
        runId = started.run_id;
        runIdRef.current = runId;
        setConversationId(started.conversation_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start the council");
        setRunning(false);
        return;
      }

      const source = new EventSource(`/api/council/${runId}/stream`);
      sourceRef.current = source;

      const types: CouncilEvent["type"][] = [
        "stage_changed", "seat_started", "seat_token", "seat_reset", "cache_hit",
        "seat_finished", "review_finished", "synthesis_ready", "run_finished",
        "run_failed", "heartbeat",
      ];
      for (const type of types) {
        source.addEventListener(type, (message) => {
          handle(JSON.parse((message as MessageEvent).data) as CouncilEvent);
        });
      }
      source.addEventListener("done", () => {
        source.close();
        sourceRef.current = null;
        setRunning(false);
      });
      source.onerror = () => {
        // EventSource reconnects by itself, and the run continues server-side either way.
        // Reconnecting replays the event history, so nothing is lost.
        setRunning(false);
      };
    },
    [running, seatOrder, conversationId, handle, config],
  );

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setSeats(Object.fromEntries(seatOrder.map((id) => [id, blankSeat(id)])));
    setStage(null);
    setStagesDone([]);
    setRanking([]);
    setVerdict("");
    setSynthesis(null);
    setDissent(null);
    setQuestion("");
    setRunning(false);
    setError(null);
  }, [seatOrder]);

  const clearError = useCallback(() => setError(null), []);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    reset();
  }, [reset]);

  const askDissenter = useCallback(async (seatId?: string) => {
    const runId = runIdRef.current;
    if (!runId || dissentPending) return;
    setDissentPending(true);
    setDissent(null);
    try {
      const response = await fetch(`/api/council/${runId}/dissent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seat: seatId ?? null, dry_run: DRY_RUN }),
      });
      setDissent(await response.json());
    } catch (e) {
      setDissent({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setDissentPending(false);
    }
  }, [dissentPending]);

  return {
    config, seats, seatOrder, stage, stagesDone, ranking, verdict, synthesis,
    dissent, dissentPending, askDissenter,
    running, question, conversationId, error, ask, reset, clearError,
    startNewConversation,
  };
}
