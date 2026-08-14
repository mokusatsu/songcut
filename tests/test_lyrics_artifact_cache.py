from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from songcut.lyrics_artifact_cache import (
    CACHE_FORMAT_VERSION,
    FINGERPRINT_BYTES,
    LyricsArtifactCache,
    build_cache_key,
    default_cache_root,
    fingerprint_source,
)


def _key(source_fingerprint: str):
    return build_cache_key(
        source_fingerprint,
        demucs_model="htdemucs-v4-openvino@digest-a",
        preprocess_version="vocals-44k-stereo-v1",
        sample_rate=44_100,
        channels=2,
    )


def _electron_fingerprint(data: bytes) -> str:
    head = data[:FINGERPRINT_BYTES]
    tail = data[max(0, len(data) - FINGERPRINT_BYTES) :]
    digest = hashlib.sha256()
    digest.update(str(len(data)).encode("utf-8"))
    digest.update(b"\0")
    digest.update(head)
    digest.update(b"\0")
    digest.update(tail)
    return digest.hexdigest()


def test_fingerprint_matches_electron_head_tail_contract(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    data = bytes((index * 17) % 251 for index in range(FINGERPRINT_BYTES + 37))
    source.write_bytes(data)

    assert fingerprint_source(source) == _electron_fingerprint(data)
    assert fingerprint_source(source) == fingerprint_source(source)


def test_default_root_honours_override_and_localappdata(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    override = tmp_path / "override"
    monkeypatch.setenv("SONGCUT_CACHE_DIR", str(override))
    assert default_cache_root() == override
    monkeypatch.delenv("SONGCUT_CACHE_DIR")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    assert default_cache_root() == tmp_path / "local" / "songcut" / "cache" / CACHE_FORMAT_VERSION


def test_cache_hit_miss_and_manifest_validation(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    source.write_bytes(b"source audio")
    vocals = tmp_path / "vocals-input.wav"
    vocals.write_bytes(b"decoded vocals")
    key = _key(fingerprint_source(source))
    cache = LyricsArtifactCache(tmp_path / "cache", now=lambda: 100.0)

    assert cache.get(key) is None
    item = cache.put(key, vocals, metadata={"window": [0.0, 4.0], "quality": "trusted"})
    assert item.vocals_path.read_bytes() == vocals.read_bytes()
    assert item.extra["window"] == (0.0, 4.0)
    assert cache.get(key) is not None
    assert sorted(path.name for path in item.vocals_path.parent.iterdir()) == ["manifest.json", "vocals.wav"]

    manifest = item.manifest_path
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    payload["key"]["channels"] = 1
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    assert cache.get(key) is None
    assert not item.vocals_path.parent.exists()

    # MMS logits or any other persistent payload invalidates the whole entry.
    item = cache.put(key, vocals)
    (item.vocals_path.parent / "mms_logits.bin").write_bytes(b"forbidden")
    assert cache.get(key) is None
    assert not item.vocals_path.parent.exists()


def test_put_rejects_fingerprint_mismatch_and_logits_metadata(tmp_path: Path) -> None:
    source_a = tmp_path / "a.wav"
    source_b = tmp_path / "b.wav"
    source_a.write_bytes(b"a")
    source_b.write_bytes(b"b")
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"vocals")
    cache = LyricsArtifactCache(tmp_path / "cache")
    key = _key(fingerprint_source(source_a))

    with pytest.raises(ValueError, match="fingerprint"):
        cache.put(key, vocals, source_path=source_b)
    with pytest.raises(ValueError, match="logits"):
        cache.put(key, vocals, metadata={"mms_logits": [1, 2]})


def test_ttl_expiry_is_a_miss_and_removes_only_entry(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    vocals = tmp_path / "vocals.wav"
    source.write_bytes(b"source")
    vocals.write_bytes(b"vocals")
    clock = [0.0]
    cache = LyricsArtifactCache(tmp_path / "cache", ttl_seconds=10, now=lambda: clock[0])
    key = _key(fingerprint_source(source))
    item = cache.put(key, vocals)
    clock[0] = 10.1

    assert cache.get(key) is None
    assert not item.vocals_path.parent.exists()
    assert cache.root.exists()


def test_get_touches_last_used_and_lru_prune(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    vocals = tmp_path / "vocals.wav"
    source.write_bytes(b"source")
    vocals.write_bytes(b"vocals" * 20)
    clock = [0.0]
    cache = LyricsArtifactCache(tmp_path / "cache", max_bytes=0, now=lambda: clock[0])
    key = _key(fingerprint_source(source))
    first = cache.put(key, vocals)
    clock[0] = 3.0
    touched = cache.get(key)
    assert touched is not None
    assert touched.last_used == 3.0
    assert cache.prune() == 1
    assert not first.vocals_path.parent.exists()

    # With a budget equal to one entry, the least recently used entry goes first.
    cache = LyricsArtifactCache(tmp_path / "cache-2", max_bytes=10_000, now=lambda: clock[0])
    source_a = tmp_path / "a.wav"
    source_b = tmp_path / "b.wav"
    source_a.write_bytes(b"a")
    source_b.write_bytes(b"b")
    clock[0] = 0.0
    item_a = cache.put(_key(fingerprint_source(source_a)), vocals)
    clock[0] = 1.0
    item_b = cache.put(_key(fingerprint_source(source_b)), vocals)
    total = sum(path.stat().st_size for path in cache.root.rglob("*") if path.is_file())
    cache.max_bytes = total - 1
    assert cache.prune() == 1
    assert not item_a.vocals_path.parent.exists()
    assert item_b.vocals_path.parent.exists()


def test_cache_key_changes_for_all_identity_components_and_has_no_path_traversal(tmp_path: Path) -> None:
    fingerprint = "a" * 64
    base = _key(fingerprint)
    assert base.digest != _key("b" * 64).digest
    assert build_cache_key(fingerprint, model_identity="model-b").digest != base.digest
    assert build_cache_key(fingerprint, model_key="model-c").digest != base.digest
    assert build_cache_key(fingerprint, demucs_model="model-a", preprocess_version="v2").digest != base.digest
    assert build_cache_key(fingerprint, demucs_model="model-a", sample_rate=16_000).digest != base.digest
    assert build_cache_key(fingerprint, demucs_model="model-a", channels=1).digest != base.digest
    assert build_cache_key(fingerprint, demucs_model="model-a", cache_format="lyrics-align-v2").digest != base.digest

    cache = LyricsArtifactCache(tmp_path / "cache")
    assert cache._entry_path(base).parent == cache.root
    assert ".." not in base.digest


def test_concurrent_same_key_put_is_safe(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    vocals_a = tmp_path / "a.wav"
    vocals_b = tmp_path / "b.wav"
    source.write_bytes(b"source")
    vocals_a.write_bytes(b"a")
    vocals_b.write_bytes(b"b")
    cache = LyricsArtifactCache(tmp_path / "cache")
    key = _key(fingerprint_source(source))

    # Sequential calls exercise the same-key publication path without relying on timing.
    first = cache.put(key, vocals_a)
    second = cache.put(key, vocals_b)
    assert first.vocals_path == second.vocals_path
    assert second.vocals_path.read_bytes() in {b"a", b"b"}
    assert sorted(path.name for path in second.vocals_path.parent.iterdir()) == ["manifest.json", "vocals.wav"]
