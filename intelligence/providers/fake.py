"""Fake provider for deterministic testing of AwardRadar Intelligence."""

from __future__ import annotations

import uuid

from intelligence.models.facts import Fact, FactCollection, Rule, Source, Verification


class FakeProvider:
    """A deterministic fact extraction provider for testing."""

    def __init__(self) -> None:
        pass

    def harvest_topic(self, topic_name: str, prompt_context: str) -> FactCollection:
        """Return a hardcoded FactCollection for testing."""
        source_id = uuid.uuid4()
        fact_id = uuid.uuid4()
        verification_id = uuid.uuid4()
        rule_id = uuid.uuid4()
        collection_id = uuid.uuid4()

        source = Source(id=source_id)
        fact = Fact(id=fact_id, source_ids=[source_id])
        verification = Verification(
            id=verification_id, fact_id=fact_id, source_ids=[source_id]
        )
        rule = Rule(id=rule_id)

        return FactCollection(
            id=collection_id,
            topic=topic_name,
            facts=[fact],
            sources=[source],
            verifications=[verification],
            rules=[rule],
        )
