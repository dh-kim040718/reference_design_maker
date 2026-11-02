import base64
import ssl
import time
from threading import Event
from urllib.parse import urlsplit

import pytest

from app.api import preview


def test_fetch_connects_to_pinned_ip_and_limits_response_size(monkeypatch):
    class Stream:
        def settimeout(self, value):
            pass

        def close(self):
            pass

    stream = Stream()
    connections = []

    class Response:
        status = 200

        def getheader(self, key, default=""):
            return "text/html" if key == "Content-Type" else default

        def read1(self, size):
            return b"x" * size

    class Connection:
        def __init__(self, host, port, timeout):
            assert host == "example.com"

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(
        preview, "public_address", lambda *args: (urlsplit("http://example.com"), "93.184.216.34")
    )
    monkeypatch.setattr(
        preview.socket,
        "create_connection",
        lambda address, **kwargs: (connections.append(address), stream)[1],
    )
    monkeypatch.setattr(preview.http.client, "HTTPConnection", Connection)
    with pytest.raises(preview.PreviewUnavailable) as error:
        preview.fetch("http://example.com", time.monotonic() + 2, limit=32)
    assert error.value.reason == "response_too_large"
    assert connections == [("93.184.216.34", 80)]


def test_fetch_hard_deadline_interrupts_stalled_headers(monkeypatch):
    stopped = Event()

    class Stream:
        def settimeout(self, value):
            pass

        def shutdown(self, how):
            stopped.set()

        def close(self):
            pass

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            assert stopped.wait(1)
            raise OSError("closed by deadline")

        def close(self):
            pass

    monkeypatch.setattr(
        preview, "public_address", lambda *args: (urlsplit("http://example.com"), "93.184.216.34")
    )
    monkeypatch.setattr(preview.socket, "create_connection", lambda *args, **kwargs: Stream())
    monkeypatch.setattr(preview.http.client, "HTTPConnection", Connection)
    with pytest.raises(TimeoutError):
        preview.fetch("http://example.com", time.monotonic() + 0.1)


def test_tls_context_keeps_certificate_and_hostname_verification():
    context = preview.tls_context()
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert context.cert_store_stats()["x509_ca"] > 0


def test_pinterest_uses_public_oembed_instead_of_crawling_pin_page(monkeypatch):
    monkeypatch.setattr(
        preview, "public_address", lambda url, *args: (urlsplit(url), "93.184.216.34")
    )
    calls = []

    def response(url, *args, **kwargs):
        calls.append(url)
        if url.endswith("robots.txt"):
            return 200, b"User-agent: *\nDisallow: /pin/", "text/plain", url
        return (
            200,
            b'{"thumbnail_url":"https://i.pinimg.com/image.jpg","title":"Pin"}',
            "application/json",
            url,
        )

    monkeypatch.setattr(preview, "fetch", response)
    result = preview.get_preview("https://kr.pinterest.com/pin/123456/")
    assert result["preview_url"] == "https://i.pinimg.com/image.jpg"
    assert any(url.startswith("https://www.pinterest.com/oembed.json?") for url in calls)
    assert not any(url.startswith("https://kr.pinterest.com/pin/") for url in calls)
    assert preview.pinterest_endpoint("https://pinterest.com.evil.test/pin/123/") is None


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"])
def test_private_addresses_are_rejected(monkeypatch, address):
    monkeypatch.setattr(
        preview.socket, "getaddrinfo", lambda *args, **kwargs: [(2, 1, 6, "", (address, 443))]
    )
    with pytest.raises(ValueError):
        preview.public_address("https://example.com/page")


def test_mixed_dns_and_credentials_are_rejected(monkeypatch):
    monkeypatch.setattr(
        preview.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (2, 1, 6, "", ("93.184.216.34", 443)),
            (2, 1, 6, "", ("127.0.0.1", 443)),
        ],
    )
    with pytest.raises(ValueError):
        preview.public_address("https://example.com")
    with pytest.raises(ValueError):
        preview.public_address("https://user:password@example.com")


def test_metadata_and_relative_image_are_extracted(monkeypatch):
    monkeypatch.setattr(
        preview, "public_address", lambda url, *args: (urlsplit(url), "93.184.216.34")
    )

    def response(url, deadline, limit=524288, **kwargs):
        if url.endswith("robots.txt"):
            return 404, b"", "text/plain", url
        return (
            200,
            b'<meta property="og:image" content="/cover.png">'
            b'<meta property="og:title" content="A &amp; B">',
            "text/html",
            url,
        )

    monkeypatch.setattr(preview, "fetch", response)
    result = preview.get_preview("https://example.com/page")
    assert result == {
        "preview_url": "https://example.com/cover.png",
        "title": "A & B",
        "status": "available",
    }


def test_robots_disallow_prevents_page_fetch(monkeypatch):
    monkeypatch.setattr(
        preview, "public_address", lambda url, *args: (urlsplit(url), "93.184.216.34")
    )
    calls = []

    def response(url, *args, **kwargs):
        calls.append(url)
        return 200, b"User-agent: *\nDisallow: /", "text/plain", url

    monkeypatch.setattr(preview, "fetch", response)
    assert preview.get_preview("https://example.com/page")["preview_url"] is None
    assert calls == ["https://example.com/robots.txt"]


def test_redirect_target_is_checked_before_fetch(monkeypatch):
    monkeypatch.setattr(
        preview.socket,
        "getaddrinfo",
        lambda host, *args, **kwargs: [
            (2, 1, 6, "", ("127.0.0.1" if host == "internal.test" else "93.184.216.34", 443))
        ],
    )
    calls = []

    def response(url, *args, **kwargs):
        calls.append(url)
        if url.endswith("robots.txt"):
            return 404, b"", "text/plain", url
        return 302, b"", "", "https://internal.test/secret"

    monkeypatch.setattr(preview, "fetch", response)
    assert preview.get_preview("https://example.com/page")["status"] == "unavailable"
    assert not any("internal.test" in url for url in calls)


def test_preview_timeout_is_nonfatal(monkeypatch):
    monkeypatch.setattr(
        preview, "public_address", lambda *args: (_ for _ in ()).throw(TimeoutError())
    )
    assert preview.get_preview("https://example.com")["status"] == "unavailable"


def test_uploaded_image_requires_safe_mime_and_signature():
    value = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()
    assert preview.validate_thumbnail(value) == value
    for value in [
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,aHRtbA==",
        "javascript:alert(1)",
    ]:
        with pytest.raises(ValueError):
            preview.validate_thumbnail(value)
