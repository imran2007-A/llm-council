"""Anonymisation, defensive ranking parsing, and Borda aggregation."""

from __future__ import annotations

import random
import re
import string
from dataclasses import dataclass


@dataclass
class Anonymised:
    labels: list[str]              # ["A", "B", "C", "D"]
    label_to_seat: dict[str, str]  # {"A": "gemini", ...}
    blocks: str                    # the text handed to reviewers

    def seat(self, label: str) -> str:
        return self.label_to_seat[label]


def anonymise(replies: list[tuple[str, str]], rng: random.Random | None = None) -> Anonymised:
    """replies is [(seat_id, text), ...]. Shuffle, relabel A/B/C/D, build the review blocks.

    Shuffling matters: without it, label A is always the same seat and a reviewer that
    favours position 1 would silently bias every run the same way.
    """
    rng = rng or random.Random()
    shuffled = list(replies)
    rng.shuffle(shuffled)

    labels = list(string.ascii_uppercase[: len(shuffled)])
    label_to_seat = {label: seat_id for label, (seat_id, _) in zip(labels, shuffled)}

    blocks = "\n\n".join(
        f"<response id=\"{label}\">\n{text}\n</response>"
        for label, (_, text) in zip(labels, shuffled)
    )
    return Anonymised(labels, label_to_seat, blocks)


def parse_ranking(text: str, valid: list[str]) -> list[str] | None:
    """Pull an ordering out of a review. Returns None if nothing usable is in there.

    Free models are unreliable about output format, so this tries the requested format
    first and then degrades, rather than throwing and killing the run.
    """
    if not text:
        return None
    valid_set = set(valid)

    def clean(found: list[str]) -> list[str] | None:
        seen: list[str] = []
        for label in found:
            if label in valid_set and label not in seen:
                seen.append(label)
        return seen if len(seen) >= 2 else None

    # 1. The format we asked for: a trailing "RANKING: B > A > D > C".
    matches = re.findall(r"RANKING\s*:\s*([^\n\r]+)", text, flags=re.IGNORECASE)
    if matches:
        found = re.findall(r"\b([A-Z])\b", matches[-1])
        if (result := clean(found)) is not None:
            return result

    # 2. Any line that looks like an ordering, last one wins.
    for line in reversed(text.splitlines()):
        if ">" in line:
            found = re.findall(r"\b([A-Z])\b", line)
            if (result := clean(found)) is not None:
                return result

    # 3. A numbered list of labels: "1. C", "2) A", ...
    found = re.findall(r"^\s*\d+[.)]\s*(?:Response\s+)?([A-Z])\b", text, flags=re.MULTILINE)
    if (result := clean(found)) is not None:
        return result

    return None


def borda(rankings: list[list[str]], labels: list[str]) -> list[tuple[str, int]]:
    """Aggregate rankings into one ordering.

    Borda count: in a ranking of n items, first place scores n-1, last scores 0. Labels a
    reviewer left out simply score nothing from that reviewer, so partial rankings are fine.
    Ties break alphabetically, so the same inputs always produce the same output.
    """
    scores = {label: 0 for label in labels}
    for ranking in rankings:
        n = len(ranking)
        for position, label in enumerate(ranking):
            if label in scores:
                scores[label] += n - 1 - position
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
