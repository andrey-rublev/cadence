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


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    migrate(engine)
    Base.metadata.create_all(engine)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


Db = Annotated[Session, Depends(get_db)]
