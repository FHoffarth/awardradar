import functools
import os
from urllib.parse import urlsplit

import pytest


LIVE_SERPAPI_FORBIDDEN_MESSAGE = "Live SerpApi access is forbidden during automated tests"
LIVE_PROVIDER_OPT_IN = "AWARDRADAR_ALLOW_LIVE_PROVIDER_TESTS"


class LiveSerpApiAccessForbidden(BaseException):
    """Escape application fallback handlers so a missing test mock stays visible."""


def _is_live_serpapi_url(url):
    hostname = (urlsplit(str(url)).hostname or "").lower()
    return hostname == "serpapi.com" or hostname.endswith(".serpapi.com")


def _block_live_serpapi(real_request):
    @functools.wraps(real_request)
    def guarded_request(url, *args, **kwargs):
        if (
            _is_live_serpapi_url(url)
            and os.environ.get(LIVE_PROVIDER_OPT_IN) != "1"
        ):
            raise LiveSerpApiAccessForbidden(LIVE_SERPAPI_FORBIDDEN_MESSAGE)
        return real_request(url, *args, **kwargs)

    return guarded_request


@pytest.fixture(autouse=True)
def forbid_live_serpapi_during_automated_tests(monkeypatch):
    """Block both SerpApi HTTP boundaries unless a manual test explicitly opts in."""
    import app

    monkeypatch.setattr(app.HTTP, "get", _block_live_serpapi(app.HTTP.get))
    monkeypatch.setattr(app.requests, "get", _block_live_serpapi(app.requests.get))
