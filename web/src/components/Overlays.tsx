import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

/** Drawn rather than a unicode glyph, so it matches stroke weight with everything else. */
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3 3l8 8M11 3l-8 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
    <div className={`ask ${open ? "is-open" : ""}`} inert={!open}>
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
    <div className={`sheet ${seat ? "is-open" : ""}`} inert={!seat}>
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
              <button className="btn btn--icon" onClick={onClose} aria-label="Close">
                <CloseIcon />
              </button>
            </header>
            <div className="sheet__body">
              {state.error
                ? <p className="sheet__error">{state.error}</p>
                : <Prose text={state.answer || state.text} />}
            </div>
          </>
        )}
      </article>
    </div>
  );
}

/* -------------------------------------------------------------------- deliberation */

/**
 * The narration for a waiting phase.
 *
 * `answering` is the longest wait in the product and used to carry no copy at all, while
 * the shorter stage that follows it had the best line in the build. Both go through here
 * now, so the reassurance lands where the waiting actually happens.
 */
export function Stage({
  active, title, detail,
}: {
  active: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className={`deliberation ${active ? "is-open" : ""}`} inert={!active}>
      {/* A heading, not a paragraph dressed as one: it is the only text on screen and it
          names the stage. */}
      <h2 className="deliberation__title">{title}</h2>
      <p className="deliberation__sub">{detail}</p>
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
    <div className={`ranking ${open ? "is-open" : ""}`} inert={!open}>
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
        See where they stood
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------- verdict */

export function Verdict({
  open, text, question, streaming, onNext, onBack, children,
}: {
  open: boolean;
  text: string;
  question: string;
  streaming: boolean;
  onNext: () => void;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(question ? `Q: ${question}\n\n${text}` : text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the button simply does not confirm.
    }
  };

  return (
    <div className={`verdict ${open ? "is-open" : ""}`} inert={!open}>
      <div className="verdict__panel">
        <div className="verdict__head">
          <h2 className="verdict__title">The Chairman's verdict</h2>
          <button className="btn btn--quiet" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {/* The question was previously gone the moment it was submitted, so the verdict
            had to be judged against something the reader could no longer see. */}
        {question && <p className="verdict__question">{question}</p>}
        <div className="verdict__body">
          <Prose text={text} />
          {streaming && <span className="caret" />}
        </div>
        {children}
      </div>
      <div className="verdict__actions">
        <button className="btn btn--quiet" onClick={onBack}>
          ← Where they stood
        </button>
        <button className="btn btn--next" onClick={onNext}>
          Next question
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- shared */

/**
 * Model output rendered as readable prose.
 *
 * This was a hand-rolled renderer handling headings, bold, code and flat lists -- which
 * is most of what models emit, but not all of it. Tables came through as pipe salad,
 * nested lists flattened, fenced code blocks lost their fencing, and links rendered as
 * raw bracket syntax. Given the whole point of the verdict panel is reading a long
 * answer, that was the wrong place to save a dependency.
 *
 * remark-gfm is what adds tables, strikethrough and task lists on top of CommonMark --
 * models reach for all three unprompted.
 */
export function Prose({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Model output is data, not markup: an <a> here would be a link the council
          // wrote, not one the user chose. Kept visible and readable, opened safely.
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
          ),
          // Wide tables scroll inside their own box rather than widening the panel.
          table: ({ children }) => (
            <div className="prose__scroll"><table>{children}</table></div>
          ),
          pre: ({ children }) => (
            <div className="prose__scroll"><pre>{children}</pre></div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------------ tabulate */

/**
 * Every member's position, side by side.
 *
 * This was a stacked list -- one row per model -- which is a ranking, not a comparison.
 * Reading four positions down a column means holding the first in your head until you
 * reach the fourth, which is exactly the work the table is supposed to remove. Columns
 * put them beside each other, where the spread is visible without remembering anything.
 *
 * Collapsed, each column is one line: scannable across four at a glance. Expanded, the
 * same columns carry the full answers, each scrolling independently, so the arrangement
 * never changes underneath you -- only the depth does.
 */
export function Tabulate({
  open, positions, ranking, seats, answers, disagreement, onContinue,
}: {
  open: boolean;
  positions: Position[];
  ranking: RankingRow[];
  seats: SeatConfig[];
  answers: Record<string, SeatState>;
  disagreement: string[];
  onContinue: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Collapse whenever the panel closes, so returning from the verdict does not land on
  // a wall of text you last opened two questions ago.
  useEffect(() => { if (!open) setExpanded(false); }, [open]);

  const rankOf = (seatId: string) => {
    const index = ranking.findIndex((r) => r.seat === seatId);
    return index < 0 ? null : index + 1;
  };
  const labelFor = (id: string) => seats.find((s) => s.id === id)?.label ?? id;

  // The subtitle claims ranked order, so deliver it. Anything the ranking never saw
  // sorts to the end rather than to the front.
  const ordered = [...positions].sort(
    (a, b) => (rankOf(a.seat) ?? 99) - (rankOf(b.seat) ?? 99),
  );

  const anyFullText = ordered.some((p) => answers[p.seat]?.text);

  return (
    <div className={`tabulate ${open ? "is-open" : ""}`} inert={!open}>
      <div className={`tabulate__panel ${expanded ? "is-expanded" : ""}`}>
        <header className="tabulate__head">
          <div>
            <h2>Where the council stood</h2>
            <p>
              {expanded
                ? "Every answer in full, in the order they were ranked."
                : "One line each, in the order they were ranked."}
            </p>
          </div>
          {anyFullText && (
            <button
              className="btn btn--ghost tabulate__toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "Collapse answers" : "Expand answers"}
            </button>
          )}
        </header>

        <div className="tabulate__grid" data-count={ordered.length}>
          {ordered.map((position, i) => {
            const full = answers[position.seat]?.answer ?? "";
            return (
              <article
                className="tabulate__col"
                key={position.label}
                style={{
                  "--accent": seatColor(position.seat),
                  "--mark": `url(/brand/emblem-${position.seat}.png)`,
                  "--delay": `${i * 70}ms`,
                } as React.CSSProperties}
              >
                <header className="tabulate__who">
                  <span className="tabulate__emblem" aria-hidden />
                  <strong>{labelFor(position.seat)}</strong>
                  {rankOf(position.seat) && (
                    <span className="tabulate__rank">#{rankOf(position.seat)}</span>
                  )}
                </header>
                <p className="tabulate__said">{position.text}</p>
                {expanded && (
                  <div className="tabulate__full">
                    {full
                      ? <Prose text={full} />
                      : <p className="tabulate__missing">No answer was recorded.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>

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

      <div className={`dissent ${open ? "is-open" : ""}`} inert={!open}>
        <div
          className="dissent__panel"
          style={{ "--accent": seatColor(seat.id) } as React.CSSProperties}
        >
          <header>
            <h3>{seat.label}</h3>
            <p className="dissent__note">Ranked last, defending its answer</p>
            <button className="btn btn--icon" onClick={onClose} aria-label="Close">
                <CloseIcon />
              </button>
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
