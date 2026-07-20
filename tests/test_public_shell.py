"""Shared public shell + theme integrity for the five server-rendered
public pages (/about, /methodology, /impressum, /datenschutz, /privacy).

These pages now extend templates/base_public.html and share one theme
controller (static/theme.js). Assertions stay narrow -- no full-page
snapshots -- and focus on shell presence, theme wiring, footer hygiene and
the unfinished-methodology indexing rule.
"""

import app as awardradar


PUBLIC_PAGES = ("/about", "/methodology", "/impressum", "/datenschutz", "/privacy")


def _client():
    return awardradar.app.test_client()


def _html(path):
    resp = _client().get(path)
    return resp, resp.get_data(as_text=True)


# ---- Routing and rendering ------------------------------------------------

def test_all_public_pages_return_200():
    for path in PUBLIC_PAGES:
        assert _client().get(path).status_code == 200, path


# ---- Shared shell ---------------------------------------------------------

def test_pages_share_navigation():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert '<nav class="navbar">' in html, path
        assert 'class="logo"' in html, path


def test_pages_share_footer():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert '<footer class="public-footer">' in html, path


def test_pages_expose_theme_toggle():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert 'class="theme-btn"' in html, path


def test_pages_load_shared_theme_js():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert "/static/theme.js" in html, path


def test_pages_have_no_duplicated_inline_toggle_script():
    # The old bottom-of-body toggle lived inline on every page. It now lives
    # only in static/theme.js, so no page should still define/persist theme
    # inline.
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert "function applyTheme" not in html, path
        assert "setItem('awardradar_theme'" not in html, path


# ---- Theme resolution -----------------------------------------------------

def test_early_theme_init_uses_expected_key_and_system_pref():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert "getItem('awardradar_theme')" in html, path
        assert "prefers-color-scheme" in html, path


def test_theme_applied_on_document_element():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert "document.documentElement.dataset.theme" in html, path


# ---- Footer hygiene -------------------------------------------------------

def test_no_public_page_links_to_x_or_twitter():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert "x.com" not in html, path
        assert "twitter.com" not in html, path


def test_footer_keeps_internal_legal_links():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert 'href="/privacy"' in html, path
        assert 'href="/impressum"' in html, path


# ---- Head / SEO -----------------------------------------------------------

def test_pages_share_favicon_and_manifest_baseline():
    for path in PUBLIC_PAGES:
        _, html = _html(path)
        assert "/static/site.webmanifest" in html, path
        assert "/static/favicon.svg" in html, path
        assert "/static/apple-touch-icon.png" in html, path


def test_methodology_is_temporarily_noindex():
    _, html = _html("/methodology")
    assert '<meta name="robots" content="noindex, follow">' in html


def test_indexable_pages_keep_index_follow():
    for path in ("/about", "/impressum", "/datenschutz", "/privacy"):
        _, html = _html(path)
        assert '<meta name="robots" content="index, follow">' in html, path


def test_canonicals_preserved():
    expected = {
        "/about": "https://awardradar.app/about",
        "/impressum": "https://awardradar.app/impressum",
        "/datenschutz": "https://awardradar.app/datenschutz",
        "/privacy": "https://awardradar.app/privacy",
    }
    for path, canonical in expected.items():
        _, html = _html(path)
        assert f'<link rel="canonical" href="{canonical}">' in html, path


def test_page_titles_preserved():
    expected = {
        "/about": "<title>About &amp; Methodology – AwardRadar</title>",
        "/methodology": "<title>Methodology – AwardRadar</title>",
        "/impressum": "<title>Impressum – AwardRadar</title>",
        "/datenschutz": "<title>Datenschutzerklärung – AwardRadar</title>",
        "/privacy": "<title>Privacy Notice – AwardRadar</title>",
    }
    for path, title in expected.items():
        _, html = _html(path)
        assert title in html, path
