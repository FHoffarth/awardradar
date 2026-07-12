"""Deterministic orchestration for AwardRadar knowledge ingestion."""

from __future__ import annotations

from typing import TYPE_CHECKING

from intelligence.models.facts import FactCollection
from intelligence.providers.gemini import GeminiProvider
from intelligence.validator.validator import FactValidator

if TYPE_CHECKING:
    from intelligence.storage.sqlite import SQLiteFactStore


class KnowledgePipeline:
    """Coordinate provider extraction, validation, persistence, and reload."""

    def __init__(
        self,
        provider: GeminiProvider,
        validator: FactValidator,
        store: SQLiteFactStore,
    ) -> None:
        """Create a pipeline from externally supplied infrastructure components.

        Args:
            provider: Structured fact-extraction provider.
            validator: Structural fact-collection validator.
            store: Persistence adapter implementing the collection contract.
        """

        self._provider = provider
        self._validator = validator
        self._store = store

    def run(
        self,
        topic_name: str,
        prompt_context: str,
    ) -> FactCollection:
        """Run the complete deterministic ingestion workflow once.

        Args:
            topic_name: Human-readable topic passed to the provider.
            prompt_context: Caller-supplied source material to extract.

        Returns:
            The persisted and immediately reloaded fact collection.

        Raises:
            ValueError: If structural validation fails.
            RuntimeError: If extraction, persistence, or reload fails.
        """

        try:
            collection = self._provider.harvest_topic(topic_name, prompt_context)
        except Exception as exc:
            raise RuntimeError("Fact provider failed.") from exc

        validation = self._validator.validate_collection(collection)
        if not validation.success:
            errors = "; ".join(validation.errors)
            raise ValueError(f"FactCollection validation failed: {errors}")

        try:
            self._store.save_collection(collection)
        except Exception as exc:
            raise RuntimeError("FactCollection persistence failed.") from exc

        try:
            reloaded = self._store.load_collection(collection.id)
        except Exception as exc:
            raise RuntimeError("FactCollection reload failed.") from exc

        if reloaded is None:
            raise RuntimeError(
                f"Persisted FactCollection {collection.id} could not be reloaded."
            )

        return reloaded
