from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False}
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def migrate(bind: Engine) -> None:
    """Bring a database created by an earlier build up to date without losing recordings."""
    with bind.begin() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(participants)")}
        if "code" in columns:  # participants were keyed by a generated code before usernames
            conn.exec_driver_sql("ALTER TABLE participants RENAME COLUMN code TO username")
            conn.exec_driver_sql("UPDATE participants SET username = lower(username)")

        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(accounts)")}
        if columns and "setup_completed_at" not in columns:
            conn.exec_driver_sql("ALTER TABLE accounts ADD COLUMN setup_completed_at FLOAT")

        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(site_links)")}
        if columns and "practice_attempts" not in columns:
            conn.exec_driver_sql("ALTER TABLE site_links ADD COLUMN practice_attempts INTEGER NOT NULL DEFAULT 0")
            conn.exec_driver_sql("ALTER TABLE site_links ADD COLUMN practice_session_id INTEGER")

        # passive_windows gained participant_id and a nullable account_id. SQLite cannot alter
        # a column's nullability, so the old table is set aside and copied over after create_all.
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(passive_windows)")}
        if columns and "participant_id" not in columns:
            for index in (
                "ix_passive_account_modality",
                "ux_passive_account_digest",
                "ix_passive_windows_session_id",
                "ix_passive_windows_account_id",
            ):
                conn.exec_driver_sql(f"DROP INDEX IF EXISTS {index}")
            conn.exec_driver_sql("ALTER TABLE passive_windows RENAME TO passive_windows_v1")
        elif columns and "site_id" not in columns:
            conn.exec_driver_sql("ALTER TABLE passive_windows ADD COLUMN site_id VARCHAR(32)")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_passive_windows_site_id ON passive_windows (site_id)")


def _copy_set_aside(bind: Engine) -> None:
    with bind.begin() as conn:
        exists = conn.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'passive_windows_v1'"
        ).first()
        if exists:
            columns = (
                "id, session_id, account_id, modality, purpose, feature_schema, values_json, "
                "digest, events_z, duration_ms, captured_at"
            )
            conn.exec_driver_sql(f"INSERT INTO passive_windows ({columns}) SELECT {columns} FROM passive_windows_v1")
            conn.exec_driver_sql("DROP TABLE passive_windows_v1")


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    migrate(engine)
    Base.metadata.create_all(engine)
    _copy_set_aside(engine)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


Db = Annotated[Session, Depends(get_db)]
