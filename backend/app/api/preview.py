"""Bounded public metadata requests; connect only to validated, pinned public IPs."""

import base64
import binascii
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from threading import Event, Timer
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import certifi

AGENT = "ReferenceMakerPreview/1.0"
resolver = ThreadPoolExecutor(max_workers=4, thread_name_prefix="preview-dns")


def tls_context():
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=certifi.where())
    return context


class PreviewUnavailable(ValueError):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def public_address(url: str, deadline: float | None = None):
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 80 if parsed.scheme == "http" else 443)
    ):
        raise ValueError("Unsupported preview address")
    resolution = resolver.submit(
        socket.getaddrinfo,
        parsed.hostname,
        parsed.port or (443 if parsed.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    )
    addresses = resolution.result(
        timeout=max(0.01, min(3, deadline - time.monotonic())) if deadline else 3
    )
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError("Public addresses only")
    return parsed, addresses[0][4][0]


def fetch(url: str, deadline: float, limit=524288, follow_redirects=True):
    for _ in range(4):
        parsed, address = public_address(url, deadline)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        connection = http.client.HTTPConnection(parsed.hostname, port, timeout=min(remaining, 3))
        raw = socket.create_connection((address, port), timeout=min(remaining, 3))
        deadline_timer = None
        timed_out = Event()
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            raw.settimeout(min(remaining, 3))
            connection.sock = (
                tls_context().wrap_socket(raw, server_hostname=parsed.hostname)
                if parsed.scheme == "https"
                else raw
            )
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            stream = connection.sock

            def stop_request(active_stream=stream, signal=timed_out):
                signal.set()
                try:
                    active_stream.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            deadline_timer = Timer(remaining, stop_request)
            deadline_timer.daemon = True
            deadline_timer.start()
            connection.request(
                "GET",
                path,
                headers={
                    "User-Agent": AGENT,
                    "Accept": "application/json,text/html,text/plain",
                    "Accept-Encoding": "identity",
                },
            )
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                url = urljoin(url, response.getheader("Location", ""))
                if not follow_redirects:
                    return response.status, b"", "", url
                continue
            if response.getheader("Content-Encoding", "identity") != "identity":
                raise ValueError("Encoded previews are not supported")
            data = bytearray()
            while len(data) <= limit:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                stream.settimeout(min(remaining, 3))
                chunk = response.read1(min(16384, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            if len(data) > limit:
                raise PreviewUnavailable("response_too_large")
            return response.status, bytes(data), response.getheader("Content-Type", ""), url
        except OSError as error:
            if timed_out.is_set():
                raise TimeoutError() from error
            raise
        finally:
            if deadline_timer:
                deadline_timer.cancel()
            connection.close()
            raw.close()
    raise PreviewUnavailable("redirect_limit")


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.image = None
        self.title = None
        self.in_title = False
        self.text_title = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            value = attrs.get("content", "")
            if key in {"og:image", "twitter:image", "twitter:image:src"} and not self.image:
                self.image = value
            if key in {"og:title", "twitter:title"} and not self.title:
                self.title = value
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.text_title += data


def pinterest_endpoint(url: str):
    parsed = urlsplit(url)
    match = re.fullmatch(r"/pin/(\d+)/?", parsed.path)
    host = parsed.hostname or ""
    if match and (host == "pinterest.com" or host.endswith(".pinterest.com")):
        return "https://www.pinterest.com/oembed.json?" + urlencode(
            {
                "url": f"https://www.pinterest.com/pin/{match[1]}/",
                "format": "json",
            }
        )
    return None


def _get_preview(url: str):
    unavailable = {"preview_url": None, "title": None, "status": "unavailable"}
    try:
        provider_endpoint = pinterest_endpoint(url)
        if provider_endpoint:
            url = provider_endpoint
        deadline = time.monotonic() + 7
        for _ in range(4):
            public_address(url, deadline)
            robots_url = urljoin(url, "/robots.txt")
            status, data, _, _ = fetch(robots_url, deadline, 65536)
            if status == 200:
                robots = RobotFileParser()
                robots.parse(data.decode("utf-8", "replace").splitlines())
                if not robots.can_fetch(AGENT, url):
                    return {**unavailable, "reason": "site_restricted"}
            elif status != 404:
                return unavailable
            status, data, content_type, final_url = fetch(url, deadline, follow_redirects=False)
            if status in {301, 302, 303, 307, 308}:
                url = final_url
                continue
            break
        else:
            return unavailable
        if status != 200:
            return {**unavailable, "reason": "page_unavailable"}
        if provider_endpoint:
            payload = json.loads(data)
            if not isinstance(payload, dict):
                return unavailable
            image = payload.get("thumbnail_url")
            title = payload.get("title")
            if not isinstance(image, str) or urlsplit(image).scheme != "https":
                return unavailable
            public_address(image, deadline)
            return {
                "preview_url": image,
                "title": title[:200] if isinstance(title, str) else None,
                "status": "available",
            }
        if "text/html" not in content_type.lower():
            return unavailable
        metadata = Metadata()
        metadata.feed(data.decode("utf-8", "replace"))
        image = urljoin(final_url, metadata.image) if metadata.image else None
        if image:
            public_address(image, deadline)
            if urlsplit(image).scheme != "https":
                image = None
        return {
            "preview_url": image,
            "title": (metadata.title or metadata.text_title).strip()[:200] or None,
            "status": "available" if image else "unavailable",
            **({"reason": "no_image"} if not image else {}),
        }
    except PreviewUnavailable as error:
        return {**unavailable, "reason": error.reason}
    except ssl.SSLCertVerificationError:
        return {**unavailable, "reason": "tls_error"}
    except TimeoutError:
        return {**unavailable, "reason": "timeout"}
    except OSError:
        return {**unavailable, "reason": "network_error"}
    except (ValueError, http.client.HTTPException):
        return {**unavailable, "reason": "unavailable"}


def get_preview(url: str):
    result = _get_preview(url)
    if result["status"] == "available" or not pinterest_endpoint(url):
        return result
    # A user-submitted public pin can expose OG metadata even when oEmbed is
    # unavailable. No cookies, login, browser impersonation, or page crawling.
    try:
        deadline = time.monotonic() + 7
        public_address(url, deadline)
        status, data, content_type, final_url = fetch(url, deadline, limit=4 * 1024 * 1024)
        if status != 200 or "text/html" not in content_type.lower():
            return result
        metadata = Metadata()
        metadata.feed(data.decode("utf-8", "replace"))
        image = urljoin(final_url, metadata.image) if metadata.image else None
        if not image or urlsplit(image).scheme != "https":
            return result
        public_address(image, deadline)
        return {"preview_url": image,
                "title": (metadata.title or metadata.text_title).strip()[:200] or None,
                "status": "available"}
    except (ValueError, OSError, TimeoutError, http.client.HTTPException):
        return result


def validate_thumbnail(value: str | None):
    if not value:
        return None
    if value.startswith("data:"):
        allowed = {"data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"}
        try:
            prefix, encoded = value.split(",", 1)
            if prefix not in allowed:
                raise ValueError("Unsupported image")
            data = base64.b64decode(encoded, validate=True)
            valid = (
                (prefix == "data:image/png;base64" and data.startswith(b"\x89PNG\r\n\x1a\n"))
                or (prefix == "data:image/jpeg;base64" and data.startswith(b"\xff\xd8\xff"))
                or (
                    prefix == "data:image/webp;base64"
                    and data.startswith(b"RIFF")
                    and data[8:12] == b"WEBP"
                )
            )
            if len(data) > 300000 or not valid:
                raise ValueError("Invalid image")
        except (ValueError, binascii.Error) as error:
            raise ValueError("PNG, JPEG, WebP 썸네일만 사용할 수 있습니다.") from error
        return value
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or len(value) > 4096
    ):
        raise ValueError("올바른 HTTPS 이미지 주소를 입력해 주세요.")
    return value
