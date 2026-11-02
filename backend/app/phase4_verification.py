"""Prepare offline; execute one paid check only after explicit budget approval.

From backend: python -m app.phase4_verification
Paid mode requires --execute --approved-budget-usd VALUE. Never use in CI.
"""
import argparse
import base64
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit
from uuid import uuid4

from PIL import Image, ImageDraw

from app.api.generation_provider import MODEL, ProviderFailure, generate_image, get_image_provider
from app.core.settings import REPOSITORY_ROOT, get_settings

FOLDER = REPOSITORY_ROOT / ".phase4-checks"
NOTE = (
    "Keep the left sidebar, three summary cards, and one large line chart. "
    "Use generous whitespace and warm orange accents instead of green. "
    "Keep a clear visual hierarchy suitable for a desktop dashboard."
)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def prepare(folder=FOLDER):
    folder.mkdir(exist_ok=True, parents=True)
    canvas = Image.new("RGB", (1024, 768), "#f3f5ef")
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 190, 768), fill="#345c45")
    draw.text((24, 32), "STUDIO / OVERVIEW", fill="white")
    for index, label in enumerate(("Overview", "Projects", "Reports", "Settings")):
        draw.text((24, 110 + index * 50), label, fill="white")
    draw.text((224, 38), "PROJECT DASHBOARD", fill="#23402f")
    for index, (label, value) in enumerate((("Projects", "24"), ("Completed", "18"),
                                            ("In progress", "6"))):
        left = 224 + index * 258
        draw.rounded_rectangle((left, 100, left + 230, 230), radius=12, fill="white")
        draw.text((left + 18, 122), label, fill="#45634e")
        draw.text((left + 18, 175), value, fill="#23402f")
    draw.rounded_rectangle((224, 264, 970, 690), radius=12, fill="white")
    draw.text((248, 290), "Monthly activity", fill="#23402f")
    for top in range(360, 641, 70):
        draw.line((260, top, 940, top), fill="#e5eae2", width=2)
    draw.line([(270, 610), (370, 550), (470, 570), (570, 440),
               (670, 470), (790, 390), (930, 350)], fill="#578f62", width=7)
    canvas.save(folder / "reference.png")
    plan = {"status": "prepared_no_paid_call", "model": MODEL, "size": "1024x1024",
            "quality": "low", "maximum_provider_calls": 1, "design_note": NOTE,
            "source": "self-authored dashboard fixture; no third-party reference",
            "evaluation": ["sidebar and three cards retained", "orange accents replace green",
                           "clear hierarchy and spacing", "AI label on downloaded image"],
            "billing": "Confirm actual charge separately in provider usage; not a fixed image fee"}
    write_json(folder / "plan.json", plan)
    return plan


def single_attempt(provider, folder, budget):
    """An exclusive durable marker blocks repeats, including after uncertain failures."""
    try:
        amount = Decimal(str(budget))
        if not amount.is_finite() or amount <= 0:
            raise ValueError
    except (InvalidOperation, ValueError) as error:
        raise ValueError("A positive, explicitly approved USD budget is required.") from error

    def call(*args):
        try:
            with (folder / "live-attempt.json").open("x", encoding="utf-8") as output:
                json.dump({"started_at": datetime.now(UTC).isoformat(), "model": MODEL,
                           "approved_budget_usd": str(amount), "maximum_calls": 1,
                           "outcome": "unknown_until_report", "automatic_retry": False}, output)
        except FileExistsError as error:
            raise ProviderFailure("VERIFICATION_ALREADY_ATTEMPTED") from error
        return provider(*args)

    return call


def checked(response, expected):
    if response.status_code != expected:
        raise RuntimeError(f"Verification stopped: HTTP {response.status_code}; no retry.")
    return response.json()


def execute(budget, folder=FOLDER):
    from fastapi.testclient import TestClient
    from sqlalchemy.engine import make_url

    from app.main import app

    settings = get_settings()
    database = make_url(settings.database_url)
    auth = urlsplit(settings.supabase_url or "")
    if database.host not in {"localhost", "127.0.0.1", "::1"} or auth.hostname not in {
        "localhost", "127.0.0.1", "::1"
    }:
        raise RuntimeError("This verification is restricted to the local app and Supabase.")
    if not settings.openai_api_key:
        raise RuntimeError("Server API key is missing; no paid request was sent.")
    guarded = single_attempt(generate_image, folder, budget)
    if (folder / "live-attempt.json").exists():
        raise RuntimeError("A live attempt already exists. Inspect its result; never auto-repeat.")
    account = json.loads((REPOSITORY_ROOT / ".phase2-checks" / "account.json").read_text("utf-8"))
    original_enabled = settings.image_generation_enabled
    original_overrides = app.dependency_overrides.copy()
    settings.image_generation_enabled = True  # This process only; never edits .env.
    app.dependency_overrides[get_image_provider] = lambda: guarded
    try:
        with TestClient(app) as client:
            session = checked(client.post("/api/v1/auth/login", json={
                "email": account["email"], "password": account["password"]}), 200)
            client.headers["Authorization"] = "Bearer " + session["access_token"]
            project = checked(client.post(
                "/api/v1/projects", json={"name": "Phase 4 live check"}), 201)
            kind = checked(client.post(f"/api/v1/projects/{project['id']}/deliverable-types",
                                       json={"name": "Dashboard verification"}), 201)
            reference = checked(client.post("/api/v1/references", json={
                "project_id": project["id"], "deliverable_type_id": kind["id"],
                "source_url": "https://example.com/self-authored-phase4-fixture",
                "title": "Self-authored dashboard", "design_note": NOTE}), 201)
            request = {"request_id": str(uuid4()), "rights_confirmed": True,
                       "source_image": "data:image/png;base64," + base64.b64encode(
                           (folder / "reference.png").read_bytes()).decode()}
            path = f"/api/v1/references/{reference['id']}/generations"
            created = checked(client.post(path, json=request), 202)
            job = checked(client.get(f"/api/v1/generations/{created['id']}"), 200)
            if job["status"] == "succeeded":
                duplicate = checked(client.post(path, json=request), 202)
                if duplicate["id"] != job["id"]:
                    raise RuntimeError("Duplicate request did not return the existing job.")
                (folder / "result.png").write_bytes(base64.b64decode(
                    job.pop("result_image").split(",", 1)[1], validate=True))
            else:
                job.pop("result_image", None)
            report = {**job, "paid_verification_attempted": (folder / "live-attempt.json").exists(),
                      "actual_billed_usd": None, "visual_quality_evaluation": "pending",
                      "duplicate_check": "passed" if job["status"] == "succeeded" else "not_run"}
            write_json(folder / "report.json", report)
            print(json.dumps({"status": job["status"], "report": str(folder / "report.json")}))
    finally:
        settings.image_generation_enabled = original_enabled
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--approved-budget-usd", default=None)
    args = parser.parse_args()
    if args.execute and args.approved_budget_usd is None:
        parser.error("--execute requires a separately approved --approved-budget-usd")
    prepare()
    if args.execute:
        execute(args.approved_budget_usd)
    else:
        print("Offline verification image and plan prepared. No API was called.")


if __name__ == "__main__":
    main()
