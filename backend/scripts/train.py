"""Evaluate B0, M1 and M2 on participant-held-out scores, then activate the selected model.

    uv run python scripts/train.py --db ../data/collected/a.db --db b.db   merge collection laptops
    uv run python scripts/train.py --synthetic 40                          SYNTHETIC players; pipeline check only
    uv run python scripts/train.py --db a.db --dry-run                     evaluate without activating

The full summary is written to artifacts/models/<version>/eval.json, which the app shows.
A synthetic model is loaded by the API only when CADENCE_ALLOW_SYNTHETIC_MODEL=1.
"""

import argparse
import json
from pathlib import Path

from cadence.core.config import settings
from cadence.verifier.artifact import save
from cadence.verifier.training import load_volunteer_rounds, synthetic_rounds, train


def _pct(interval: dict | None) -> str:
    if not interval or interval.get("value") is None:
        return "n/a"
    low, high = interval.get("low"), interval.get("high")
    span = f" [{low:.0%}-{high:.0%}]" if low is not None and high is not None else ""
    return f"{interval['value']:.0%}{span}"


def _num(interval: dict | None) -> str:
    if not interval or interval.get("value") is None:
        return "n/a"
    low, high = interval.get("low"), interval.get("high")
    span = f" [{low:.2f}-{high:.2f}]" if low is not None and high is not None else ""
    return f"{interval['value']:.3f}{span}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, action="append", help="collection database (repeatable)")
    parser.add_argument("--synthetic", type=int, metavar="PEOPLE", help="use this many synthetic players instead")
    parser.add_argument("--include-pilots", action="store_true", help="include team pilot runs (debugging only)")
    parser.add_argument("--dry-run", action="store_true", help="evaluate and print, but activate nothing")
    parser.add_argument("--json", action="store_true", help="print the whole summary as JSON")
    args = parser.parse_args()

    if args.synthetic:
        rounds, source = synthetic_rounds(args.synthetic), "synthetic"
    else:
        rounds = load_volunteer_rounds(args.db or [settings.db_path], include_pilots=args.include_pilots)
        source = "volunteer"

    model, summary = train(rounds, source)
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        people = summary["participants"]
        print(f"{people['total']} people ({people['with_two_sessions']} with two sessions), {summary['rounds']} rounds, "
              f"stations: {', '.join(summary['stations'])}")
        if "protocol" in summary:
            print(f"protocol: {summary['protocol']['name']}\n")
        for m in summary.get("models", []):
            p, c = m["policy"], m["counts"]
            print(f"{m['name']}  ({c['genuine_attempts']} genuine, {c['impostor_attempts']} impostor attempts)")
            print(f"  one round      AUC {_num(m['one_round']['auc'])}   EER {_pct(m['one_round']['eer'])}")
            print(f"  three rounds   AUC {_num(m['three_rounds']['auc'])}   EER {_pct(m['three_rounds']['eer'])}")
            print(f"  policy         impostors accepted {_pct(p['impostor_accepted'])}, owners accepted {_pct(p['genuine_accepted'])}, "
                  f"owners held {_pct(p['genuine_rejected'])}, owners sent to fallback {_pct(p['genuine_fallback'])}")
            s = m["stations"]
            print(f"  impostors      same station AUC {s['same']['auc']} (n={s['same']['impostor_attempts']}), "
                  f"other station AUC {s['other']['auc']} (n={s['other']['impostor_attempts']})")
            if "auc_gain_over_b0" in m:
                print(f"  AUC gain over B0 {_num(m['auc_gain_over_b0'])}")
            print()
        if "selected" in summary:
            print(f"selected: {summary['selected']['name']}. {summary['selected']['reason']}")
        for line in summary["limitations"]:
            print(f"- {line}")

    if model is None:
        print("\nNo model activated. The API keeps answering INSUFFICIENT_EVIDENCE and never approves.")
        return
    if args.dry_run:
        print("\nDry run: nothing activated.")
        return
    save(settings.artifacts_dir / model.version, model)
    print(f"\nActivated {model.version} in {settings.artifacts_dir}")


if __name__ == "__main__":
    main()
