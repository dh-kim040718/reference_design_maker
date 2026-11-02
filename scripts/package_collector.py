"""Build deterministic collector assets without third-party packages or credentials."""

import io
import struct
import sys
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend" / "public"
FILES = [
    "manifest.json",
    "capture.js",
    "worker.js",
    "options.html",
    "options.css",
    "options.js",
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


def icon(size):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data))
        )

    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            u, v = x / size, y / size
            stem = 0.28 <= u <= 0.39 and 0.22 <= v <= 0.78
            bowl = (
                ((u - 0.48) / 0.22) ** 2 + ((v - 0.405) / 0.185) ** 2 <= 1
                and not (((u - 0.48) / 0.11) ** 2 + ((v - 0.405) / 0.085) ** 2 < 1)
                and u >= 0.35
            )
            leg = (
                0.52 <= v <= 0.78
                and 0.46 + (v - 0.52) * 0.65 <= u <= 0.58 + (v - 0.52) * 0.65
            )
            pixels.extend((255, 255, 255) if stem or bowl or leg else (54, 92, 67))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(pixels), 9))
        + chunk(b"IEND", b"")
    )


def main():
    outputs = {
        "reference-maker-extension.zip": extension_zip(),
        "icon-192.png": icon(192),
        "icon-512.png": icon(512),
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
