"""Build deterministic collector packages and shared brand icons using Pillow."""

import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend" / "public"
FILES = [
    "manifest.json",
    "capture.js",
    "page-preview.js",
    "thumbnail.js",
    "worker.js",
    "options.html",
    "options.css",
    "options.js",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
]


def extension_zip():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(FILES):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 29, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / "browser-extension" / name).read_bytes())
    return output.getvalue()


def icon(size, *, maskable=False):
    from generate_brand_icons import render
    output = io.BytesIO()
    render(size, maskable=maskable).save(output, format='PNG')
    return output.getvalue()


def main():
    outputs = {
        "reference-maker-extension.zip": extension_zip(),
        "icon-192.png": icon(192),
        "icon-512.png": icon(512),
        "icon-maskable-512.png": icon(512, maskable=True),
    }
    if "--check" in sys.argv:
        if any(
            not (PUBLIC / name).exists() or (PUBLIC / name).read_bytes() != data
            for name, data in outputs.items()
        ):
            raise SystemExit(
                "Collector assets differ. Run: python scripts/package_collector.py"
            )
        print("Collector package and icons match their sources.")
        return
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        (PUBLIC / name).write_bytes(data)
    print("Collector extension and install icons prepared.")


if __name__ == "__main__":
    main()
