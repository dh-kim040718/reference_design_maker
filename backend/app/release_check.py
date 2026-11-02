"""Read-only release blockers; no network calls to any provider."""
import json
from urllib.parse import urlsplit

from app.core.settings import get_settings


def https_origin(value):
    try:
        url = urlsplit(value)
        return (url.scheme == "https" and bool(url.hostname) and "*" not in value
                and not url.username and not url.password and url.path in {"", "/"}
                and not url.query and not url.fragment)
    except ValueError:
        return False


def check(settings):
    blockers = []
    origins = settings.allowed_origins
    if not origins or any(not https_origin(origin) for origin in origins):
        blockers.append("EXPLICIT_HTTPS_ORIGINS_REQUIRED")
    if not https_origin(settings.supabase_url or ""):
        blockers.append("HTTPS_AUTH_REQUIRED")
    if settings.database_url.startswith("sqlite"):
        blockers.append("PRODUCTION_DATABASE_REQUIRED")
    if settings.image_editing_enabled:
        blockers.append("EDITING_QUALITY_GATE_FAILED")
    if settings.image_generation_enabled and settings.generation_budget_usd <= 0:
        blockers.append("GENERATION_BUDGET_REQUIRED")
    if settings.image_generation_enabled and not settings.openai_api_key:
        blockers.append("SERVER_KEY_REQUIRED")
    return {"configuration_blockers": blockers,
            "manual_gates": ["ACTUAL_BILLING_AND_USER_ACCEPTANCE", "ENCRYPTED_REMOTE_BACKUPS",
                             "AUTH_STORAGE_DISASTER_RECOVERY", "MOBILE_DEVICE_SMOKE",
                             "REMOTE_CI", "HTTPS_DEPLOYMENT_SMOKE", "OPERATOR_ALERT_SCHEDULER"],
            "deployment_approved": False, "auto_resume": False, "provider_calls": 0}


def main():
    report = check(get_settings())
    print(json.dumps(report))
    raise SystemExit(2 if report["configuration_blockers"] or report["manual_gates"] else 0)


if __name__ == "__main__":
    main()
