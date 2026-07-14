"""Google Gemini infrastructure adapter for structured fact extraction."""

from __future__ import annotations

import json
import os

from google import genai
from google.genai import types

from intelligence.models.facts import FactCollection


class GeminiProvider:
    """Extract a canonical ``FactCollection`` from caller-supplied text.

    The provider performs no retrieval, validation, persistence, reasoning, or
    retry orchestration. Gemini is used only to transform supplied source
    material into the canonical structured domain model.
    """

    _SYSTEM_INSTRUCTION = """You are a deterministic fact extraction component.
Extract only facts that are explicitly stated in the supplied source material.
Never hallucinate, guess, calculate, or infer missing information.
Preserve uncertainty exactly as expressed by the source material.
Produce only data that matches the provided FactCollection schema.
Do not add explanations, summaries, commentary, or markdown.
"""

    def __init__(
        self,
        api_key: str | None = None,
        model_name: str | None = None,
    ) -> None:
        """Create a Gemini fact-extraction provider.

        Args:
            api_key: Google GenAI API key. When omitted, SDK environment-based
                configuration is used.
            model_name: Gemini model identifier used for extraction. Overrides
                GEMINI_MODEL environment variable. Defaults to gemini-3.5-flash.
        """

        self._client = genai.Client(api_key=api_key)
        self.model_name = (
            model_name or os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash"
        )

    def harvest_topic(
        self,
        topic_name: str,
        prompt_context: str,
    ) -> FactCollection:
        """Extract explicit facts about a topic from supplied source material.

        Args:
            topic_name: Human-readable name of the extraction topic.
            prompt_context: Plain-text source material supplied by the caller.

        Returns:
            The structured ``FactCollection`` returned by Gemini.

        Raises:
            RuntimeError: If the API request fails, returns no content, or
                returns content that is not valid structured JSON.
            ValueError: If the returned payload does not satisfy the canonical
                ``FactCollection`` domain model.
        """

        prompt = (
            f"Topic: {topic_name}\n\n"
            "Source material:\n"
            f"{prompt_context}"
        )

        try:
            response = self._client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=self._SYSTEM_INSTRUCTION,
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema=FactCollection,
                ),
            )
        except Exception as exc:
            raise RuntimeError("Gemini API call failed.") from exc

        try:
            parsed = response.parsed
        except Exception as exc:
            raise RuntimeError("Gemini structured output could not be parsed.") from exc
        if isinstance(parsed, FactCollection):
            return parsed

        if parsed is not None:
            try:
                return FactCollection.model_validate(parsed)
            except ValueError as exc:
                raise ValueError(
                    "Gemini payload cannot be converted into FactCollection."
                ) from exc

        try:
            text = response.text
        except Exception as exc:
            raise RuntimeError("Gemini structured output could not be parsed.") from exc
        if not text or not text.strip():
            raise RuntimeError("Gemini returned no content.")

        try:
            payload = json.loads(text)
        except (json.JSONDecodeError, TypeError) as exc:
            raise RuntimeError("Gemini structured output could not be parsed.") from exc

        try:
            return FactCollection.model_validate(payload)
        except ValueError as exc:
            raise ValueError(
                "Gemini payload cannot be converted into FactCollection."
            ) from exc
