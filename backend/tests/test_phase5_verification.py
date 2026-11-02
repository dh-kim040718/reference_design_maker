import json

import pytest
from PIL import Image
from pydantic import SecretStr

from app import phase5_verification as verification
from app.core.settings import Settings
from app.phase5_evaluation import compare


def test_total_approval_is_not_silently_expanded():
    with pytest.raises(ValueError):
        verification.execute("regeneration", budget="2", extra_calls=3)
    with pytest.raises(ValueError):
        verification.execute("regeneration", budget="1", extra_calls=4)


def test_existing_stage_marker_prevents_replay_without_changing_flags(tmp_path, monkeypatch):
    baseline = tmp_path / "baseline"
    baseline.mkdir()
    Image.new("RGB", (1024, 768), "green").save(baseline / "reference.png")
    folder = tmp_path / "stages" / "regeneration"
    folder.mkdir(parents=True)
    marker = folder / "live-attempt.json"
    marker.write_text(json.dumps({"outcome": "unknown"}))
    settings = Settings(_env_file=None, database_url="postgresql://localhost/local",
                        supabase_url="http://localhost:54321", openai_api_key=SecretStr("fake"))
    monkeypatch.setattr(verification, "BASELINE", baseline)
    monkeypatch.setattr(verification, "ROOT", tmp_path / "stages")
    monkeypatch.setattr(verification, "get_settings", lambda: settings)
    with pytest.raises(RuntimeError, match="Attempt already recorded"):
        verification.execute("regeneration", budget="1", extra_calls=3)
    assert not settings.image_generation_enabled and not settings.image_editing_enabled
    assert json.loads(marker.read_text()) == {"outcome": "unknown"}


def test_pixel_comparison_excludes_watermark_and_separates_protected_area(tmp_path):
    source = Image.new("RGB", (64, 64), "white")
    result = source.copy()
    mask = Image.new("RGBA", (64, 64), "white")
    mask.putpixel((10, 10), (255, 255, 255, 0))
    result.putpixel((10, 10), (0, 0, 0))
    result.putpixel((0, 0), (0, 0, 0))
    result.putpixel((0, 63), (0, 0, 0))
    for name, image in (("source", source), ("result", result), ("mask", mask)):
        image.save(tmp_path / f"{name}.png")
    data = compare(*(tmp_path / f"{name}.png" for name in ("source", "result", "mask")))
    assert data["selected"]["changed_fraction"] == 1
    assert data["protected"]["changed_fraction"] == 1 / (64 * 38 - 1)
