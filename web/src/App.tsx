import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useCouncil } from "./hooks/useCouncil";
import {
  AnswerPanel, AskBox, Deliberation, DissentPanel, FollowUps, RankingPanel,
  Tabulate, Verdict,
} from "./components/Overlays";
import {
  DELIBERATION_MIN_MS, formation, markFormationSeen, shouldPlayFormation,
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

export default function App() {
  const council = useCouncil();
  const [phase, setPhase] = useState<Phase>("forming");
  const [elapsed, setElapsed] = useState(0);
  const [openSeat, setOpenSeat] = useState<string | null>(null);
  const [dissentClosed, setDissentClosed] = useState(false);
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
            onCentreClick={() => setPhase("asking")}
            onOpenSeat={setOpenSeat}
          />
        )}
      </Suspense>

      {/* Title card, only during the opening */}
      <div className={`titlecard ${phase === "forming" && elapsed > formation.tableRise ? "is-open" : ""}`}>
        <span className="titlecard__mark" aria-hidden />
        <h1>LLM Council</h1>
        <p>Four minds, one verdict</p>
      </div>

      {phase === "ready" && (
        <p className="prompt-hint">
          {council.conversationId ? "Ask a follow-up" : "Touch the centre of the table"}
        </p>
      )}

      <AskBox
        open={phase === "asking"}
        isFollowUp={Boolean(council.conversationId)}
        onSubmit={ask}
        onCancel={() => setPhase("ready")}
      />

      <Deliberation active={phase === "deliberating"} />

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
        onContinue={() => setPhase("verdict")}
      />

      <Verdict
        open={phase === "verdict"}
        text={council.verdict}
        streaming={council.running}
        onNext={nextQuestion}
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

      {council.error && <p className="error-toast">{council.error}</p>}

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
