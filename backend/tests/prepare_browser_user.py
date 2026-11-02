"""Create a disposable account on local Supabase for browser smoke checks.

Run from backend: .venv/Scripts/python.exe -m tests.prepare_browser_user
Credentials stay in a Git-ignored directory and are never printed.
"""

import json
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from app.core.settings import get_settings


def main():
    settings = get_settings()
    url = urlsplit(settings.supabase_url or "")
    if url.hostname not in {"127.0.0.1", "localhost"} or url.port != 54321:
        raise RuntimeError("Browser test account must use local Supabase only.")
    email = f"phase2-{uuid4().hex}@example.com"
    password = secrets.token_urlsafe(24)
    response = httpx.post(
        f"{settings.supabase_url}/auth/v1/signup",
        headers={"apikey": settings.supabase_anon_key},
        json={"email": email, "password": password},
        timeout=10,
    )
    if response.status_code != 200:
        raise RuntimeError("Could not prepare the local browser test account.")
    folder = Path(__file__).resolve().parents[2] / ".phase2-checks"
    folder.mkdir(exist_ok=True)
    (folder / "account.json").write_text(
        json.dumps({"email": email, "password": password, "id": response.json()["user"]["id"]}),
        encoding="utf-8",
    )
    print("Disposable local browser test account prepared; credentials were not printed.")


if __name__ == "__main__":
    main()
