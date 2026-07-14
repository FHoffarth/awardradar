"""Tests for the AwardRadar Intelligence local pipeline bootstrap."""

import unittest
import uuid
from pathlib import Path

from pydantic import ValidationError

from intelligence.models.facts import Fact, FactCollection, Rule, Source, Verification
from intelligence.providers.fake import FakeProvider
from intelligence.storage.sqlite import SQLiteStorage
from intelligence.validator.validator import FactValidator
from intelligence.harvester.pipeline import KnowledgePipeline


class TestIntelligencePipeline(unittest.TestCase):
    def test_fact_collection_import_and_valid_construction(self):
        """Test FactCollection import and valid construction."""
        source_id = uuid.uuid4()
        fact_id = uuid.uuid4()
        verification_id = uuid.uuid4()
        rule_id = uuid.uuid4()
        collection_id = uuid.uuid4()

        collection = FactCollection(
            id=collection_id,
            topic="Test Topic",
            facts=[Fact(id=fact_id, source_ids=[source_id])],
            sources=[Source(id=source_id)],
            verifications=[
                Verification(
                    id=verification_id, fact_id=fact_id, source_ids=[source_id]
                )
            ],
            rules=[Rule(id=rule_id)],
        )

        self.assertEqual(collection.id, collection_id)
        self.assertEqual(collection.topic, "Test Topic")

    def test_malformed_input_rejection(self):
        """Test that malformed input is rejected by Pydantic."""
        with self.assertRaises(ValidationError):
            # Missing required fields
            FactCollection(id=uuid.uuid4(), topic="Missing facts")

    def test_validator_acceptance(self):
        """Test validator accepts valid collection."""
        source_id = uuid.uuid4()
        fact_id = uuid.uuid4()

        collection = FactCollection(
            id=uuid.uuid4(),
            topic="Valid",
            facts=[Fact(id=fact_id, source_ids=[source_id])],
            sources=[Source(id=source_id)],
            verifications=[
                Verification(
                    id=uuid.uuid4(), fact_id=fact_id, source_ids=[source_id]
                )
            ],
            rules=[],
        )

        validator = FactValidator()
        result = validator.validate_collection(collection)
        self.assertTrue(result.success, f"Validation failed: {result.errors}")

    def test_validator_rejection(self):
        """Test validator rejects collection with broken references."""
        fact_id = uuid.uuid4()
        broken_source_id = uuid.uuid4()

        collection = FactCollection(
            id=uuid.uuid4(),
            topic="Invalid",
            facts=[Fact(id=fact_id, source_ids=[broken_source_id])],
            sources=[],  # Missing source!
            verifications=[],
            rules=[],
        )

        validator = FactValidator()
        result = validator.validate_collection(collection)
        self.assertFalse(result.success)
        self.assertIn(
            f"Fact {fact_id} references missing Source {broken_source_id}.",
            result.errors,
        )

    def test_sqlite_save_and_reload(self):
        """Test SQLite save and reload."""
        provider = FakeProvider()
        collection = provider.harvest_topic("SQLite Test", "Context")

        with SQLiteStorage(":memory:") as store:
            store.save_collection(collection)
            reloaded = store.load_collection(collection.id)

            self.assertIsNotNone(reloaded)
            self.assertEqual(reloaded.id, collection.id)
            self.assertEqual(reloaded.topic, collection.topic)

    def test_full_pipeline_roundtrip(self):
        """Test full pipeline roundtrip."""
        provider = FakeProvider()
        validator = FactValidator()
        
        with SQLiteStorage(":memory:") as store:
            pipeline = KnowledgePipeline(provider, validator, store)
            reloaded = pipeline.run("Pipeline Test", "Context")

            self.assertIsNotNone(reloaded)
            self.assertEqual(reloaded.topic, "Pipeline Test")


if __name__ == "__main__":
    unittest.main()
