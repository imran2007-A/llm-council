import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCouncil } from "./hooks/useCouncil";
import {
  AnswerPanel, AskBox, DissentPanel, FollowUps, RankingPanel, Stage,
  Tabulate, Verdict,
} from "./components/Overlays";
import {
  DELIBERATION_MIN_MS, VERDICT_HOLD_MS, formation, markFormationSeen,
  prefersReducedMotion, shouldPlayFormation,
} from "./phases";
import type { Phase } from "./phases";

// three.js is ~875 kB. Loading it only when the scene is wanted keeps first paint fast.
const CouncilScene = lazy(() =>
  import("./three/CouncilScene").then((m) => ({ default: m.CouncilScene })),
);

/**
 * Append ?dry=1 to exercise the whole flow with fake responses and zero API calls.
 *
 * A URL flag rather than a visible toggle: it is for developing the interface, and the
 * free-tier request budget is small enough that having it easily to hand matters.
 */
const DRY_RUN = new URLSearchParams(window.location.search).has("dry");

/** How many seats have finished, for the live region. */
function everyoneAnswered(seats: Record<string, { status: string }>): number {
  return Object.values(seats).filter((s) => s.status === "done").length;
}

export default function App() {
  const council = useCouncil();
  const [phase, setPhase] = useState<Phase>("forming");
  const [elapsed, setElapsed] = useState(0);
  const [openSeat, setOpenSeat] = useState<string | null>(null);
  const [dissentClosed, setDissentClosed] = useState(false);
  const [centreFocused, setCentreFocused] = useState(false);
  const [verdictPanelOpen, setVerdictPanelOpen] = useState(false);
  const deliberationStarted = useRef(0);

  /* ---------------------------------------------------------- formation sequence */
  useEffect(() => {
    if (!shouldPlayFormation()) {
      setElapsed(formation.done);
      setPhase("ready");
      return;
    }
    const start = performance.now();
    let raf = 0;

    const finish = () => {
      markFormationSeen();
      setElapsed(formation.done);
      setPhase("ready");
    };

    const tick = () => {
      const t = performance.now() - start;
      setElapsed(t);
      if (t >= formation.done) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Browsers suspend requestAnimationFrame in a hidden tab. Without this, loading the
    // app in a background tab leaves the formation frozen and the user comes back to an
    // empty black screen. A timer keeps running when frames do not, so the sequence
    // always terminates even if nobody watched it.
    const safety = setTimeout(finish, formation.done + 500);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, []);

  /* ------------------------------------------------- follow the council's progress */
  useEffect(() => {
    // The screen's phase is derived from the council's stage, but not slaved to it: the
    // deliberation beat is held open deliberately, and the ranking waits for a click.
    if (council.stage === "opinions") setPhase("answering");
    else if (council.stage === "review") {
      deliberationStarted.current = performance.now();
      setPhase("deliberating");
    }
  }, [council.stage]);

  useEffect(() => {
    if (!council.ranking.length || phase !== "deliberating") return;
    // Hold the deliberation for a minimum beat even when the models are quick. Cutting
    // the instant data lands makes the most interesting stage feel like a loading blip.
    const held = performance.now() - deliberationStarted.current;
    const wait = Math.max(0, DELIBERATION_MIN_MS - held);
    const id = setTimeout(() => setPhase("ranked"), wait);
    return () => clearTimeout(id);
  }, [council.ranking, phase]);

  // Let the camera have the Chairman alone for a beat before the panel covers the room.
  useEffect(() => {
    if (phase !== "verdict") {
      setVerdictPanelOpen(false);
      return;
    }
    if (prefersReducedMotion()) {
      setVerdictPanelOpen(true);
      return;
    }
    const id = setTimeout(() => setVerdictPanelOpen(true), VERDICT_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);

  /* ------------------------------------------------------------------- interaction */
  const ask = useCallback((question: string) => {
    council.ask(question, { dryRun: DRY_RUN });
    setPhase("answering");
  }, [council]);

  const nextQuestion = useCallback(() => {
    council.reset();
    setOpenSeat(null);
    setDissentClosed(false);
    setPhase("ready");
  }, [council]);

  // Spoken, not shown. Phase changes and seat completions are the two things a sighted
  // user reads off the rings and nobody else could perceive at all.
  const answered = everyoneAnswered(council.seats);
  const announcement = useMemo(() => {
    switch (phase) {
      case "asking": return "Question box open.";
      case "answering": return `Stage 1 of 3. The council is answering. ${answered} have replied.`;
      case "deliberating": return "Stage 2 of 3. The council is reviewing each other's answers.";
      case "ranked": return "The council has ranked the answers.";
      case "tabulate": return "Every member's position, side by side.";
      case "verdict": return "Stage 3 of 3. The Chairman has delivered the verdict.";
      default: return "";
    }
  }, [phase, answered]);

  const config = council.config;
  const everyone = config ? [...config.seats, config.chairman] : [];
  const seatConfig = everyone.find((s) => s.id === openSeat) ?? null;

  // Whoever the council put last. Offered, not fetched: it costs a request.
  const lastRanked = council.ranking.length
    ? council.ranking[council.ranking.length - 1].seat
    : null;
  const dissenter = (!dissentClosed && lastRanked)
    ? everyone.find((s) => s.id === lastRanked) ?? null
    : null;

  return (
    <div className="app">
      <Suspense fallback={<div className="boot" />}>
        {config && (
          <CouncilScene
            seats={config.seats}
            chairman={config.chairman}
            seatStates={council.seats}
            phase={phase}
            elapsed={elapsed}
            centreFocused={centreFocused}
            onCentreClick={() => setPhase("asking")}
            onOpenSeat={setOpenSeat}
          />
        )}
      </Suspense>

      {/* The opening. The mark arrives before the room does, catches a light across it,
          then collapses into the point that becomes the table's centre lamp -- so the
          splash hands off to the formation instead of cutting to it. Timings come from
          the same constants the 3D sequence reads, passed down as custom properties, so
          the card and the geometry cannot drift apart. */}
      {phase === "forming" && elapsed < formation.ring && (
        <div
          className="splash"
          style={{
            "--splash-in": `${formation.splashSweep - formation.splashIn}ms`,
            "--splash-sweep-at": `${formation.splashSweep}ms`,
            "--splash-out-at": `${formation.splashOut}ms`,
          } as React.CSSProperties}
          aria-hidden
        >
          <div className="splash__stage">
            <span className="splash__mark" />
            <span className="splash__sweep" />
          </div>
          <h1 className="splash__word">LLM Council</h1>
          <p className="splash__tag">Four minds, one verdict</p>
        </div>
      )}

      {phase === "ready" && (
        <>
          <button
            className="centre-trigger"
            onClick={() => setPhase("asking")}
            onFocus={() => setCentreFocused(true)}
            onBlur={() => setCentreFocused(false)}
          >
            {council.conversationId
              ? "Ask the council a follow-up question"
              : "Put a question to the council"}
          </button>
          <p className="prompt-hint" aria-hidden>
            {council.conversationId ? "Ask a follow-up" : "Touch the centre of the table"}
          </p>
        </>
      )}

      <AskBox
        open={phase === "asking"}
        isFollowUp={Boolean(council.conversationId)}
        onSubmit={ask}
        onCancel={() => setPhase("ready")}
      />

      <Stage
        active={phase === "answering"}
        title="The council answers"
        detail="Four members are answering independently. None of them can see the others yet."
      />

      <Stage
        active={phase === "deliberating"}
        title="The council deliberates"
        detail="Each member is reading the others' answers, with every name removed."
      />

      <RankingPanel
        open={phase === "ranked"}
        ranking={council.ranking}
        seats={everyone}
        onContinue={() => setPhase("tabulate")}
      />

      <Tabulate
        open={phase === "tabulate"}
        positions={council.synthesis?.positions ?? []}
        disagreement={council.synthesis?.disagreement ?? []}
        ranking={council.ranking}
        seats={everyone}
        answers={council.seats}
        onContinue={() => setPhase("verdict")}
      />

      <Verdict
        open={phase === "verdict" && verdictPanelOpen}
        text={council.verdict}
        question={council.question}
        streaming={council.running}
        onNext={nextQuestion}
        onBack={() => setPhase("tabulate")}
      >
        <FollowUps
          questions={council.synthesis?.followups ?? []}
          onAsk={(question) => { setPhase("answering"); council.ask(question, { dryRun: DRY_RUN }); }}
        />
        <DissentPanel
          seat={dissenter}
          dissent={council.dissent}
          pending={council.dissentPending}
          onAsk={() => council.askDissenter()}
          onClose={() => setDissentClosed(true)}
        />
      </Verdict>

      <AnswerPanel
        seat={seatConfig}
        state={openSeat ? council.seats[openSeat] ?? null : null}
        onClose={() => setOpenSeat(null)}
      />

      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {council.error && (
        <p className="error-toast" role="alert">
          {council.error}
          <button
            className="error-toast__dismiss"
            onClick={council.clearError}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </p>
      )}

      {/* Always available once a question has been asked, so you are never trapped in a
          stage waiting for a model that is never going to answer. */}
      {(phase === "answering" || phase === "deliberating" || phase === "ranked") && (
        <button className="btn btn--next btn--corner" onClick={nextQuestion}>
          Start over
        </button>
      )}
    </div>
  );
}
