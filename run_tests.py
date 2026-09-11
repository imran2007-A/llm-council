"""Run every test file. No API keys needed -- everything here is offline.

    python run_tests.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SUITES = ["tests_ranking.py", "tests_providers.py", "tests_synthesis.py",
          "tests_council.py"]

failed = []
for suite in SUITES:
    print(f"\n=== {suite} ===")
    result = subprocess.run([sys.executable, str(ROOT / suite)], cwd=ROOT)
    if result.returncode != 0:
        failed.append(suite)

print()
if failed:
    print(f"FAILED: {', '.join(failed)}")
    sys.exit(1)
print(f"All {len(SUITES)} suites passed.")
