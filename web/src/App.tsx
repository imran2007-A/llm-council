import { lazy, Suspense, useEffect, useState } from "react";
import { useCouncil } from "./hooks/useCouncil";
import type { ConversationSummary, UsageRow } from "./types";

// three.js is ~1MB of the bundle. Loading it only when the 3D view is opened keeps the
// first paint fast for anyone who never switches to the table.
const CouncilScene = lazy(() =>
  import("./three/CouncilScene").then((m) => ({ default: m.CouncilScene })),
);

/**
 * Structure only.
 *
 * There is deliberately almost no styling here -- the visual design is still to be
 * decided. Every piece of state a design could need is already wired: per-seat status and
 * streaming text, stage progress, ranking, verdict, conversation history and usage. The
 * design work is replacing this markup, not plumbing new data.
 */

type View = "cards" | "table";

export default function App() {
  const council = useCouncil();
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<View>("cards");
  const [dryRun, setDryRun] = useState(false);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  // Refresh the sidebar whenever a run ends, so a new turn shows up straight away.
  useEffect(() => {
    if (council.running) return;
    fetch("/api/usage").then((r) => r.json()).then((d) => setUsage(d.today)).catch(() => {});
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations))
      .catch(() => {});
  }, [council.running]);

  const { config, seats, seatOrder } = council;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <aside style={{ width: 240, borderRight: "1px solid #262b36", padding: 12, overflowY: "auto" }}>
        <button onClick={council.startNewConversation}>New conversation</button>

        <h4>Conversations</h4>
        <ul style={{ paddingLeft: 16 }}>
          {conversations.map((c) => (
            <li key={c.id} style={{ fontWeight: c.id === council.conversationId ? 700 : 400 }}>
              {c.title} ({c.turns})
            </li>
          ))}
        </ul>

        <h4>Requests today</h4>
        <ul style={{ paddingLeft: 16 }}>
          {usage.map((u) => (
            <li key={u.provider}>
              {u.provider}: {u.used}/{u.limit}
              {u.fraction > 0.8 && " ⚠"}
            </li>
          ))}
        </ul>
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <form
          style={{ display: "flex", gap: 8, padding: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            council.ask(draft, { dryRun });
            setDraft("");
          }}
        >
          <input
            style={{ flex: 1 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={council.conversationId ? "Follow up…" : "Ask the council…"}
            disabled={council.running}
          />
          <button type="submit" disabled={council.running || !draft.trim()}>
            {council.running ? "In session…" : "Convene"}
          </button>
          <label>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            dry run
          </label>
          <button type="button" onClick={() => setView(view === "cards" ? "table" : "cards")}>
            {view === "cards" ? "3D table" : "Cards"}
          </button>
        </form>

        {council.error && <p style={{ color: "#f7768e", padding: "0 12px" }}>{council.error}</p>}

        <div style={{ padding: "0 12px" }}>
          {(["opinions", "review", "chairman"] as const).map((s) => (
            <span key={s} style={{ marginRight: 12, opacity: council.stagesDone.includes(s) || council.stage === s ? 1 : 0.4 }}>
              {council.stage === s ? "▶ " : council.stagesDone.includes(s) ? "✓ " : "• "}
              {s}
            </span>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
          {!config && <p>Loading council…</p>}

          {/* The R3F canvas fills its parent, so the parent needs a real height. An
              explicit value is used rather than height:100% because it does not depend
              on how the surrounding flex/scroll containers resolve. */}
          {config && view === "table" && (
            <div style={{ height: "min(72vh, 680px)" }}>
              <Suspense fallback={<p>Loading the council table…</p>}>
                <CouncilScene seats={config.seats} chairman={config.chairman} seatStates={seats} />
              </Suspense>
            </div>
          )}

          {config && view === "cards" && (
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              {seatOrder.map((id) => {
                const seat = [...config.seats, config.chairman].find((s) => s.id === id)!;
                const state = seats[id];
                return (
                  <section key={id} style={{ border: "1px solid #262b36", padding: 10, borderRadius: 8 }}>
                    <strong>{seat.label}</strong>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>
                      {seat.provider} · {state?.status ?? "idle"}
                      {state?.cached && " · cached"}
                    </div>
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 260, overflowY: "auto" }}>
                      {state?.error ? state.error : state?.text}
                    </pre>
                  </section>
                );
              })}
            </div>
          )}

          {council.ranking.length > 0 && (
            <>
              <h3>Peer ranking</h3>
              <ol>
                {council.ranking.map((r) => {
                  const seat = config && [...config.seats, config.chairman].find((s) => s.id === r.seat);
                  return <li key={r.label}>{seat?.label ?? r.seat} — {r.score}</li>;
                })}
              </ol>
            </>
          )}

          {council.verdict && (
            <>
              <h3>Verdict</h3>
              <div style={{ whiteSpace: "pre-wrap" }}>{council.verdict}</div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
