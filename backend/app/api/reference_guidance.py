"""Small metadata only. Coordinates are relative to the saved preview image."""
import hashlib
import json

ROLE_MEANINGS = {
    "mood": "overall visual tone and mood", "color": "palette, backgrounds, accent and status colors, contrast",
    "typography": "typeface character, size, weight, line height and letter spacing",
    "icons": "icon stroke weight, fill, size and pairing with text; do not copy branded marks",
    "imagery": "photography and illustration style and placement; do not copy protected artwork",
    "layout": "grid, alignment, region arrangement and proportions",
    "spacing": "padding, gaps and whitespace rhythm", "hierarchy": "visual importance and reading order",
    "density": "amount of information per screen and compactness",
    "components": "reusable cards, badges, tabs and UI composition",
    "buttons": "CTA placement, size, emphasis and primary/secondary action hierarchy",
    "navigation": "visual organization of header, sidebar, tabs and menus",
    "forms": "input controls, labels, selection and validation message layout",
    "tables": "row/column layout, list structure and alignment of data",
    "charts": "chart types, legends, KPI displays and numeric visualization",
    "surfaces": "corner radius, borders, dividers, shadows and elevation",
}


def preview_version(url):
    return hashlib.sha256(json.dumps(url, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def guidance_data(item):
    value = json.loads(item.design_guidance_json) if item.design_guidance_json else {"roles": [], "regions": [], "image_version": None}
    stale = bool(value["regions"] and value.get("image_version") != preview_version(item.preview_url))
    return {"design_guidance": value, "guidance_stale": stale,
            "preview_version": preview_version(item.preview_url)}
