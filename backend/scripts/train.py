"""Train and evaluate the baseline verifier, then activate it if the data supports thresholds.

    uv run python scripts/train.py                      volunteer data from backend/cadence.db
    uv run python scripts/train.py --db a.db --db b.db   merge several collection laptops
    uv run python scripts/train.py --synthetic 40        SYNTHETIC players; pipeline check only

A synthetic model is loaded by the API only when CADENCE_ALLOW_SYNTHETIC_MODEL=1.
"""

import argparse
import json
from pathlib import Path

from cadence.core.config import settings
from cadence.verifier.artifact import save
from cadence.verifier.training import load_volunteer_rounds, synthetic_rounds, train


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, action="append", help="collection database (repeatable)")
    parser.add_argument("--synthetic", type=int, metavar="PEOPLE", help="use this many synthetic players instead")
    parser.add_argument("--include-pilots", action="store_true", help="include team pilot runs (debugging only)")
    args = parser.parse_args()

    if args.synthetic:
        rounds, source = synthetic_rounds(args.synthetic), "synthetic"
    else:
        rounds = load_volunteer_rounds(args.db or [settings.db_path], include_pilots=args.include_pilots)
        source = "volunteer"

    model, summary = train(rounds, source)
    print(json.dumps(summary, indent=2))
    if model is None:
        print("\nNo model activated. The API keeps answering INSUFFICIENT_EVIDENCE and never approves.")
        return
    save(settings.artifacts_dir / model.version, model)
    print(f"\nActivated {model.version} in {settings.artifacts_dir}")


if __name__ == "__main__":
    main()
