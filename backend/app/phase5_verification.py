"""Approved manual checks: exactly one durable provider attempt per selected stage."""
import argparse
import base64
import json
from decimal import Decimal
from uuid import uuid4

from PIL import Image, ImageDraw

from app.api import generations
from app.api.editing import get_edit_provider
from app.api.generation_provider import edit_image, generate_image, get_image_provider
from app.core.settings import get_settings
from app.phase4_verification import FOLDER, NOTE, checked, single_attempt, write_json

STAGES = ("regeneration", "edit-directed", "edit-variation")
BASELINE = FOLDER / "approved-new-key-03"
ROOT = FOLDER / "phase5-approved"


def prepare(stage):
    if stage not in STAGES:
        raise ValueError("Unsupported verification stage")
    folder = ROOT / stage
    folder.mkdir(parents=True, exist_ok=True)
    editing = stage != "regeneration"
    source = (BASELINE / ("result.png" if editing else "reference.png")).read_bytes()
    (folder / "source.png").write_bytes(source)
    if editing:
        with Image.open(BASELINE / "result.png") as original:
            mask = Image.new("RGBA", original.size, "white")
            ImageDraw.Draw(mask).rectangle((236, 204, 463, 406), fill=(255, 255, 255, 0))
            mask.save(folder / "mask.png")
    write_json(folder / "plan.json", {
        "stage": stage, "maximum_provider_calls": 1, "automatic_retry": False,
        "approved_total_budget_usd": "1", "temporary_daily_reservation_limit": 6,
        "baseline_report": str(BASELINE / "report.json"),
        "instruction": instruction(stage),
        "billing": "Token estimate only; actual provider charges require separate confirmation",
    })
    return folder


def instruction(stage):
    if stage == "regeneration":
        return "Keep the same dashboard direction with three cards, sidebar and chart."
    if stage == "edit-directed":
        return ("Change only the first summary card background to pale peach. "
                "Keep its number, text and layout. Do not change anything outside the mask.")
    return ""


def estimated_usd(usage):
    """Standard token estimate, not a provider billing receipt. None if detail is missing."""
    try:
        details = usage["input_tokens_details"]
        return str((Decimal(details["text_tokens"]) * 5
                    + Decimal(details["image_tokens"]) * 8
                    + Decimal(usage["output_tokens"]) * 30) / 1_000_000)
    except (KeyError, TypeError, ValueError):
        return None


def execute(stage, *, budget, extra_calls):
    from fastapi.testclient import TestClient
    from sqlalchemy.engine import make_url

    from app.main import app

    if Decimal(str(budget)) != Decimal("1") or extra_calls != 3:
        raise ValueError("This run requires the approved total USD 1 and three extra test slots.")
    settings = get_settings()
    from urllib.parse import urlsplit
    if (make_url(settings.database_url).host not in {"localhost", "127.0.0.1", "::1"}
            or urlsplit(settings.supabase_url or "").hostname not in {"localhost", "127.0.0.1"}):
        raise RuntimeError("Local verification only")
    if not settings.openai_api_key:
        raise RuntimeError("API key missing; no call sent")
    folder = prepare(stage)
    if (folder / "live-attempt.json").exists():
        raise RuntimeError("Attempt already recorded; no repeat permitted")
    baseline = json.loads((BASELINE / "report.json").read_text("utf-8"))
    if baseline["status"] != "succeeded":
        raise RuntimeError("Successful baseline is required")
    editing = stage != "regeneration"
    provider = single_attempt(edit_image if editing else generate_image, folder, budget)
    account = json.loads((FOLDER.parent / ".phase2-checks/account.json").read_text("utf-8"))
    original_flags = (settings.image_generation_enabled, settings.image_editing_enabled)
    original_limit = generations.DAILY_LIMIT
    overrides = app.dependency_overrides.copy()
    settings.image_generation_enabled = True
    settings.image_editing_enabled = True
    generations.DAILY_LIMIT = 6  # Three prior attempts + three explicitly approved new slots.
    dependency = get_edit_provider if editing else get_image_provider
    app.dependency_overrides[dependency] = lambda: provider
    try:
        with TestClient(app) as client:
            session = checked(client.post("/api/v1/auth/login", json={
                "email": account["email"], "password": account["password"]}), 200)
            client.headers["Authorization"] = "Bearer " + session["access_token"]
            reference_id = baseline["reference_id"]
            data = {"request_id": str(uuid4()), "rights_confirmed": True,
                    "source_image": "data:image/png;base64," + base64.b64encode(
                        (folder / "source.png").read_bytes()).decode(),
                    "instruction": instruction(stage)}
            if editing:
                data.update(mask_image="data:image/png;base64," + base64.b64encode(
                    (folder / "mask.png").read_bytes()).decode(), direction=NOTE)
            write_json(folder / "request.json", data)
            path = f"/api/v1/references/{reference_id}/{'edits' if editing else 'generations'}"
            created = checked(client.post(path, json=data), 202)
            job = checked(client.get(f"/api/v1/generations/{created['id']}"), 200)
            result = job.pop("result_image", None)
            duplicate = "not_run"
            history_check = False
            if job["status"] == "succeeded":
                duplicate_job = checked(client.post(path, json=data), 202)
                if duplicate_job["id"] != job["id"]:
                    raise RuntimeError("Idempotency mismatch; no retry")
                duplicate = "passed"
                (folder / "result.png").write_bytes(base64.b64decode(result.split(",", 1)[1]))
                history = checked(client.get(
                    f"/api/v1/references/{reference_id}/generations"), 200)
                history_check = any(row["id"] == job["id"] for row in history["items"])
            token = client.headers.pop("Authorization")
            private = client.get(f"/api/v1/generations/{job['id']}").status_code == 401
            client.headers["Authorization"] = token
            report = {**job, "stage": stage, "duplicate_check": duplicate,
                      "history_check": history_check, "unauthenticated_access_blocked": private,
                      "estimated_standard_usd": estimated_usd(job.get("usage")),
                      "actual_billed_usd": None, "visual_quality_evaluation": "pending"}
            report["original_result_preserved"] = client.get(
                f"/api/v1/generations/{baseline['id']}").status_code == 200
            write_json(folder / "report.json", report)
            print(json.dumps({"stage": stage, "status": job["status"],
                              "report": str(folder / "report.json")}))
    finally:
        settings.image_generation_enabled, settings.image_editing_enabled = original_flags
        generations.DAILY_LIMIT = original_limit
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=STAGES)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--approved-budget-usd")
    parser.add_argument("--approved-extra-test-calls", type=int, default=0)
    args = parser.parse_args()
    if not args.execute:
        print(f"Prepared offline: {prepare(args.stage)}; no paid call")
    else:
        execute(args.stage, budget=args.approved_budget_usd,
                extra_calls=args.approved_extra_test_calls)


if __name__ == "__main__":
    main()
