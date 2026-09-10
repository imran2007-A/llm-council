"""LLM Council -- terminal edition.

    python cli.py "your question"
    python cli.py --dry-run "test the pipeline with no API calls"
    python cli.py --cache "iterate on prompts without re-spending stage 1"
    python cli.py --seats 2 "run a smaller council while developing"
    python cli.py --replay 20260910-224500
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table

from council import storage
from council.config import CHAIRMAN, PROVIDERS, SEATS, seat_by_id
from council.council import run_council

# Windows consoles default to cp1252, which cannot encode characters these models emit
# routinely (non-breaking hyphens, em dashes, arrows). Without this, a run that succeeded
# in full still dies while printing. errors="replace" is the belt to this braces.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

console = Console()

STAGE_TITLES = {
    "opinions": "Stage 1 - First opinions",
    "review": "Stage 2 - Anonymous peer review",
    "chairman": "Stage 3 - The Chairman's verdict",
}


def label_of(seat_id: str) -> str:
    seat = seat_by_id(seat_id)
    return seat.label if seat else seat_id


def make_handler(verbose: bool):
    """Live progress. Deliberately terse -- the full text is printed per stage afterwards."""

    def handle(event: dict) -> None:
        kind = event["type"]
        if kind == "stage_changed":
            console.print()
            console.print(Rule(STAGE_TITLES.get(event["stage"], event["stage"])))
        elif kind == "seat_started":
            console.print(f"  [dim]... {label_of(event['seat'])}[/dim]")
        elif kind == "cache_hit":
            console.print(f"  [cyan]cached[/cyan] {label_of(event['seat'])}")
        elif kind == "seat_finished":
            if event["ok"]:
                console.print(f"  [green]done[/green]   {label_of(event['seat'])}")
            else:
                console.print(
                    f"  [red]failed[/red] {label_of(event['seat'])} "
                    f"[dim]({event['error']})[/dim]"
                )

    return handle


def print_opinions(transcript: dict) -> None:
    console.print()
    for op in transcript["opinions"]:
        title = label_of(op["seat"])
        if op["ok"]:
            console.print(Panel(Markdown(op["text"]), title=title, border_style="blue"))
        else:
            console.print(Panel(f"[red]{op['error']}[/red]", title=title, border_style="red"))


def print_reviews(transcript: dict) -> None:
    if not transcript.get("reviews"):
        if reason := transcript.get("skipped_review"):
            console.print(f"[yellow]Review stage skipped: {reason}[/yellow]")
        return

    console.print()
    for rv in transcript["reviews"]:
        title = f"{label_of(rv['seat'])} reviewing"
        if rv["ok"]:
            body = Markdown(rv["text"])
            if not rv["ranking_labels"]:
                title += "  [yellow](no usable ranking)[/yellow]"
            console.print(Panel(body, title=title, border_style="magenta"))
        else:
            console.print(Panel(f"[red]{rv['error']}[/red]", title=title, border_style="red"))

    ranking = transcript.get("ranking") or []
    if ranking:
        table = Table(title="Aggregate peer ranking (Borda count)", title_style="bold")
        table.add_column("#", justify="right")
        table.add_column("Model")
        table.add_column("Anon label", justify="center")
        table.add_column("Score", justify="right")
        for i, row in enumerate(ranking, 1):
            table.add_row(str(i), label_of(row["seat"]), row["label"], str(row["score"]))
        console.print()
        console.print(table)
        submitted = transcript.get("rankings_submitted", 0)
        console.print(
            f"[dim]{submitted} of {len(transcript['reviews'])} reviewers "
            f"submitted a parseable ranking.[/dim]"
        )


def print_verdict(transcript: dict) -> None:
    verdict = transcript.get("verdict")
    if not verdict:
        return
    console.print()
    if verdict["ok"]:
        console.print(Panel(Markdown(verdict["text"]), title="Final verdict",
                            border_style="green"))
    else:
        console.print(Panel(f"[red]{verdict['error']}[/red]", title="Chairman failed",
                            border_style="red"))


def print_budget(transcript: dict) -> None:
    budget = transcript.get("budget")
    if not budget:
        return
    parts = []
    for provider_name, count in sorted(budget["calls"].items()):
        provider = PROVIDERS[provider_name]
        parts.append(f"{provider_name} {count}/{provider.rpd} today")
    line = "  |  ".join(parts) if parts else "no API calls"
    console.print()
    console.print(
        f"[dim]Requests this run: {budget['total']} ({line}). "
        f"Retries: {budget['retries']}. Elapsed: {transcript.get('elapsed')}s.[/dim]"
    )
    console.print(f"[dim]Transcript: {transcript.get('path')}[/dim]")


def render(transcript: dict) -> None:
    print_opinions(transcript)
    print_reviews(transcript)
    print_verdict(transcript)
    print_budget(transcript)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ask a council of LLMs a question.")
    parser.add_argument("question", nargs="*", help="the question to put to the council")
    parser.add_argument("--dry-run", action="store_true",
                        help="fake responses, zero API calls")
    parser.add_argument("--cache", action="store_true",
                        help="reuse stage-1 answers for a question already asked")
    parser.add_argument("--seats", type=int, default=len(SEATS),
                        help=f"how many council seats to use (1-{len(SEATS)})")
    parser.add_argument("--replay", metavar="RUN_ID",
                        help="re-print a saved transcript instead of running")
    parser.add_argument("--list", action="store_true", help="list saved runs")
    args = parser.parse_args()

    if args.list:
        runs = storage.list_runs()
        console.print("\n".join(runs) if runs else "[dim]no saved runs yet[/dim]")
        return 0

    if args.replay:
        try:
            render(storage.load_transcript(args.replay))
        except FileNotFoundError:
            console.print(f"[red]No transcript named {args.replay}.[/red] Try --list.")
            return 1
        return 0

    question = " ".join(args.question).strip()
    if not question:
        question = console.input("[bold]Question for the council:[/bold] ").strip()
    if not question:
        console.print("[red]No question given.[/red]")
        return 1

    seats = SEATS[: max(1, min(args.seats, len(SEATS)))]

    console.print(Panel(question, title="Question", border_style="white"))
    console.print(
        f"[dim]Council: {', '.join(s.label for s in seats)} "
        f"| Chairman: {CHAIRMAN.label}{' | DRY RUN' if args.dry_run else ''}[/dim]"
    )

    transcript = asyncio.run(
        run_council(
            question,
            seats=seats,
            use_cache=args.cache,
            dry_run=args.dry_run,
            on_event=make_handler(verbose=True),
        )
    )

    if error := transcript.get("error"):
        console.print(f"\n[red]{error}[/red]")
        render(transcript)
        return 1

    render(transcript)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        console.print("\n[dim]interrupted[/dim]")
        sys.exit(130)
