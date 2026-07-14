"""Tests proving Gemini model configuration precedence."""

import os
import unittest
from unittest.mock import patch

from intelligence.providers.gemini import GeminiProvider


class TestGeminiProvider(unittest.TestCase):
    def test_explicit_constructor_argument_wins(self):
        """Constructor argument takes top precedence."""
        with patch.dict(os.environ, {"GEMINI_MODEL": "gemini-env"}):
            provider = GeminiProvider(api_key="dummy", model_name="gemini-explicit")
            self.assertEqual(provider.model_name, "gemini-explicit")

    def test_gemini_model_environment_variable_is_used(self):
        """Environment variable used when no constructor model supplied."""
        with patch.dict(os.environ, {"GEMINI_MODEL": "gemini-env"}):
            provider = GeminiProvider(api_key="dummy")
            self.assertEqual(provider.model_name, "gemini-env")

    def test_deterministic_default(self):
        """Default is gemini-3.5-flash."""
        if "GEMINI_MODEL" in os.environ:
            del os.environ["GEMINI_MODEL"]
        provider = GeminiProvider(api_key="dummy")
        self.assertEqual(provider.model_name, "gemini-3.5-flash")

    def test_invalid_model_errors_propagated(self):
        """Invalid model errors are not hidden."""
        with patch("intelligence.providers.gemini.genai.Client") as MockClient:
            mock_client = MockClient.return_value
            mock_client.models.generate_content.side_effect = Exception("API failure")
            
            provider = GeminiProvider(model_name="invalid-model")
            with self.assertRaises(RuntimeError) as context:
                provider.harvest_topic("Test", "Context")
            self.assertIn("Gemini API call failed", str(context.exception))


if __name__ == "__main__":
    unittest.main()
