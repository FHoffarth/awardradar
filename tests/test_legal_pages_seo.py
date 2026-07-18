"""SEO indexing hygiene for the public legal pages.

Covers the /datenschutz, /impressum and /privacy indexing contract plus the
sitemap and robots surfaces. Narrow assertions only -- no full-page snapshots.
"""

import app as awardradar


def _client():
    return awardradar.app.test_client()


def _html(path):
    resp = _client().get(path)
    return resp, resp.get_data(as_text=True)


def test_legal_pages_return_200():
    for path in ("/datenschutz", "/impressum", "/privacy"):
        resp = _client().get(path)
        assert resp.status_code == 200, path


def test_no_legal_page_is_noindex():
    for path in ("/datenschutz", "/impressum", "/privacy"):
        resp, html = _html(path)
        assert '<meta name="robots" content="index, follow">' in html, path
        assert "noindex" not in html.lower(), path


def test_no_legal_page_emits_x_robots_noindex():
    for path in ("/datenschutz", "/impressum", "/privacy"):
        resp = _client().get(path)
        assert "noindex" not in resp.headers.get("X-Robots-Tag", "").lower(), path


def test_each_legal_page_has_self_canonical():
    expected = {
        "/datenschutz": "https://awardradar.app/datenschutz",
        "/impressum": "https://awardradar.app/impressum",
        "/privacy": "https://awardradar.app/privacy",
    }
    for path, canonical in expected.items():
        _, html = _html(path)
        assert f'<link rel="canonical" href="{canonical}">' in html, path


def test_language_metadata_is_correct():
    assert '<html lang="de">' in _html("/datenschutz")[1]
    assert '<html lang="de">' in _html("/impressum")[1]
    assert '<html lang="en">' in _html("/privacy")[1]


def test_datenschutz_and_privacy_expose_reciprocal_hreflang():
    de = '<link rel="alternate" hreflang="de" href="https://awardradar.app/datenschutz">'
    en = '<link rel="alternate" hreflang="en" href="https://awardradar.app/privacy">'
    for path in ("/datenschutz", "/privacy"):
        _, html = _html(path)
        assert de in html, path
        assert en in html, path


def test_impressum_has_no_artificial_hreflang():
    _, html = _html("/impressum")
    assert "hreflang" not in html


def test_privacy_keeps_german_authoritative_notice():
    _, html = _html("/privacy")
    assert "The German version is legally controlling." in html
    assert 'href="/datenschutz"' in html


def test_sitemap_contains_each_canonical_once_without_noindex_or_redirect_variants():
    resp = _client().get("/sitemap.xml")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    for loc in (
        "https://awardradar.app/datenschutz",
        "https://awardradar.app/impressum",
        "https://awardradar.app/privacy",
    ):
        assert body.count(f"<loc>{loc}</loc>") == 1, loc
    assert "noindex" not in body.lower()
    # No redirected or parameterized variants of the legal URLs.
    assert "http://awardradar.app/" not in body
    assert "awardradar.app/datenschutz/" not in body
    assert "www.awardradar.app" not in body


def test_robots_txt_does_not_block_legal_pages():
    resp = _client().get("/robots.txt")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    for path in ("/datenschutz", "/impressum", "/privacy"):
        assert f"Disallow: {path}" not in body, path
