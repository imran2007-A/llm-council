"""Verify every key and model ID with one tiny call per seat.

Four small requests instead of the ~9 a full council run costs, so a typo'd key or a
model ID that has been retired shows up cheaply and with a clear message.

    python check_keys.py
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from council.config import CHAIRMAN, PROVIDERS, SEATS
from council.providers import call_model

load_dotenv()
console = Console()

HINTS = {
    "HTTP 401": "key is wrong or not activated yet - regenerate it on the provider's site",
    "HTTP 403": "key lacks access to this model",
    "HTTP 404": "model ID not found - it may have been retired; check the provider's model list",
    "HTTP 429": "rate limited already - wait a minute and retry",
    "HTTP 402": "provider wants credit for this model - pick a different one in config.py",
}


def hint_for(error: str) -> str:
    for prefix, hint in HINTS.items():
        if error.startswith(prefix):
            return hint
    if "is not set" in error:
        return "add this key to your .env file"
    return ""


async def main() -> int:
    # First: are the keys even present? This costs nothing.
    console.print("[bold]Keys in .env[/bold]")
    missing = []
    for name, provider in PROVIDERS.items():
        value = os.getenv(provider.env_key, "").strip()
        if value:
            console.print(f"  [green]set[/green]     {provider.env_key} "
                          f"[dim]({value[:6]}...{value[-4:]}, {len(value)} chars)[/dim]")
        else:
            console.print(f"  [red]MISSING[/red] {provider.env_key}")
            missing.append(provider.env_key)

    if missing:
        console.print(
            f"\n[red]Add {', '.join(missing)} to .env before running this.[/red]"
        )
        return 1

    # Second: does each seat actually answer? One cheap call each.
    console.print("\n[bold]Live check - one small request per seat[/bold]")
    seats = SEATS + [CHAIRMAN]
    messages = [{"role": "user", "content": "Reply with exactly: OK"}]

    replies = await asyncio.gather(
        *(call_model(s, messages, max_tokens=2000, temperature=0) for s in seats)
    )

    table = Table(show_header=True)
    table.add_column("Seat")
    table.add_column("Provider")
    table.add_column("Model")
    table.add_column("Result")
    table.add_column("Time", justify="right")

    failed = 0
    for seat, reply in zip(seats, replies):
        if reply.ok:
            result = f"[green]OK[/green] [dim]{reply.text[:20]}[/dim]"
            if reply.model_used and reply.model_used != seat.model:
                result += f"\n[yellow]via fallback: {reply.model_used}[/yellow]"
        else:
            failed += 1
            hint = hint_for(reply.error or "")
            result = f"[red]{reply.error}[/red]"
            if hint:
                result += f"\n[yellow]{hint}[/yellow]"
        table.add_row(seat.label, seat.provider, seat.model, result, f"{reply.elapsed:.1f}s")

    console.print(table)

    if failed:
        console.print(
            f"\n[red]{failed} of {len(seats)} seats failed.[/red] "
            "Fix them, or swap the model in council/config.py. "
            "The council still runs with the seats that work."
        )
        return 1

    console.print("\n[green]All seats responding. Run: python cli.py \"your question\"[/green]")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
