"""Checks on parsing the Chairman's structured sections.

Free models ignore output formats constantly, so the interesting cases here are the
malformed ones: the parser must always yield a usable verdict, whatever else it loses.

Run: python tests_synthesis.py
"""

from council import synthesis

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


WELL_FORMED = """The answer is Postgres, and it is not close.

Relational integrity matters more than schema flexibility here.

===POSITIONS===
A: Recommends Postgres for relational integrity
B: Recommends MongoDB for iteration speed
C: Says either works, pick by team familiarity
D: Recommends Postgres with JSONB columns

===DISAGREEMENT===
Whether schema flexibility outweighs relational guarantees early on
Whether JSONB is a real substitute for a document store

===FOLLOW-UPS===
How do I model many-to-many relationships in Postgres?
When would JSONB become a performance problem?
What does migrating from MongoDB to Postgres actually involve?
"""

s = synthesis.parse(WELL_FORMED)
check("verdict stops at the first heading", s.verdict.endswith("here."), True)
check("verdict excludes the sections", "===POSITIONS===" in s.verdict, False)
check("all positions captured", len(s.positions), 4)
check("position text", s.positions["B"], "Recommends MongoDB for iteration speed")
check("disagreements captured", len(s.disagreement), 2)
check("follow-ups captured", len(s.followups), 3)

# --- resolving labels back to seats -----------------------------------------
resolved = s.resolve({"A": "qwen", "B": "gemini", "C": "gptoss", "D": "nemotron"})
check("positions resolve to seats", [p["seat"] for p in resolved["positions"]],
      ["qwen", "gemini", "gptoss", "nemotron"])
check("unknown labels are dropped",
      len(synthesis.parse(WELL_FORMED).resolve({"A": "qwen"})["positions"]), 1)

# --- decorated headings ------------------------------------------------------
DECORATED = """Verdict text.

**POSITIONS**
- A: first
- B: second

## Disagreement
- they differ on scope

FOLLOW UPS:
1. Is this a real question?
"""
d = synthesis.parse(DECORATED)
check("bold heading recognised", len(d.positions), 2)
check("bullets stripped from positions", d.positions["A"], "first")
check("markdown heading recognised", d.disagreement, ["they differ on scope"])
check("numbering stripped from follow-ups", d.followups, ["Is this a real question?"])

# --- alternate position separators -------------------------------------------
ALT = """V.

===POSITIONS===
Response A - uses a dash
B) uses a bracket
C. uses a dot
"""
a = synthesis.parse(ALT)
check("dash separator", a.positions.get("A"), "uses a dash")
check("bracket separator", a.positions.get("B"), "uses a bracket")
check("dot separator", a.positions.get("C"), "uses a dot")

# --- graceful degradation ----------------------------------------------------
check("no headings: everything is the verdict",
      synthesis.parse("Just a plain answer.").verdict, "Just a plain answer.")
check("no headings: no positions invented",
      synthesis.parse("Just a plain answer.").positions, {})
check("empty input", synthesis.parse("").verdict, "")

NO_CONFLICT = """V.

===DISAGREEMENT===
None
"""
check("'None' means no disagreement", synthesis.parse(NO_CONFLICT).disagreement, [])

SECTIONS_FIRST = """===POSITIONS===
A: something

The verdict came after, which is not what was asked for.
"""
sf = synthesis.parse(SECTIONS_FIRST)
check("verdict never comes back empty", bool(sf.verdict.strip()), True)

PROSE_IN_FOLLOWUPS = """V.

===FOLLOW-UPS===
Here are some questions you might ask.
What should I do next?
Thanks for reading.
"""
check("only questions survive in follow-ups",
      synthesis.parse(PROSE_IN_FOLLOWUPS).followups, ["What should I do next?"])

TRUNCATED = """The verdict was going strong and then

===POSITIONS===
A: a complete line
B: a line cut off mid-"""
t = synthesis.parse(TRUNCATED)
check("truncation keeps what parsed", len(t.positions), 2)
check("truncation keeps the verdict", t.verdict.endswith("then"), True)

if failures:
    print(f"{len(failures)} FAILED\n")
    print("\n".join(failures))
    raise SystemExit(1)
print("all synthesis tests passed")
