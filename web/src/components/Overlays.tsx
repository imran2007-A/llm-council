import { useEffect, useRef, useState } from "react";
import type {
  Dissent as DissentData, Position, RankingRow, SeatConfig, SeatState,
} from "../types";
import { seatColor } from "../theme";

/**
 * Everything drawn over the scene.
 *
 * Long text lives in the DOM, not in 3D. Two thousand characters of prose on an angled
 * plane is a legibility problem dressed up as a feature -- the 3D keeps the atmosphere,
 * the DOM keeps the reading.
 */

/* --------------------------------------------------------------------------- ask box */

export function AskBox({
  open, onSubmit, onCancel, isFollowUp,
}: {
  open: boolean;
  onSubmit: (question: string) => void;
  onCancel: () => void;
  isFollowUp: boolean;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      // Delay matches the panel's entrance, so focus does not yank the page before the
      // box has visually arrived.
      const id = setTimeout(() => input.current?.focus(), 280);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <div className={`ask ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="ask__panel">
        <p className="ask__eyebrow">{isFollowUp ? "Follow-up" : "Put a question to the council"}</p>
        <textarea
          ref={input}
          className="ask__input"
          value={value}
          rows={3}
          placeholder={isFollowUp
            ? "The council remembers what was said…"
            : "Ask something worth four opinions…"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits, Shift+Enter breaks the line. Standard for a composer, and
            // it keeps the mouse out of the loop entirely.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim()) onSubmit(value.trim());
            }
          }}
        />
        <div className="ask__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn--primary"
            disabled={!value.trim()}
            onClick={() => value.trim() && onSubmit(value.trim())}
          >
            Convene
          </button>
        </div>
        <p className="ask__hint">Enter to send · Shift + Enter for a new line</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- full answer view */

export function AnswerPanel({
  seat, state, onClose,
}: {
  seat: SeatConfig | null;
  state: SeatState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!seat) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seat, onClose]);

  return (
    <div className={`sheet ${seat ? "is-open" : ""}`} aria-hidden={!seat}>
      <div className="sheet__scrim" onClick={onClose} />
      <article className="sheet__panel" style={{ "--accent": seat ? seatColor(seat.id) : "#fff" } as React.CSSProperties}>
        {seat && state && (
          <>
            <header className="sheet__head">
              <span
                className="sheet__emblem"
                aria-hidden
                style={{ "--mark": `url(/brand/emblem-${seat.id}.png)` } as React.CSSProperties}
              />
              <div>
                <h2>{seat.label}</h2>
                <p className="sheet__meta">
                  {seat.provider} · {state.modelUsed ?? seat.model}
                  {state.cached && " · from cache"}
                </p>
              </div>
              <button className="btn btn--icon" onClick={onClose} aria-label="Close">✕</button>
            </header>
            <div className="sheet__body">
              {state.error
                ? <p className="sheet__error">{state.error}</p>
                : <Prose text={state.text} />}
            </div>
          </>
        )}
      </article>
    </div>
  );
}

/* -------------------------------------------------------------------- deliberation */

export function Deliberation({ active }: { active: boolean }) {
  return (
    <div className={`deliberation ${active ? "is-open" : ""}`} aria-hidden={!active}>
      <p className="deliberation__title">The council deliberates</p>
      <p className="deliberation__sub">
        Each member is reading the others' answers — with every name removed.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------- ranking */

export function RankingPanel({
  open, ranking, seats, onContinue,
}: {
  open: boolean;
  ranking: RankingRow[];
  seats: SeatConfig[];
  onContinue: () => void;
}) {
  const labelFor = (id: string) => seats.find((s) => s.id === id)?.label ?? id;
  const top = ranking[0]?.score ?? 1;

  return (
    <div className={`ranking ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <h2 className="ranking__title">How the council judged each other</h2>
      <ol className="ranking__list">
        {ranking.map((row, i) => (
          <li key={row.label} style={{ "--accent": seatColor(row.seat), "--delay": `${i * 70}ms` } as React.CSSProperties}>
            <span className="ranking__pos">{i + 1}</span>
            <span className="ranking__name">{labelFor(row.seat)}</span>
            <span className="ranking__bar">
              {/* scaleX rather than width: width is a layout property and animating it
                  costs layout, paint and composite on every frame. */}
              <i style={{ transform: `scaleX(${top ? row.score / top : 0})` }} />
            </span>
            <span className="ranking__score">{row.score}</span>
          </li>
        ))}
      </ol>
      <button className="btn btn--primary btn--wide" onClick={onContinue}>
        Hear the verdict
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------- verdict */

export function Verdict({
  open, text, streaming, onNext, children,
}: {
  open: boolean;
  text: string;
  streaming: boolean;
  onNext: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`verdict ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="verdict__panel">
        <p className="verdict__eyebrow">The Chairman's verdict</p>
        <div className="verdict__body">
          <Prose text={text} />
          {streaming && <span className="caret" />}
        </div>
        {children}
      </div>
      <button className="btn btn--next" onClick={onNext}>
        Next question →
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------------- shared */

/**
 * Model output rendered as readable prose.
 *
 * Deliberately not a full markdown renderer: these models emit headings, bold and lists,
 * and that is nearly all they emit. Handling those four cases inline avoids a dependency
 * and, more importantly, avoids rendering half-finished markdown mid-stream as literal
 * asterisks.
 */
export function Prose({ text }: { text: string }) {
  if (!text) return null;

  return (
    <>
      {text.split(/\n{2,}/).map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        const heading = trimmed.match(/^(#{1,4})\s+(.*)$/s);
        if (heading) {
          const level = Math.min(4, heading[1].length + 1);
          const Tag = `h${level}` as "h2" | "h3" | "h4";
          return <Tag key={i}>{inline(heading[2])}</Tag>;
        }

        const lines = trimmed.split("\n");
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList && lines.length > 1) {
          const ordered = /^\s*\d+[.)]/.test(lines[0]);
          const items = lines.map((l, j) => (
            <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>
          ));
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }

        return <p key={i}>{inline(trimmed)}</p>;
      })}
    </>
  );
}

/** Bold and inline code. Unmatched markers are left alone rather than half-applied. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/* ------------------------------------------------------------------------ tabulate */

/**
 * Every member's position, side by side, in one line each.
 *
 * Four full answers cannot be compared by reading them in sequence -- by the time you
 * reach the fourth you have lost the first. One line each, on one screen, is the only
 * arrangement in which the council's spread is actually visible.
 */
export function Tabulate({
  open, positions, ranking, seats, disagreement, onContinue,
}: {
  open: boolean;
  positions: Position[];
  ranking: RankingRow[];
  seats: SeatConfig[];
  disagreement: string[];
  onContinue: () => void;
}) {
  const rankOf = (seatId: string) => {
    const index = ranking.findIndex((r) => r.seat === seatId);
    return index < 0 ? null : index + 1;
  };
  const labelFor = (id: string) => seats.find((s) => s.id === id)?.label ?? id;

  return (
    <div className={`tabulate ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="tabulate__panel">
        <header className="tabulate__head">
          <h2>Where the council stood</h2>
          <p>One line each, in the order they were ranked.</p>
        </header>

        <ul className="tabulate__list">
          {positions.map((position, i) => (
            <li
              key={position.label}
              style={{
                "--accent": seatColor(position.seat),
                "--mark": `url(/brand/emblem-${position.seat}.png)`,
                "--delay": `${i * 60}ms`,
              } as React.CSSProperties}
            >
              <span className="tabulate__emblem" aria-hidden />
              <span className="tabulate__who">
                <strong>{labelFor(position.seat)}</strong>
                {rankOf(position.seat) && (
                  <span className="tabulate__rank">#{rankOf(position.seat)}</span>
                )}
              </span>
              <span className="tabulate__said">{position.text}</span>
            </li>
          ))}
        </ul>

        {disagreement.length > 0 && (
          <section className="conflict">
            <h3>Where they disagreed</h3>
            <ul>
              {disagreement.map((point, i) => (
                <li key={i} style={{ "--delay": `${(positions.length + i) * 60}ms` } as React.CSSProperties}>
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}

        <button className="btn btn--primary btn--wide" onClick={onContinue}>
          Hear the verdict
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- dissent */

/**
 * The member the council ranked last, asked whether it stands by its answer.
 *
 * A single chatbot cannot do this: there is no room to have overruled it. Costs one
 * request, so it is offered rather than fetched automatically.
 */
export function DissentPanel({
  seat, dissent, pending, onAsk, onClose,
}: {
  seat: SeatConfig | null;
  dissent: DissentData | null;
  pending: boolean;
  onAsk: () => void;
  onClose: () => void;
}) {
  if (!seat) return null;
  const open = pending || Boolean(dissent);

  return (
    <>
      {!open && (
        <button className="dissent__invite" onClick={onAsk}>
          <span
            className="dissent__emblem"
            aria-hidden
            style={{
              "--accent": seatColor(seat.id),
              "--mark": `url(/brand/emblem-${seat.id}.png)`,
            } as React.CSSProperties}
          />
          Ask {seat.label} why it disagreed
          <span className="dissent__cost">1 request</span>
        </button>
      )}

      <div className={`dissent ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <div
          className="dissent__panel"
          style={{ "--accent": seatColor(seat.id) } as React.CSSProperties}
        >
          <header>
            <p className="dissent__eyebrow">Ranked last · defending its answer</p>
            <h3>{seat.label}</h3>
            <button className="btn btn--icon" onClick={onClose} aria-label="Close">✕</button>
          </header>
          {pending
            ? <p className="dissent__waiting">Putting it to them<span className="ellipsis" /></p>
            : dissent?.ok
              ? <Prose text={dissent.text ?? ""} />
              : <p className="sheet__error">{dissent?.error ?? "No reply."}</p>}
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------------- follow-ups */

export function FollowUps({
  questions, onAsk,
}: {
  questions: string[];
  onAsk: (question: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <div className="followups">
      <p className="followups__label">Ask next</p>
      <div className="followups__row">
        {questions.map((question, i) => (
          <button
            key={question}
            className="followups__chip"
            style={{ "--delay": `${i * 70}ms` } as React.CSSProperties}
            onClick={() => onAsk(question)}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
