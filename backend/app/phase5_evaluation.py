"""Analyze saved artifacts only. Never calls a model or changes generated images."""
import json
from decimal import Decimal

from PIL import Image, ImageChops

from app.phase4_verification import write_json
from app.phase5_verification import BASELINE, ROOT, STAGES, estimated_usd


def compare(source_path, output_path, mask_path):
    with (Image.open(source_path) as source, Image.open(output_path) as result,
          Image.open(mask_path) as mask):
        if source.size != result.size or mask.size != source.size:
            return {"size_match": False}
        diff = ImageChops.difference(source.convert("RGB"), result.convert("RGB"))
        alpha = mask.convert("RGBA").getchannel("A")
        width, height = source.size
        counts = {"protected": 0, "selected": 0}
        changed = dict.fromkeys(counts, 0)
        sums = dict.fromkeys(counts, 0)
        rgb_bytes = diff.tobytes()
        for index, opacity in enumerate(alpha.tobytes()):
            if index // width >= height - 26:  # App watermark band is measured separately.
                continue
            area = "selected" if opacity == 0 else "protected"
            rgb = rgb_bytes[index * 3:index * 3 + 3]
            counts[area] += 1
            changed[area] += max(rgb) > 10
            sums[area] += sum(rgb)
        return {"size_match": True, "ignored_watermark_rows": 26,
                "threshold_max_channel_difference": 10,
                **{area: {"pixels": counts[area],
                          "changed_fraction": (changed[area] / counts[area]
                                               if counts[area] else None),
                          "mean_absolute_rgb_difference": sums[area] / (3 * counts[area])
                          if counts[area] else None} for area in counts}}


def evaluate():
    reports = []
    reviews = {
        "regeneration": {"structure_and_direction_retained": True,
                         "user_acceptance": "pending"},
        "edit-directed": {"protected_area_preserved": False,
                          "original_card_number_and_text_preserved": False,
                          "quality_gate": "failed"},
        "edit-variation": {"protected_area_preserved": False,
                           "outside_chart_labels_changed": True, "quality_gate": "failed"},
    }
    for folder in [BASELINE, *(ROOT / stage for stage in STAGES)]:
        report = json.loads((folder / "report.json").read_text("utf-8"))
        report["estimated_standard_usd"] = estimated_usd(report.get("usage"))
        if report.get("stage") in reviews:
            report["visual_quality_evaluation"] = {
                "reviewer": "assistant_manual_review_not_user_acceptance",
                **reviews[report["stage"]],
            }
        if (folder / "mask.png").exists():
            report["pixel_comparison"] = compare(
                folder / "source.png", folder / "result.png", folder / "mask.png")
        write_json(folder / "report.json", report)
        reports.append(report)
    estimate = sum(Decimal(report["estimated_standard_usd"]) for report in reports)
    summary = {"successful_outputs": len(reports), "additional_provider_attempts_this_run": 3,
               "approved_total_budget_usd": "1", "estimated_standard_usd": str(estimate),
               "actual_billed_usd": None, "automatic_retry": False,
               "editing_release_decision": "disabled_quality_gate_failed",
               "scope": "One fixture only, not an overall service failure-rate estimate",
               "latencies_ms": [report["elapsed_ms"] for report in reports],
               "total_tokens": sum(report["usage"]["total_tokens"] for report in reports),
               "stages": reports}
    write_json(ROOT / "evaluation.json", summary)
    html = """<!doctype html><html lang="ko"><meta charset="utf-8">
<title>Phase 4·5 검증 결과</title><style>
body{font:16px system-ui;margin:24px;background:#f5f5f2;color:#24312b}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
article{background:white;padding:16px;border-radius:12px}img{width:100%;height:auto}
p{line-height:1.6}</style><h1>실제 생성·재생성·영역 편집 비교</h1>
<p>선택 영역: 첫 번째 카드. 편집은 보호 영역 변경으로 품질 미달, 비활성화 유지.
실제 청구액 확인 전 토큰 기반 추정만 기록.</p><main>"""
    for name, src, description in [
        ("기준 생성", "../approved-new-key-03/result.png",
         "사이드바·카드 3개·차트·주황색 방향 유지"),
        ("전체 재생성", "regeneration/result.png", "전체 구조와 방향 유지, 원본 결과 별도 보존"),
        ("지시 있는 편집", "edit-directed/result.png",
         "배경색 변경 요청. 숫자/문구 교체 및 옆 카드 침범: 품질 미달"),
        ("지시 없는 변형", "edit-variation/result.png",
         "카드를 삽화로 변경. 선택 밖 차트 문구 변경: 보호 기준 미달"),
    ]:
        html += (f'<article><h2>{name}</h2><p>{description}</p>'
                 f'<img src="{src}" alt="{name}"></article>')
    (ROOT / "comparison.html").write_text(html + "</main></html>", encoding="utf-8")
    print(json.dumps({"estimated_standard_usd": str(estimate), "actual_billed_usd": None,
                      "total_tokens": summary["total_tokens"],
                      "report": str(ROOT / "evaluation.json")}))


if __name__ == "__main__":
    evaluate()
