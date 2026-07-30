from __future__ import annotations

import argparse
import hashlib
import tarfile
import zipfile
from pathlib import Path

SENTINELS = {
    "uta_align/config.py": (
        "max_progress_deviation: float = 0.20",
        "allow_proportional_authoritative_lattice: bool = False",
    ),
    "uta_align/lattice.py": (
        "proportional_fallback_diagnostic_only",
        "progress_prior_not_authoritative",
    ),
    "uta_align/pipeline.py": (
        "absolute_progress_outlier",
        "generic_envelope_relaxed",
    ),
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _wheel_member(archive: zipfile.ZipFile, suffix: str) -> str:
    matches = [name for name in archive.namelist() if name.endswith(suffix)]
    if len(matches) != 1:
        raise AssertionError(f"wheel member {suffix!r}: {matches!r}")
    return matches[0]


def _sdist_member(archive: tarfile.TarFile, suffix: str) -> str:
    matches = [
        member.name
        for member in archive.getmembers()
        if member.isfile() and member.name.endswith(suffix)
    ]
    if len(matches) != 1:
        raise AssertionError(f"sdist member {suffix!r}: {matches!r}")
    return matches[0]


def verify(wheel: Path, sdist: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        for suffix, sentinels in SENTINELS.items():
            text = archive.read(_wheel_member(archive, suffix)).decode("utf-8")
            for sentinel in sentinels:
                if sentinel not in text:
                    raise AssertionError(
                        f"{wheel.name}:{suffix} missing {sentinel!r}"
                    )
    with tarfile.open(sdist) as archive:
        for suffix, sentinels in SENTINELS.items():
            member = archive.extractfile(_sdist_member(archive, suffix))
            if member is None:
                raise AssertionError(f"{sdist.name}:{suffix} unreadable")
            text = member.read().decode("utf-8")
            for sentinel in sentinels:
                if sentinel not in text:
                    raise AssertionError(
                        f"{sdist.name}:{suffix} missing {sentinel!r}"
                    )
    print(f"wheel {wheel.stat().st_size} {_sha256(wheel)}")
    print(f"sdist {sdist.stat().st_size} {_sha256(sdist)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify release archives contain current safety sentinels."
    )
    parser.add_argument("wheel", type=Path)
    parser.add_argument("sdist", type=Path)
    arguments = parser.parse_args()
    verify(arguments.wheel, arguments.sdist)


if __name__ == "__main__":
    main()
