"""Designer-facing dimensions, bounded native generation, and exact raster exports."""

import base64
import io
import math
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from PIL import Image, ImageDraw, ImageOps
from pydantic import BaseModel, ConfigDict, Field, model_validator

PURPOSES = {
    "general": "자유 시안",
    "mobile_ui": "모바일 앱 화면",
    "web_ui": "웹사이트·웹앱",
    "dashboard": "대시보드·관리자",
    "landing": "랜딩페이지",
    "commerce": "쇼핑몰·상품 상세",
    "social_post": "SNS 게시물",
    "social_story": "스토리·숏폼 커버",
    "ad_banner": "광고·배너",
    "thumbnail": "콘텐츠 썸네일",
    "poster": "포스터",
    "flyer": "전단·리플렛",
    "business_card": "명함·카드",
    "brochure": "브로슈어·카탈로그",
    "editorial": "책·잡지·편집물",
    "presentation": "프레젠테이션",
    "branding": "브랜딩·로고 콘셉트",
    "packaging": "패키지·라벨",
    "illustration": "일러스트·키비주얼",
    "infographic": "인포그래픽",
    "other": "직접 입력",
}


def native_dimensions(width, height):
    ratio = width / height
    area = min(8_294_400, max(655_360, width * height))
    candidates = []
    for w in range(16, 3841, 16):
        ideal = round(w / ratio / 16) * 16
        for h in (ideal - 16, ideal, ideal + 16):
            if 16 <= h <= 3840 and 1 / 3 <= w / h <= 3 and 655_360 <= w * h <= 8_294_400:
                score = abs(math.log((w / h) / ratio)) * 12 + abs(math.log(w * h / area))
                candidates.append((score, w, h))
    if not candidates:
        raise ValueError("생성할 수 있는 규격을 찾지 못했습니다.")
    _, w, h = min(candidates)
    return w, h


class DesignSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    purpose: str = Field(default="general", max_length=40)
    purpose_detail: str = Field(default="", max_length=200)
    width: float = Field(default=1024, gt=0, le=100000, allow_inf_nan=False)
    height: float = Field(default=1024, gt=0, le=100000, allow_inf_nan=False)
    unit: Literal["px", "mm", "cm", "in", "pt"] = "px"
    ppi: int = Field(default=300, ge=36, le=600)

    def pixels(self):
        factors = {
            "px": Decimal(1),
            "mm": Decimal(self.ppi) / Decimal("25.4"),
            "cm": Decimal(self.ppi) / Decimal("2.54"),
            "in": Decimal(self.ppi),
            "pt": Decimal(self.ppi) / Decimal(72),
        }
        return tuple(
            int(
                (Decimal(str(value)) * factors[self.unit]).quantize(
                    Decimal(1), rounding=ROUND_HALF_UP
                )
            )
            for value in (self.width, self.height)
        )

    @model_validator(mode="after")
    def valid_settings(self):
        if self.purpose not in PURPOSES or (self.purpose == "other" and not self.purpose_detail):
            raise ValueError("사용 목적을 선택하거나 직접 입력해 주세요.")
        if self.unit == "px" and (
            not float(self.width).is_integer() or not float(self.height).is_integer()
        ):
            raise ValueError("픽셀 크기는 정수로 입력해 주세요.")
        w, h = self.pixels()
        if min(w, h) < 16 or max(w, h) > 8192 or w * h > 16_000_000:
            raise ValueError("출력은 각 변 16~8,192px, 합계 1,600만 픽셀 이내로 입력해 주세요.")
        if max(w, h) > min(w, h) * 3:
            raise ValueError("현재 생성 모델은 가로·세로 길이 차이가 3배 이내인 규격을 지원합니다.")
        return self

    def snapshot(self):
        w, h = self.pixels()
        gw, gh = native_dimensions(w, h)
        return {
            **self.model_dump(),
            "purpose_label": self.purpose_detail
            if self.purpose == "other"
            else PURPOSES[self.purpose],
            "pixel_width": w,
            "pixel_height": h,
            "generation_width": gw,
            "generation_height": gh,
        }


def export_result(value, settings):
    from app.api.generation_provider import MAX_RESULT, ProviderFailure, decode_image

    raw = decode_image(value, max_bytes=MAX_RESULT)
    w, h = settings["pixel_width"], settings["pixel_height"]
    with Image.open(io.BytesIO(raw)) as source:
        # Preserve content and proportions; never silently crop or stretch a design.
        fitted = ImageOps.contain(source.convert("RGB"), (w, h), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (w, h), "white")
        canvas.paste(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
        if h >= 64 and w >= 180:
            draw = ImageDraw.Draw(canvas)
            draw.rectangle((0, h - 26, w, h), fill="white")
            draw.text((8, h - 21), "AI-generated concept", fill="black")
        output = io.BytesIO()
        canvas.save(output, format="PNG", dpi=(settings["ppi"], settings["ppi"]))
    if len(output.getvalue()) > MAX_RESULT:
        raise ProviderFailure("INVALID_RESULT")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
