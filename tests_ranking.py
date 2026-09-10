"""Quick checks on the two pieces that silently corrupt a run if they're wrong:
ranking parsing (free models mangle formats) and Borda aggregation.

Run: python tests_ranking.py
"""

import random

from council.ranking import anonymise, borda, parse_ranking

LABELS = ["A", "B", "C", "D"]
failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


# --- parse_ranking: the format we asked for --------------------------------
check("clean", parse_ranking("blah\n\nRANKING: C > A > D > B", LABELS), ["C", "A", "D", "B"])
check("lowercase key", parse_ranking("ranking: B > A > C > D", LABELS), ["B", "A", "C", "D"])
check("no spaces", parse_ranking("RANKING:D>C>B>A", LABELS), ["D", "C", "B", "A"])
check("trailing prose", parse_ranking("RANKING: A > B > C > D\nHope that helps!", LABELS),
      ["A", "B", "C", "D"])
check("two rankings, last wins",
      parse_ranking("RANKING: A > B\nOn reflection.\nRANKING: D > C", LABELS), ["D", "C"])

# --- parse_ranking: degraded formats ---------------------------------------
check("bare arrow line", parse_ranking("My order: B > D > A > C", LABELS), ["B", "D", "A", "C"])
check("numbered list", parse_ranking("1. C\n2. A\n3. D\n4. B", LABELS), ["C", "A", "D", "B"])
check("numbered with word", parse_ranking("1) Response D\n2) Response B", LABELS), ["D", "B"])
check("duplicates dropped", parse_ranking("RANKING: A > A > B > C", LABELS), ["A", "B", "C"])
check("unknown labels dropped", parse_ranking("RANKING: A > Z > B", LABELS), ["A", "B"])
check("partial ranking kept", parse_ranking("RANKING: C > A", LABELS), ["C", "A"])

# --- parse_ranking: nothing usable -----------------------------------------
check("prose only", parse_ranking("They were all pretty good honestly.", LABELS), None)
check("single label", parse_ranking("RANKING: B", LABELS), None)
check("empty", parse_ranking("", LABELS), None)

# --- borda ------------------------------------------------------------------
# Unanimous: A first every time.
check("unanimous", borda([["A", "B", "C", "D"]] * 3, LABELS),
      [("A", 9), ("B", 6), ("C", 3), ("D", 0)])

# Perfectly opposed reviewers cancel out; ties break alphabetically.
check("opposed", borda([["A", "B", "C", "D"], ["D", "C", "B", "A"]], LABELS),
      [("A", 3), ("B", 3), ("C", 3), ("D", 3)])

# A reviewer who only ranked two items still contributes.
check("partial contributes", borda([["B", "A"]], LABELS),
      [("B", 1), ("A", 0), ("C", 0), ("D", 0)])

check("no rankings at all", borda([], LABELS),
      [("A", 0), ("B", 0), ("C", 0), ("D", 0)])

# --- anonymise --------------------------------------------------------------
replies = [("gemini", "g"), ("llama", "l"), ("gptoss", "o"), ("nemotron", "n")]
anon = anonymise(replies, rng=random.Random(7))
check("labels assigned", anon.labels, ["A", "B", "C", "D"])
check("mapping is a bijection", sorted(anon.label_to_seat.values()),
      sorted(s for s, _ in replies))
check("blocks hide identity", any(seat in anon.blocks for seat, _ in replies), False)

# Shuffling actually shuffles: two different seeds should differ at least sometimes.
orders = {tuple(anonymise(replies, rng=random.Random(s)).label_to_seat.values())
          for s in range(20)}
check("shuffle varies", len(orders) > 1, True)

# --- prompt size is bounded -------------------------------------------------
# Regression: the chairman prompt quotes every answer back, so four long answers plus
# conversation history pushed the request past Groq's size limit and returned HTTP 413.
from council.config import MAX_RESPONSE_CHARS  # noqa: E402

huge = [(f"seat{i}", "y" * 20000) for i in range(4)]
blocks = anonymise(huge, rng=random.Random(1)).blocks
check("blocks stay bounded however long the answers are",
      len(blocks) < 4 * (MAX_RESPONSE_CHARS + 200), True)
check("truncation is visible to the reviewer", "truncated" in blocks, True)

short_blocks = anonymise([("a", "tiny"), ("b", "also tiny")]).blocks
check("short answers are quoted whole", "truncated" in short_blocks, False)

if failures:
    print(f"{len(failures)} FAILED\n")
    print("\n".join(failures))
    raise SystemExit(1)
print("all ranking tests passed")
