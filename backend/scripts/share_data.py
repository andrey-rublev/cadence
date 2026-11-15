"""Snapshot this laptop's recordings into data/collected/ so they can be committed and shared.

    npm run share                 names the file after this computer
    npm run share -- my-laptop    or give it a name

Uses SQLite's backup API, so it is safe while the API is running and the copy includes
everything still in the write-ahead log. The live database is never modified.
"""

import argparse
import re
import socket
import sqlite3

from cadence.core.config import REPO_ROOT, settings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", nargs="?", default=socket.gethostname(), help="file name in data/collected/")
    args = parser.parse_args()

    source = settings.db_path
    if not source.exists():
        print(f"No recordings yet: {source} does not exist. Run a collection session first.")
        return
    name = re.sub(r"[^a-z0-9._-]+", "-", args.name.lower()).strip("-.") or "laptop"
    target = REPO_ROOT / "data" / "collected" / f"{name}.db"
    target.parent.mkdir(parents=True, exist_ok=True)

    live = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    copy = sqlite3.connect(target)
    live.backup(copy)
    copy.execute("PRAGMA journal_mode=DELETE")  # a single self-contained file
    check = copy.execute("PRAGMA integrity_check").fetchone()[0]
    tables = {row[0] for row in copy.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    people = copy.execute("SELECT count(*) FROM participants").fetchone()[0] if "participants" in tables else 0
    typing = (
        copy.execute("SELECT count(*) FROM passive_windows WHERE purpose = 'collect'").fetchone()[0]
        if "passive_windows" in tables
        else 0
    )
    copy.close()
    live.close()

    print(f"Saved {target.relative_to(REPO_ROOT)} ({people} volunteers, {typing} typing samples, integrity {check}).")
    print("Share it with:")
    print(f'  git add "{target.relative_to(REPO_ROOT).as_posix()}"')
    print(f'  git commit -m "Add collected data from {name}"')
    print("  git push")


if __name__ == "__main__":
    main()
