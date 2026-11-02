"""Small, per-account metadata cache. No external cookies or credentials are cached."""

from collections import OrderedDict
from threading import Lock
from time import monotonic

from app.api.preview import get_preview

_entries: OrderedDict[tuple[str, str], tuple[float, dict]] = OrderedDict()
_lock = Lock()
MAX_ENTRIES = 128


def cached_preview(owner_id: str, url: str, *, refresh: bool = False):
    key = (owner_id, url)
    with _lock:
        cached = _entries.get(key)
        if cached and cached[0] > monotonic() and not refresh:
            _entries.move_to_end(key)
            return dict(cached[1])
        _entries.pop(key, None)
    result = get_preview(url)
    ttl = 300 if result["status"] == "available" else 30
    with _lock:
        _entries[key] = (monotonic() + ttl, dict(result))
        _entries.move_to_end(key)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)
    return result
