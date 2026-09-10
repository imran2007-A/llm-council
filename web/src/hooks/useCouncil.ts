import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CouncilConfig,
  CouncilEvent,
  RankingRow,
  SeatState,
  Stage,
} from "../types";

/**
 * Turns the SSE stream into state.
 *
 * This is the only place that knows about EventSource. Everything else -- the cards, the
 * ranking table, the 3D avatars -- reads the state machine it produces, which is why a
 * completely different visual design can be dropped on top without touching this file.
 */

const STAGES: Stage[] = ["opinions", "review", "chairman"];

function blankSeat(id: string): SeatState {
  return {
    id,
    status: "idle",
    text: "",
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
  running: boolean;
  question: string;
  conversationId: string | null;
  error: string | null;
  ask: (question: string, options?: AskOptions) => Promise<void>;
  reset: () => void;
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
          });
          break;

        case "seat_token":
          setSeats((prev) => {
            const seat = prev[event.seat] ?? blankSeat(event.seat);
            return {
              ...prev,
              [event.seat]: {
                ...seat,
                status: "speaking",
                text: seat.text + event.text,
                tokenCount: seat.tokenCount + 1,
                lastTokenAt: performance.now(),
              },
            };
          });
          break;

        case "seat_reset":
          // The attempt that produced this text failed; a retry or fallback is starting
          // over. Discard it rather than leaving half an answer on screen.
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
          });
          if (event.ok && event.stage === "chairman") setVerdict(event.text);
          break;

        case "review_finished":
          setRanking(event.ranking);
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
      setStage(null);
      setStagesDone([]);
      setSeats(Object.fromEntries(seatOrder.map((id) => [id, blankSeat(id)])));
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
        "seat_finished", "review_finished", "run_finished", "run_failed", "heartbeat",
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
    [running, seatOrder, conversationId, handle],
  );

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setSeats(Object.fromEntries(seatOrder.map((id) => [id, blankSeat(id)])));
    setStage(null);
    setStagesDone([]);
    setRanking([]);
    setVerdict("");
    setQuestion("");
    setRunning(false);
    setError(null);
  }, [seatOrder]);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    reset();
  }, [reset]);

  return {
    config, seats, seatOrder, stage, stagesDone, ranking, verdict,
    running, question, conversationId, error, ask, reset, startNewConversation,
  };
}
