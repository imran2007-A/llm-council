"""The three stage prompts. Kept in one file so they're easy to iterate on."""

# How much earlier conversation to carry forward.
#
# The council's shared memory is its *verdicts*, not every member's opinion. Replaying all
# four opinions per turn would multiply context cost by four and mostly repeat itself; the
# verdict is what the council actually concluded.
HISTORY_TURNS = 4
HISTORY_CHARS = 1200


def history_block(history) -> str:
    """Prior turns as context, or "" when this is the first question."""
    if not history:
        return ""
    lines = ["<earlier_in_this_conversation>"]
    for turn in list(history)[-HISTORY_TURNS:]:
        verdict = (turn.get("verdict") or "").strip()
        if len(verdict) > HISTORY_CHARS:
            verdict = verdict[:HISTORY_CHARS].rstrip() + " [...]"
        lines.append("")
        lines.append(f"Q: {turn.get('question', '').strip()}")
        lines.append(f"The council concluded: {verdict}")
    lines.append("</earlier_in_this_conversation>")
    lines.append("")
    return "\n".join(lines)


OPINION_SYSTEM = (
    "You are a member of an expert council convened to answer a difficult question. "
    "Give your own best answer, independently. Be substantive and specific rather than "
    "hedging. If the question has a genuine tradeoff, name it. If you are uncertain about "
    "something, say so plainly instead of padding. Do not mention that you are part of a council."
)


def opinion_messages(question: str, history=()) -> list[dict]:
    context = history_block(history)
    return [
        {"role": "system", "content": OPINION_SYSTEM},
        {"role": "user", "content": f"{context}{question}" if context else question},
    ]


REVIEW_SYSTEM = (
    "You are reviewing anonymous answers submitted to an expert council. "
    "One of them may be your own; you cannot tell which, and it does not matter. "
    "Judge only on accuracy, insight, and usefulness to the person who asked."
)

REVIEW_TEMPLATE = """{context}The council was asked:

<question>
{question}
</question>

Here are the anonymous responses:

{blocks}

Reply in exactly this order.

First line, and nothing before it -- your ranking of all {n} responses, best to worst:

RANKING: {example}

Then a short critique of each response, 2-3 sentences each. Name concrete strengths and
concrete errors or omissions. Do not be diplomatic at the expense of being useful.

Judge the substance, not the length. If a response appears to stop mid-sentence it was cut
off by a token limit -- rank what is there, and do not penalise it for being incomplete.
"""


def review_messages(question: str, blocks: str, labels: list[str], history=()) -> list[dict]:
    example = " > ".join(labels)
    return [
        {"role": "system", "content": REVIEW_SYSTEM},
        {
            "role": "user",
            "content": REVIEW_TEMPLATE.format(
                context=history_block(history), question=question, blocks=blocks,
                n=len(labels), example=example,
            ),
        },
    ]


CHAIRMAN_SYSTEM = (
    "You are the Chairman of an expert council. You have the council members' independent "
    "answers and their anonymous peer rankings. Your job is to deliver the final verdict to "
    "the person who asked.\n\n"
    "Synthesise, do not summarise. Take the strongest reasoning wherever it appears, including "
    "from a low-ranked response. Where the council genuinely disagrees, say so and give your own "
    "judgement on who is right and why. Where they agree on something that is wrong, say that too. "
    "Write the answer the questioner actually needs."
)

# The Chairman is already reading every answer and every ranking, so the comparison table,
# the points of conflict and the follow-up questions all come out of the SAME request.
# Asking a second model for them would cost another slot against a 50-a-day budget for
# information this one already has in front of it.
CHAIRMAN_SECTIONS = """

After the verdict, and only after it, add these three sections using exactly these
headings, each on its own line:

===POSITIONS===
One line per response, formatted `A: <that response's position in under 15 words>`.
Cover every response you were given. State what it actually argued, not whether it was
good. If two responses agree, say so in both lines rather than merging them.

===DISAGREEMENT===
The points on which the responses genuinely conflict, one per line, each under 20 words.
Only real conflicts -- differing recommendations, incompatible claims, opposite advice.
If they substantively agreed, write the single line: None.

===FOLLOW-UPS===
Three questions the person would sensibly ask next, one per line, no numbering. Each must
be a complete question that stands on its own without this conversation for context."""

CHAIRMAN_TEMPLATE = """{context}The council was asked:

<question>
{question}
</question>

The council's responses:

{blocks}

Aggregate peer ranking (best first, by Borda count across all reviewers):

{ranking}

Write the final verdict."""


def chairman_messages(question: str, blocks: str, ranking: str, history=()) -> list[dict]:
    return [
        {"role": "system", "content": CHAIRMAN_SYSTEM + CHAIRMAN_SECTIONS},
        {
            "role": "user",
            "content": CHAIRMAN_TEMPLATE.format(
                context=history_block(history), question=question, blocks=blocks,
                ranking=ranking,
            ),
        },
    ]


DISSENT_SYSTEM = (
    "You are a member of an expert council. Your answer was ranked lowest by your peers, "
    "who could not see whose answer was whose. You are being asked to defend it.\n\n"
    "Do not capitulate and do not grovel. If you still believe you were right, say why, and "
    "name what the others missed. If on reflection you were wrong, say precisely where and "
    "what changed your mind -- that is a real answer too. Be specific and be brief."
)

DISSENT_TEMPLATE = """The council was asked:

<question>
{question}
</question>

This was your answer:

<your_answer>
{own}
</your_answer>

This is what the council collectively concluded:

<verdict>
{verdict}
</verdict>

Your answer was ranked last. In under 200 words: do you stand by it, and what do you think
the others got wrong?"""


def dissent_messages(question: str, own: str, verdict: str) -> list[dict]:
    return [
        {"role": "system", "content": DISSENT_SYSTEM},
        {"role": "user", "content": DISSENT_TEMPLATE.format(
            question=question, own=own, verdict=verdict)},
    ]
