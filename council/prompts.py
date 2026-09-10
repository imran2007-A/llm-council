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
    "Write the answer the questioner actually needs. Do not refer to responses by their letters "
    "and do not describe the council's process."
)

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
        {"role": "system", "content": CHAIRMAN_SYSTEM},
        {
            "role": "user",
            "content": CHAIRMAN_TEMPLATE.format(
                context=history_block(history), question=question, blocks=blocks,
                ranking=ranking,
            ),
        },
    ]
