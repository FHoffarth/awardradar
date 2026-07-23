import json
import pathlib
import shutil
import subprocess

import pytest

import app as awardradar


ROOT = pathlib.Path(__file__).resolve().parents[1]
LEGACY_JS = ROOT / "static" / "app.js"
LEGACY_TEMPLATE = ROOT / "templates" / "index.html"
CONSENT_CSS = ROOT / "static" / "consent.css"
APP_CSS = ROOT / "static" / "app.css"


def test_tool_is_route_specifically_noindex_nofollow():
    client = awardradar.app.test_client()

    tool = client.get("/tool")
    landing = client.get("/")
    canonical_app = client.get("/app")

    assert tool.status_code == 200
    assert '<meta name="robots" content="noindex, nofollow">' in tool.get_data(as_text=True)
    assert "noindex" not in landing.get_data(as_text=True).lower()
    assert "noindex" not in canonical_app.get_data(as_text=True).lower()
    assert "X-Robots-Tag" not in landing.headers
    assert "X-Robots-Tag" not in canonical_app.headers


def test_legacy_source_contains_no_top_opportunities_call_or_scheduler():
    source = LEGACY_JS.read_text(encoding="utf-8")

    assert "/api/top-opportunities" not in source
    assert "loadOpportunities" not in source
    assert "new IntersectionObserver" not in source
    assert "setTimeout(loadOpportunities" not in source


def test_legacy_search_form_keeps_its_semantic_target_without_dead_review_cta():
    template = LEGACY_TEMPLATE.read_text(encoding="utf-8")
    script = LEGACY_JS.read_text(encoding="utf-8")
    css = APP_CSS.read_text(encoding="utf-8")
    rendered = awardradar.app.test_client().get("/tool").get_data(as_text=True)

    assert template.count('id="search-panel"') == 1
    assert rendered.count('id="search-panel"') == 1
    assert 'aria-label="Journey search"' in rendered
    assert 'id="origin"' in rendered
    assert 'id="dest"' in rendered
    assert 'id="date"' in rendered
    assert 'id="go"' in rendered
    assert "Review value signals" not in rendered
    assert "discovery-cta-top" not in template
    assert "discovery-cta-top" not in script
    assert "discovery-cta-top" not in css


def test_legacy_privacy_reopener_has_mobile_safe_route_scoping():
    template = LEGACY_TEMPLATE.read_text(encoding="utf-8")
    css = CONSENT_CSS.read_text(encoding="utf-8")

    assert '<body class="legacy-tool-page">' in template
    assert "consent.css?v=4" in template
    assert ".legacy-tool-page .consent-preferences" in css
    assert "safe-area-inset-top" in css
    assert "bottom: auto" in css


def test_loading_legacy_discovery_schedules_and_invokes_nothing():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for legacy script execution")

    source = LEGACY_JS.read_text(encoding="utf-8")
    discovery = source.split("// ===== Discovery Widget =====", 1)[1].rsplit("})();", 1)[0] + "})();"
    script = f"""
let fetchCalls = 0;
let observerCalls = 0;
let timerCalls = 0;
function $(id) {{ return id === 'discovery-cards' ? {{ innerHTML: '' }} : null; }}
function fetch() {{ fetchCalls += 1; return Promise.reject(new Error('unexpected fetch')); }}
class IntersectionObserver {{
  constructor() {{ observerCalls += 1; }}
  observe() {{ observerCalls += 1; }}
}}
function setTimeout() {{ timerCalls += 1; }}
const window = {{ IntersectionObserver }};
eval({json.dumps(discovery)});
process.stdout.write(JSON.stringify({{ fetchCalls, observerCalls, timerCalls }}));
"""

    result = subprocess.run([node, "-e", script], text=True, capture_output=True, timeout=20)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "fetchCalls": 0,
        "observerCalls": 0,
        "timerCalls": 0,
    }


def test_top_opportunities_endpoint_contract_is_unchanged(monkeypatch):
    monkeypatch.setattr(awardradar, "_read_file_cache", lambda: None)
    monkeypatch.setattr(awardradar, "AWARD_SOURCE", "estimated")
    monkeypatch.setattr(awardradar, "SEATSAERO_KEY", "")

    response = awardradar.app.test_client().get("/api/top-opportunities")

    assert response.status_code == 503
    assert response.get_json() == {"ok": False, "error": "seats.aero not configured"}
