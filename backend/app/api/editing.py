"""Validated editing contract; real provider remains disabled until explicitly enabled."""
import io

from PIL import Image

from app.api.generation_provider import ProviderFailure, decode_image, edit_image
from app.core.settings import get_settings


def validate_mask(source: str, mask: str) -> None:
    source_bytes = decode_image(source)
    if not mask.startswith("data:image/png;base64,"):
        raise ProviderFailure("INVALID_MASK")
    mask_bytes = decode_image(mask)
    with (
        Image.open(io.BytesIO(source_bytes)) as original,
        Image.open(io.BytesIO(mask_bytes)) as image,
    ):
        if image.format != "PNG" or image.size != original.size:
            raise ProviderFailure("INVALID_MASK")
        if "A" not in image.getbands() and "transparency" not in image.info:
            raise ProviderFailure("INVALID_MASK")
        alpha = image.convert("RGBA").getchannel("A")
        # Require both a fully transparent editable area and a fully opaque protected area.
        if alpha.getextrema() != (0, 255):
            raise ProviderFailure("INVALID_MASK")


def get_edit_provider():
    settings = get_settings()
    return edit_image if settings.image_editing_enabled and settings.openai_api_key else None
