"""Apply an ICO file to a copied Windows executable during packaging."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replace the application icon embedded in a Windows executable."
    )
    parser.add_argument("--exe", required=True, type=Path, help="Target .exe file")
    parser.add_argument("--icon", required=True, type=Path, help="Source .ico file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if os.name != "nt":
        raise SystemExit("Windows executable resources can only be edited on Windows.")

    from PyInstaller.utils.win32.icon import CopyIcons_FromIco

    exe_path = args.exe.resolve(strict=True)
    icon_path = args.icon.resolve(strict=True)

    if exe_path.suffix.lower() != ".exe":
        raise SystemExit(f"Target must be an .exe file: {exe_path}")
    if icon_path.suffix.lower() != ".ico":
        raise SystemExit(f"Icon must be an .ico file: {icon_path}")

    CopyIcons_FromIco(str(exe_path), [str(icon_path)])
    print(f"Set Windows executable icon: {exe_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
