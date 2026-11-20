#!/usr/bin/env python3
"""Assemble the files to upload to a website, in site/:

    site/pi/                 the browser version (upload the whole folder)
    site/genpi-python.zip    the Python version, for the downloads page

Both use the same teaching notes from help/. Rerun this after changing
anything; site/ is rebuilt from scratch each time.

Usage: build-site.py
"""

import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "site"
PYTHON_FILES = ["README.md", "genpi-gui.py", "pialgos.py", "helpview.py",
                *sorted(p.name for p in HERE.glob("genpi-*.py") if p.name != "genpi-gui.py")]


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    web = OUT / "pi"
    shutil.copytree(HERE / "web", web)
    shutil.copytree(HERE / "help", web / "help")

    zip_path = OUT / "genpi-python.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in PYTHON_FILES:
            z.write(HERE / name, f"genpi/{name}")       # keeps the executable bits
        for md in sorted((HERE / "help").glob("*.md")):
            z.write(md, f"genpi/help/{md.name}")

    files = sorted(p.relative_to(OUT) for p in web.rglob("*") if p.is_file())
    print(f"{web}/  ({len(files)} files, {sum((OUT / f).stat().st_size for f in files):,} bytes)")
    print(f"{zip_path}  ({zip_path.stat().st_size:,} bytes, {len(PYTHON_FILES) + len(list((HERE / 'help').glob('*.md')))} files)")


if __name__ == "__main__":
    main()
