"""Structural validation for AwardRadar Intelligence fact collections."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from intelligence.models.facts import FactCollection


class ValidationResult(BaseModel):
    """The deterministic outcome of validating a fact collection.

    Attributes:
        success: Whether structural validation completed without errors.
        errors: Structural inconsistencies that make the collection invalid.
        warnings: Non-fatal conditions that callers may wish to surface.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    success: bool
    errors: list[str]
    warnings: list[str]


class FactValidator:
    """Verify the internal structural consistency of a ``FactCollection``."""

    def validate_collection(self, collection: FactCollection) -> ValidationResult:
        """Validate references, identifiers, and required collection structure.

        The supplied collection is inspected without being modified. Validation
        is deterministic and does not assess the truth or quality of any fact.

        Args:
            collection: The immutable collection to validate.

        Returns:
            A result containing all structural errors and warnings found.
        """

        errors: list[str] = []
        warnings: list[str] = []

        if not collection.topic.strip():
            errors.append("FactCollection topic must not be empty.")

        if not collection.facts:
            warnings.append("FactCollection contains no facts.")

        source_ids = {source.id for source in collection.sources}
        fact_ids = {fact.id for fact in collection.facts}

        errors.extend(
            self._duplicate_id_errors(
                (
                    ("FactCollection", (collection.id,)),
                    ("Source", (source.id for source in collection.sources)),
                    ("Fact", (fact.id for fact in collection.facts)),
                    (
                        "Verification",
                        (verification.id for verification in collection.verifications),
                    ),
                    ("Rule", (rule.id for rule in collection.rules)),
                )
            )
        )

        for fact in collection.facts:
            for source_id in fact.source_ids:
                if source_id not in source_ids:
                    errors.append(
                        f"Fact {fact.id} references missing Source {source_id}."
                    )

        for verification in collection.verifications:
            if verification.fact_id not in fact_ids:
                errors.append(
                    "Verification "
                    f"{verification.id} references missing Fact "
                    f"{verification.fact_id}."
                )
            for source_id in verification.source_ids:
                if source_id not in source_ids:
                    errors.append(
                        "Verification "
                        f"{verification.id} references missing Source {source_id}."
                    )

        return ValidationResult(
            success=not errors,
            errors=errors,
            warnings=warnings,
        )

    @staticmethod
    def _duplicate_id_errors(
        groups: Iterable[tuple[str, Iterable[UUID]]],
    ) -> list[str]:
        """Return deterministic errors for duplicate IDs within or across groups."""

        materialized = [(name, tuple(ids)) for name, ids in groups]
        errors: list[str] = []

        for name, ids in materialized:
            counts = Counter(ids)
            for object_id in sorted(
                (item for item, count in counts.items() if count > 1), key=str
            ):
                errors.append(f"Duplicate {name} ID: {object_id}.")

        owners: dict[UUID, list[str]] = {}
        for name, ids in materialized:
            for object_id in set(ids):
                owners.setdefault(object_id, []).append(name)

        for object_id in sorted(
            (item for item, names in owners.items() if len(names) > 1), key=str
        ):
            names = ", ".join(sorted(owners[object_id]))
            errors.append(f"Duplicate UUID {object_id} is used by: {names}.")

        return errors
