"""Domain models representing extracted knowledge and facts."""
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class Source(BaseModel):
    """Source material backing a fact."""
    id: UUID


class Fact(BaseModel):
    """An atomic unit of knowledge."""
    id: UUID
    source_ids: list[UUID]


class Verification(BaseModel):
    """Verification linking a fact to sources."""
    id: UUID
    fact_id: UUID
    source_ids: list[UUID]


class Rule(BaseModel):
    """A reasoning rule."""
    id: UUID


class FactCollection(BaseModel):
    """A structured collection of facts, sources, verifications, and rules."""
    id: UUID
    topic: str
    facts: list[Fact]
    sources: list[Source]
    verifications: list[Verification]
    rules: list[Rule]
