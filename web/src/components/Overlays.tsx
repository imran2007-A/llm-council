import { useEffect, useRef, useState } from "react";
import type { RankingRow, SeatConfig, SeatState } from "../types";
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
              <i style={{ width: `${top ? (row.score / top) * 100 : 0}%` }} />
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
  open, text, streaming, onNext,
}: {
  open: boolean;
  text: string;
  streaming: boolean;
  onNext: () => void;
}) {
  return (
    <div className={`verdict ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="verdict__panel">
        <p className="verdict__eyebrow">The Chairman's verdict</p>
        <div className="verdict__body">
          <Prose text={text} />
          {streaming && <span className="caret" />}
        </div>
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
