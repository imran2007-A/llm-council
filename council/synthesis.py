"""Pulling the structured extras out of the Chairman's reply.

The Chairman is asked to append three sections after its verdict: each response's position
in a line, the points of genuine conflict, and sensible follow-up questions. All three come
from the request it was already making, which matters when the budget is fifty requests a
day.

Everything here degrades rather than fails. A free model that ignores the format costs the
comparison table, not the verdict -- so the parser always returns something usable, and the
verdict text is recovered even when the headings never appear.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Models are inconsistent about decoration around headings: ===POSITIONS===, **POSITIONS**,
# ## Positions, POSITIONS:. Match the word on a line of its own, however it is dressed up.
_HEADING = re.compile(
    r"^[\s#*_=\-]*(POSITIONS|DISAGREEMENTS?|FOLLOW[\s\-]?UPS?)[\s#*_=:\-]*$",
    re.IGNORECASE | re.MULTILINE,
)

_CANON = {"POSITIONS": "positions", "DISAGREEMENT": "disagreement", "FOLLOWUP": "followups"}


def _canonical(raw: str) -> str:
    key = re.sub(r"[^A-Z]", "", raw.upper())
    if key.startswith("POSITION"):
        return "positions"
    if key.startswith("DISAGREE"):
        return "disagreement"
    return "followups"


@dataclass
class Synthesis:
    """The verdict, plus whatever structure could be recovered alongside it."""

    verdict: str = ""
    #: anonymous label -> one-line position, e.g. {"A": "Recommends Postgres for..."}
    positions: dict[str, str] = field(default_factory=dict)
    disagreement: list[str] = field(default_factory=list)
    followups: list[str] = field(default_factory=list)

    def resolve(self, label_to_seat: dict[str, str]) -> dict:
        """Swap anonymous labels for seat ids, for display."""
        return {
            "verdict": self.verdict,
            "positions": [
                {"label": label, "seat": label_to_seat.get(label), "text": text}
                for label, text in sorted(self.positions.items())
                if label_to_seat.get(label)
            ],
            "disagreement": self.disagreement,
            "followups": self.followups,
        }


def _clean_line(line: str) -> str:
    """Strip bullets, numbering and stray emphasis from a list item."""
    line = line.strip()
    line = re.sub(r"^[\-\*•–]\s*", "", line)
    line = re.sub(r"^\d+[.)]\s*", "", line)
    return line.strip(" *_`").strip()


def parse(text: str) -> Synthesis:
    if not text:
        return Synthesis()

    matches = list(_HEADING.finditer(text))
    if not matches:
        # No headings at all: the whole reply is the verdict. Common with smaller models,
        # and entirely survivable -- the verdict is the part that matters.
        return Synthesis(verdict=text.strip())

    result = Synthesis(verdict=text[: matches[0].start()].strip())

    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[match.end() : end].strip()
        section = _canonical(match.group(1))

        if section == "positions":
            for raw in body.splitlines():
                line = _clean_line(raw)
                # "A: text", "Response A - text", "A) text"
                m = re.match(r"^(?:response\s+)?([A-Z])\s*[:.)\-–]\s*(.+)$", line, re.I)
                if m and m.group(2).strip():
                    result.positions[m.group(1).upper()] = m.group(2).strip()

        elif section == "disagreement":
            lines = [_clean_line(l) for l in body.splitlines()]
            lines = [l for l in lines if l and len(l) > 3]
            # The prompt asks for the literal word "None" when the council agreed.
            if len(lines) == 1 and lines[0].rstrip(".").lower() in {"none", "no disagreement"}:
                lines = []
            result.disagreement = lines[:6]

        else:
            lines = [_clean_line(l) for l in body.splitlines()]
            # Only keep things that actually read as questions; models sometimes continue
            # prose past the heading and it would be shown as a clickable question.
            result.followups = [l for l in lines if l.endswith("?") and len(l) > 10][:3]

    # A model that puts the sections first leaves nothing before the first heading. Better
    # to show the whole reply than an empty verdict panel.
    if not result.verdict:
        result.verdict = text.strip()

    return result
