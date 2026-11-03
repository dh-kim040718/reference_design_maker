"""Single-attempt image editing; original image exists only in request memory."""
import base64
import io
import json
import ssl
import warnings

import certifi
import httpx
from PIL import Image, ImageDraw, UnidentifiedImageError

from app.core.settings import get_settings

MODEL = "gpt-image-2.5-flare-2026-09-08"
MAX_IMAGE = 8 * 1024 * 1024


class ProviderFailure(Exception):
    def __init__(self, code: str, http_status=None, reason=None):
        self.code = code if isinstance(code, str) and code in {
            "INVALID_IMAGE", "INVALID_MASK", "INVALID_RESULT", "NOT_CONFIGURED",
            "PROVIDER_REJECTED", "OUTCOME_UNKNOWN", "VERIFICATION_ALREADY_ATTEMPTED",
        } else "OUTCOME_UNKNOWN"
        self.http_status = (http_status
                            if type(http_status) is int and 400 <= http_status <= 599 else None)
        self.reason = reason if isinstance(reason, str) and reason in {
            "authentication", "permission", "model_unavailable", "quota", "rate_limit",
            "invalid_request", "safety", "upstream", "timeout", "connection", "rejected",
        } else None
        super().__init__(self.code)


def rejection(response):
    status = response.status_code
    reason = {400: "invalid_request", 401: "authentication", 403: "permission",
              404: "model_unavailable", 429: "rate_limit"}.get(status, "rejected")
    # Parse only a bounded body and retain only explicitly recognized categories, never messages.
    body = bytearray()
    for chunk in response.iter_bytes(chunk_size=4096):
        body.extend(chunk)
        if len(body) > 16_384:
            break
    if len(body) <= 16_384:
        try:
            data = json.loads(body)
            code = data.get("error", {}).get("code")
            if status == 429 and code == "insufficient_quota":
                reason = "quota"
            elif status == 400 and code in {"content_policy_violation", "moderation_blocked"}:
                reason = "safety"
        except (ValueError, AttributeError, TypeError):
            pass
    return ProviderFailure("OUTCOME_UNKNOWN" if status >= 500 else "PROVIDER_REJECTED",
                           status, "upstream" if status >= 500 else reason)


def decode_image(value: str) -> bytes:
    try:
        header, encoded = value.split(",", 1)
        if header not in {"data:image/png;base64", "data:image/jpeg;base64",
                          "data:image/webp;base64"}:
            raise ValueError
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_IMAGE:
            raise ValueError
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError
                if image.width * image.height > 16_000_000 or image.is_animated:
                    raise ValueError
                image.verify()
        return raw
    except (ValueError, OSError, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ProviderFailure("INVALID_IMAGE") from error


def marked_result(encoded: str) -> str:
    raw = decode_image("data:image/png;base64," + encoded)
    with Image.open(io.BytesIO(raw)) as source:
        image = source.convert("RGB")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, max(0, image.height - 26), image.width, image.height), fill="white")
        draw.text((8, max(0, image.height - 21)), "AI-generated concept", fill="black")
        output = io.BytesIO()
        image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def token_usage(value) -> dict:
    if not isinstance(value, dict):
        return {}
    result = {}
    for key in ("input_tokens", "output_tokens", "total_tokens", "text_tokens", "image_tokens"):
        count = value.get(key)
        if type(count) is int and 0 <= count <= 1_000_000_000:
            result[key] = count
    for key in ("input_tokens_details", "output_tokens_details"):
        if isinstance(value.get(key), dict):
            result[key] = token_usage(value[key])
    return result


def generate_image(source: str, prompt: str, safety_id: str) -> tuple[str, dict]:
    return request_image(source, prompt, safety_id)


def generate_project(images: list[str], prompt: str, safety_id: str) -> tuple[str, dict]:
    return request_image(images, prompt, safety_id)


def get_project_provider():
    return generate_project


def edit_image(source: str, mask: str, prompt: str, safety_id: str) -> tuple[str, dict]:
    return request_image(source, prompt, safety_id, mask=mask)


def request_image(source: str | list[str], prompt: str, safety_id: str,
                  mask=None) -> tuple[str, dict]:
    key = get_settings().openai_api_key
    if not key:
        raise ProviderFailure("NOT_CONFIGURED")
    context = ssl.create_default_context()
    context.load_verify_locations(certifi.where())
    images = source if isinstance(source, list) else [source]
    payload = {"model": MODEL, "images": [{"image_url": image} for image in images],
               "prompt": prompt,
               "n": 1, "size": "1024x1024", "quality": "low",
               "output_format": "png", "safety_identifier": safety_id}
    if mask is not None:
        payload["mask"] = {"image_url": mask}
    try:
        with httpx.Client(verify=context, timeout=httpx.Timeout(120, connect=10)) as client:
            with client.stream(
                "POST", "https://api.openai.com/v1/images/edits",
                headers={"Authorization": "Bearer " + key.get_secret_value()},
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    raise rejection(response)
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 12 * 1024 * 1024:
                        raise ProviderFailure("INVALID_RESULT")
                data = json.loads(body)
                return marked_result(data["data"][0]["b64_json"]), token_usage(data.get("usage"))
    except httpx.RequestError as error:
        # The provider may have charged: never retry an ambiguous request.
        raise ProviderFailure("OUTCOME_UNKNOWN", reason=(
            "timeout" if isinstance(error, httpx.TimeoutException) else "connection")) from None
    except (KeyError, IndexError, ValueError, TypeError) as error:
        raise ProviderFailure("INVALID_RESULT") from error


def get_image_provider():
    return generate_image
