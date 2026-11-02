from app.api import preview_cache


def test_cache_is_account_scoped_bounded_and_supports_refresh(monkeypatch):
    preview_cache._entries.clear()
    calls = []

    def load(url):
        calls.append(url)
        return {
            "status": "available",
            "title": "Title",
            "preview_url": "https://example.com/image.jpg",
        }

    monkeypatch.setattr(preview_cache, "get_preview", load)
    result = preview_cache.cached_preview("first", "https://example.com")
    result["title"] = "changed"
    assert preview_cache.cached_preview("first", "https://example.com")["title"] == "Title"
    assert len(calls) == 1
    preview_cache.cached_preview("second", "https://example.com")
    preview_cache.cached_preview("first", "https://example.com", refresh=True)
    assert len(calls) == 3
    monkeypatch.setattr(preview_cache, "MAX_ENTRIES", 2)
    preview_cache.cached_preview("third", "https://other.example")
    assert len(preview_cache._entries) == 2
    preview_cache._entries.clear()


def test_failed_previews_expire_quickly(monkeypatch):
    preview_cache._entries.clear()
    clock = [100]
    calls = []

    def load(url):
        calls.append(url)
        return {"status": "unavailable", "title": None, "preview_url": None, "reason": "timeout"}

    monkeypatch.setattr(preview_cache, "monotonic", lambda: clock[0])
    monkeypatch.setattr(preview_cache, "get_preview", load)
    preview_cache.cached_preview("owner", "https://example.com")
    clock[0] = 120
    preview_cache.cached_preview("owner", "https://example.com")
    assert len(calls) == 1
    clock[0] = 131
    preview_cache.cached_preview("owner", "https://example.com")
    assert len(calls) == 2
    preview_cache._entries.clear()
