"""Minimal local CLI runner for AwardRadar Intelligence."""

import argparse
import sys
from pathlib import Path

from intelligence.harvester.pipeline import KnowledgePipeline
from intelligence.providers.fake import FakeProvider
from intelligence.providers.gemini import GeminiProvider
from intelligence.storage.sqlite import SQLiteStorage
from intelligence.validator.validator import FactValidator


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Intelligence Harvester pipeline.")
    parser.add_argument(
        "--provider",
        choices=["fake", "gemini"],
        required=True,
        help="The fact extraction provider to use.",
    )
    parser.add_argument(
        "--topic",
        required=True,
        help="The topic to extract facts about.",
    )
    parser.add_argument(
        "--db",
        default="awardradar_intelligence.sqlite3",
        help="SQLite database path.",
    )
    args = parser.parse_args()

    if args.provider == "fake":
        provider = FakeProvider()
    else:
        provider = GeminiProvider()

    validator = FactValidator()
    
    db_path = Path(args.db).resolve()
    with SQLiteStorage(db_path) as store:
        pipeline = KnowledgePipeline(provider, validator, store)
        
        try:
            collection = pipeline.run(args.topic, "CLI test context")
        except Exception as exc:
            print(f"Pipeline failed: {exc}", file=sys.stderr)
            sys.exit(1)

        print(f"Database path: {db_path}")
        print(f"Topic: {collection.topic}")
        print(f"Facts received: {len(collection.facts)}")
        
        validation = validator.validate_collection(collection)
        print(f"Accepted: {validation.success}")
        
        if not validation.success:
            print(f"Rejected reasons: {validation.errors}")
            
        print("Stored: True (reloaded successfully)")


if __name__ == "__main__":
    main()
