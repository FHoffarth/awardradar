"""Transactional SQLite persistence for AwardRadar Intelligence domain objects."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import TypeVar
from uuid import UUID

from pydantic import BaseModel

from intelligence.models.facts import (
    Fact,
    FactCollection,
    Rule,
    Source,
    Verification,
)


DomainObject = Source | Fact | Verification | Rule | FactCollection
DomainModelT = TypeVar("DomainModelT", bound=BaseModel)


class SQLiteStorage:
    """Persist and retrieve immutable domain objects using SQLite.

    The adapter stores the canonical Pydantic JSON representation without
    interpreting domain values. A single connection is retained so in-memory
    databases and caller-provided connections behave predictably.
    """

    _TABLES: dict[type[BaseModel], str] = {
        Source: "sources",
        Fact: "facts",
        Verification: "verifications",
        Rule: "rules",
        FactCollection: "fact_collections",
    }

    def __init__(
        self,
        database: str | Path = "awardradar_intelligence.sqlite3",
        *,
        connection: sqlite3.Connection | None = None,
        timeout: float = 5.0,
    ) -> None:
        """Initialize storage and create its schema when necessary.

        Args:
            database: SQLite database path or ``:memory:``.
            connection: Optional externally managed SQLite connection.
            timeout: Lock wait timeout used when opening an owned connection.
        """

        self._owns_connection = connection is None
        self._connection = connection or sqlite3.connect(
            str(database),
            timeout=timeout,
            isolation_level=None,
            check_same_thread=False,
        )
        self._connection.row_factory = sqlite3.Row
        self._lock = RLock()
        self._configure_connection()
        self._create_schema()

    def __enter__(self) -> SQLiteStorage:
        """Return this open storage adapter."""

        return self

    def __exit__(self, *_: object) -> None:
        """Close an owned connection when leaving a context manager."""

        self.close()

    def close(self) -> None:
        """Close the SQLite connection when this adapter created it."""

        if self._owns_connection:
            with self._lock:
                self._connection.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Execute a group of storage operations atomically.

        Nested use is supported through SQLite savepoints. Exceptions roll back
        only the current transaction scope and are re-raised unchanged.
        """

        with self._lock:
            nested = self._connection.in_transaction
            marker = f"awardradar_{id(object())}"
            if nested:
                self._connection.execute(f"SAVEPOINT {marker}")
            else:
                self._connection.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                if nested:
                    self._connection.execute(f"ROLLBACK TO SAVEPOINT {marker}")
                    self._connection.execute(f"RELEASE SAVEPOINT {marker}")
                else:
                    self._connection.rollback()
                raise
            else:
                if nested:
                    self._connection.execute(f"RELEASE SAVEPOINT {marker}")
                else:
                    self._connection.commit()

    def save_source(self, source: Source) -> None:
        """Insert or replace a source by identifier."""

        self._save(source)

    def get_source(self, source_id: UUID) -> Source | None:
        """Return a source by identifier, or ``None`` when absent."""

        return self._get(Source, source_id)

    def list_sources(self) -> tuple[Source, ...]:
        """Return every stored source in stable insertion order."""

        return self._list(Source)

    def delete_source(self, source_id: UUID) -> bool:
        """Delete a source and report whether a row was removed."""

        return self._delete(Source, source_id)

    def save_fact(self, fact: Fact) -> None:
        """Insert or replace a fact by identifier."""

        self._save(fact)

    def get_fact(self, fact_id: UUID) -> Fact | None:
        """Return a fact by identifier, or ``None`` when absent."""

        return self._get(Fact, fact_id)

    def list_facts(self) -> tuple[Fact, ...]:
        """Return every stored fact in stable insertion order."""

        return self._list(Fact)

    def delete_fact(self, fact_id: UUID) -> bool:
        """Delete a fact and report whether a row was removed."""

        return self._delete(Fact, fact_id)

    def save_verification(self, verification: Verification) -> None:
        """Insert or replace a verification by identifier."""

        self._save(verification)

    def get_verification(self, verification_id: UUID) -> Verification | None:
        """Return a verification by identifier, or ``None`` when absent."""

        return self._get(Verification, verification_id)

    def list_verifications(self) -> tuple[Verification, ...]:
        """Return every stored verification in stable insertion order."""

        return self._list(Verification)

    def delete_verification(self, verification_id: UUID) -> bool:
        """Delete a verification and report whether a row was removed."""

        return self._delete(Verification, verification_id)

    def save_rule(self, rule: Rule) -> None:
        """Insert or replace a rule by identifier."""

        self._save(rule)

    def get_rule(self, rule_id: UUID) -> Rule | None:
        """Return a rule by identifier, or ``None`` when absent."""

        return self._get(Rule, rule_id)

    def list_rules(self) -> tuple[Rule, ...]:
        """Return every stored rule in stable insertion order."""

        return self._list(Rule)

    def delete_rule(self, rule_id: UUID) -> bool:
        """Delete a rule and report whether a row was removed."""

        return self._delete(Rule, rule_id)

    def save_collection(self, collection: FactCollection) -> None:
        """Insert or replace a fact collection by identifier."""

        self._save(collection)

    def load_collection(self, collection_id: UUID) -> FactCollection | None:
        """Return a fact collection by identifier, or ``None`` when absent."""

        return self._get(FactCollection, collection_id)

    def list_fact_collections(self) -> tuple[FactCollection, ...]:
        """Return every stored fact collection in stable insertion order."""

        return self._list(FactCollection)

    def delete_fact_collection(self, collection_id: UUID) -> bool:
        """Delete a fact collection and report whether a row was removed."""

        return self._delete(FactCollection, collection_id)

    def _configure_connection(self) -> None:
        with self._lock:
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute("PRAGMA busy_timeout = 5000")
            if self._owns_connection:
                self._connection.execute("PRAGMA journal_mode = WAL")
                self._connection.execute("PRAGMA synchronous = NORMAL")

    def _create_schema(self) -> None:
        with self.transaction():
            for table in self._TABLES.values():
                self._connection.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {table} (
                        id TEXT PRIMARY KEY NOT NULL,
                        payload TEXT NOT NULL,
                        sequence INTEGER NOT NULL UNIQUE
                    )
                    """
                )

    def _save(self, obj: DomainObject) -> None:
        table = self._table_for(type(obj))
        payload = obj.model_dump_json()
        with self.transaction():
            self._connection.execute(
                f"""
                INSERT INTO {table} (id, payload, sequence)
                VALUES (?, ?, COALESCE((SELECT MAX(sequence) + 1 FROM {table}), 1))
                ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
                """,
                (str(obj.id), payload),
            )

    def _get(
        self, model: type[DomainModelT], object_id: UUID
    ) -> DomainModelT | None:
        table = self._table_for(model)
        with self._lock:
            row = self._connection.execute(
                f"SELECT payload FROM {table} WHERE id = ?", (str(object_id),)
            ).fetchone()
        return None if row is None else model.model_validate_json(row["payload"])

    def _list(self, model: type[DomainModelT]) -> tuple[DomainModelT, ...]:
        table = self._table_for(model)
        with self._lock:
            rows = self._connection.execute(
                f"SELECT payload FROM {table} ORDER BY sequence"
            ).fetchall()
        return tuple(model.model_validate_json(row["payload"]) for row in rows)

    def _delete(self, model: type[BaseModel], object_id: UUID) -> bool:
        table = self._table_for(model)
        with self.transaction():
            cursor = self._connection.execute(
                f"DELETE FROM {table} WHERE id = ?", (str(object_id),)
            )
        return cursor.rowcount > 0

    @classmethod
    def _table_for(cls, model: type[BaseModel]) -> str:
        try:
            return cls._TABLES[model]
        except KeyError as exc:
            raise TypeError(f"Unsupported domain model: {model.__name__}") from exc
