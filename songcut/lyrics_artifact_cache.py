"""歌詞解析で共有する Demucs vocals artifact のローカルキャッシュ。

このモジュールは、歌詞や行境界ではなく音源と前処理の同一性だけをキーに
します。キャッシュには Demucs が生成した vocals WAV と、検証に必要な最小限
の JSON manifest だけを保存し、MMS の logits/emissions は受け付けません。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping


CACHE_FORMAT_VERSION = "lyrics-align-v1"
SOURCE_FINGERPRINT_ALGORITHM = "sha256-head-tail-1m-v1"
FINGERPRINT_BYTES = 1024 * 1024
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_MAX_BYTES = 2 * 1024**3
_MANIFEST_VERSION = 1
_VOCALS_FILENAME = "vocals.wav"
_MANIFEST_FILENAME = "manifest.json"
_KEY_RE = re.compile(r"^[0-9a-f]{64}$")
_FORBIDDEN_METADATA_TERMS = ("logit", "emission")


def default_cache_root() -> Path:
    """既定の lyrics artifact キャッシュディレクトリを返す。"""

    configured = os.environ.get("SONGCUT_CACHE_DIR")
    if configured:
        return Path(configured).expanduser()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "songcut" / "cache" / CACHE_FORMAT_VERSION
    return Path.home() / ".songcut" / "cache" / CACHE_FORMAT_VERSION


def fingerprint_source(source: Path | str) -> str:
    """Electron と同じ size+先頭/末尾1MiB SHA-256 fingerprint を計算する。

    ハッシュ入力は ``size\0head\0tail`` の順で、ファイルが2MiB未満の場合も
    Electron 実装と同じく先頭と末尾（同一範囲になり得る）を重ねて扱う。
    """

    path = Path(source).expanduser()
    try:
        info = path.stat()
    except OSError as exc:
        raise FileNotFoundError(f"Source file is not readable: {source}") from exc
    if not path.is_file():
        raise ValueError(f"Source is not a file: {source}")
    size = int(info.st_size)
    head_length = min(FINGERPRINT_BYTES, size)
    tail_start = max(0, size - FINGERPRINT_BYTES)
    tail_length = min(FINGERPRINT_BYTES, size - tail_start)
    with path.open("rb") as handle:
        head = handle.read(head_length)
        handle.seek(tail_start)
        tail = handle.read(tail_length)
    digest = hashlib.sha256()
    digest.update(str(size).encode("utf-8"))
    digest.update(b"\0")
    digest.update(head)
    digest.update(b"\0")
    digest.update(tail)
    return digest.hexdigest()


# 既存コードから呼び出しやすい別名も公開する。
compute_source_fingerprint = fingerprint_source


def _validate_source_fingerprint(value: str) -> str:
    result = str(value).strip().lower()
    if not _KEY_RE.fullmatch(result):
        raise ValueError("source_fingerprint must be a 64-character lowercase SHA-256 value")
    return result


def _validate_nonempty(name: str, value: str) -> str:
    result = str(value).strip()
    if not result:
        raise ValueError(f"{name} must not be empty")
    return result


@dataclass(frozen=True, slots=True)
class LyricsArtifactCacheKey:
    """音源と前処理の同一性を表すキャッシュキー。"""

    source_fingerprint: str
    demucs_model: str
    preprocess_version: str
    sample_rate: int
    channels: int
    cache_format: str = CACHE_FORMAT_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "source_fingerprint", _validate_source_fingerprint(self.source_fingerprint))
        object.__setattr__(self, "demucs_model", _validate_nonempty("demucs_model", self.demucs_model))
        object.__setattr__(
            self,
            "preprocess_version",
            _validate_nonempty("preprocess_version", self.preprocess_version),
        )
        object.__setattr__(self, "cache_format", _validate_nonempty("cache_format", self.cache_format))
        if isinstance(self.sample_rate, bool) or int(self.sample_rate) <= 0:
            raise ValueError("sample_rate must be a positive integer")
        if isinstance(self.channels, bool) or int(self.channels) <= 0:
            raise ValueError("channels must be a positive integer")
        object.__setattr__(self, "sample_rate", int(self.sample_rate))
        object.__setattr__(self, "channels", int(self.channels))

    def canonical_payload(self) -> dict[str, Any]:
        """キーの全構成要素を JSON 互換の値として返す。"""

        return {
            "cache_format": self.cache_format,
            "channels": self.channels,
            "demucs_model": self.demucs_model,
            "preprocess_version": self.preprocess_version,
            "sample_rate": self.sample_rate,
            "source_fingerprint": self.source_fingerprint,
        }

    @property
    def digest(self) -> str:
        """キャッシュディレクトリ名に使う安全な SHA-256 digest を返す。"""

        encoded = json.dumps(
            self.canonical_payload(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


def build_cache_key(
    source_fingerprint: str,
    demucs_model: str | None = None,
    preprocess_version: str = "v1",
    sample_rate: int = 44_100,
    channels: int = 2,
    cache_format: str = CACHE_FORMAT_VERSION,
    *,
    model_identity: str | None = None,
    model_key: str | None = None,
) -> LyricsArtifactCacheKey:
    """指定された音源・Demucs・前処理情報から cache key を作る。

    ``model_identity``/``model_key`` は ``demucs_model`` の別名であり、同時指定は
    できない。歌詞本文や行境界は API に含めず、同一 vocals を全行で共有する。
    """

    supplied = [value for value in (demucs_model, model_identity, model_key) if value is not None]
    if len(supplied) != 1:
        raise ValueError("exactly one of demucs_model, model_identity, or model_key is required")
    return LyricsArtifactCacheKey(
        source_fingerprint=source_fingerprint,
        demucs_model=supplied[0],
        preprocess_version=preprocess_version,
        sample_rate=sample_rate,
        channels=channels,
        cache_format=cache_format,
    )


make_cache_key = build_cache_key


@dataclass(frozen=True, slots=True)
class LyricsArtifactMetadata:
    """検証済み artifact の不変な公開メタデータ。"""

    cache_key: str
    key: LyricsArtifactCacheKey
    vocals_path: Path
    manifest_path: Path
    size_bytes: int
    created_at: float
    last_used: float
    extra: Mapping[str, Any]

    @property
    def metadata(self) -> Mapping[str, Any]:
        """put 時に渡された opaque metadata の読み取り専用ビュー。"""

        return self.extra


def _freeze_json(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({str(key): _freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze_json(item) for item in value)
    return value


def _contains_forbidden_metadata(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            lowered = str(key).lower()
            if any(term in lowered for term in _FORBIDDEN_METADATA_TERMS):
                return True
            if _contains_forbidden_metadata(item):
                return True
    elif isinstance(value, (list, tuple)):
        return any(_contains_forbidden_metadata(item) for item in value)
    return False


def _normalise_extra(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    if metadata is None:
        return {}
    if not isinstance(metadata, Mapping):
        raise TypeError("metadata must be a mapping")
    if _contains_forbidden_metadata(metadata):
        raise ValueError("MMS logits/emissions cannot be persisted in the vocals artifact cache")
    try:
        encoded = json.dumps(
            dict(metadata), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
        value = json.loads(encoded)
    except (TypeError, ValueError) as exc:
        raise TypeError("metadata must contain JSON-compatible values") from exc
    if not isinstance(value, dict):
        raise TypeError("metadata must encode as a JSON object")
    return value


def _safe_remove(path: Path, root: Path) -> None:
    """root 配下の一つの cache entry だけを削除する。"""

    try:
        resolved_root = root.resolve()
        if path.parent.resolve() != resolved_root:
            return
        # symlink の target は解決せず、root 直下にあるリンク自体だけを消す。
        if path.is_symlink():
            path.unlink(missing_ok=True)
            return
        resolved_path = path.resolve(strict=False)
        if resolved_path.parent != resolved_root:
            return
    except OSError:
        return
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
    except OSError:
        # 壊れた cache の掃除は best effort で行い、利用者の解析を失敗させない。
        return


class LyricsArtifactCache:
    """vocals WAV と manifest を TTL/LRU 付きで管理するプロセス内キャッシュ。"""

    def __init__(
        self,
        root: Path | str | None = None,
        *,
        ttl_seconds: float = CACHE_TTL_SECONDS,
        max_bytes: int = CACHE_MAX_BYTES,
        now: Callable[[], float] | None = None,
    ) -> None:
        if ttl_seconds < 0:
            raise ValueError("ttl_seconds must be non-negative")
        if max_bytes < 0:
            raise ValueError("max_bytes must be non-negative")
        self.root = Path(root).expanduser() if root is not None else default_cache_root()
        self.ttl_seconds = float(ttl_seconds)
        self.max_bytes = int(max_bytes)
        self._now = now or time.time
        self._lock = threading.RLock()

    def _entry_path(self, key: LyricsArtifactCacheKey) -> Path:
        # digest は _KEY_RE を満たすため、外部入力を path として連結しない。
        return self.root / key.digest

    def _manifest_path(self, entry: Path) -> Path:
        return entry / _MANIFEST_FILENAME

    def _vocals_path(self, entry: Path) -> Path:
        return entry / _VOCALS_FILENAME

    def _read_entry(self, key: LyricsArtifactCacheKey, *, touch: bool) -> LyricsArtifactMetadata | None:
        entry = self._entry_path(key)
        manifest_path = self._manifest_path(entry)
        vocals_path = self._vocals_path(entry)
        try:
            if not entry.is_dir() or entry.is_symlink() or manifest_path.is_symlink() or vocals_path.is_symlink():
                raise ValueError("entry is not a regular cache directory")
            if any(child.name not in {_MANIFEST_FILENAME, _VOCALS_FILENAME} for child in entry.iterdir()):
                raise ValueError("cache entry contains an unexpected artifact")
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("manifest is not an object")
            if int(payload.get("manifest_version", -1)) != _MANIFEST_VERSION:
                raise ValueError("manifest version mismatch")
            if payload.get("artifact") != "demucs-vocals-wav":
                raise ValueError("manifest artifact mismatch")
            if payload.get("vocals_filename") != _VOCALS_FILENAME:
                raise ValueError("manifest vocals filename mismatch")
            manifest_key = payload.get("key")
            if manifest_key != key.canonical_payload():
                raise ValueError("manifest key mismatch")
            for field in (
                "source_fingerprint",
                "demucs_model",
                "preprocess_version",
                "sample_rate",
                "channels",
                "cache_format",
            ):
                if payload.get(field) != getattr(key, field):
                    raise ValueError(f"manifest {field} mismatch")
            if not vocals_path.is_file():
                raise ValueError("vocals WAV is missing")
            size_bytes = int(payload.get("size_bytes", -1))
            actual_size = int(vocals_path.stat().st_size)
            if size_bytes < 0 or size_bytes != actual_size:
                raise ValueError("vocals WAV size mismatch")
            created_at = float(payload["created_at"])
            last_used = float(payload["last_used"])
            now = float(self._now())
            if now - last_used > self.ttl_seconds:
                raise TimeoutError("cache entry expired")
            extra = payload.get("metadata", {})
            if not isinstance(extra, dict) or _contains_forbidden_metadata(extra):
                raise ValueError("manifest metadata is invalid")
            # Validate serialisability and normalize NaN-like values before returning.
            extra = _normalise_extra(extra)
            if touch:
                last_used = now
                touched = dict(payload)
                touched["last_used"] = last_used
                self._write_manifest_atomic(manifest_path, touched)
            return LyricsArtifactMetadata(
                cache_key=key.digest,
                key=key,
                vocals_path=vocals_path,
                manifest_path=manifest_path,
                size_bytes=size_bytes,
                created_at=created_at,
                last_used=last_used,
                extra=_freeze_json(extra),
            )
        except (OSError, ValueError, KeyError, TypeError, TimeoutError, json.JSONDecodeError):
            _safe_remove(entry, self.root)
            return None

    def _write_manifest_atomic(self, manifest_path: Path, payload: Mapping[str, Any]) -> None:
        temporary = manifest_path.with_name(f".{manifest_path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        data = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode("utf-8")
        try:
            with temporary.open("wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, manifest_path)
        finally:
            temporary.unlink(missing_ok=True)

    def get(self, key: LyricsArtifactCacheKey) -> LyricsArtifactMetadata | None:
        """manifest・WAV・TTLを検証し、hitなら last_used を更新して返す。"""

        if not isinstance(key, LyricsArtifactCacheKey):
            raise TypeError("key must be LyricsArtifactCacheKey")
        with self._lock:
            return self._read_entry(key, touch=True)

    def acquire(self, key: LyricsArtifactCacheKey) -> LyricsArtifactMetadata | None:
        """get と同じ検証を行う明示的な artifact 取得 API。"""

        return self.get(key)

    def put(
        self,
        key: LyricsArtifactCacheKey,
        vocals_wav: Path | str,
        *,
        metadata: Mapping[str, Any] | None = None,
        source_path: Path | str | None = None,
        created_at: float | None = None,
    ) -> LyricsArtifactMetadata:
        """vocals WAV を一時ディレクトリへコピーし、manifestと一緒に公開する。"""

        if not isinstance(key, LyricsArtifactCacheKey):
            raise TypeError("key must be LyricsArtifactCacheKey")
        source = Path(vocals_wav).expanduser()
        if not source.is_file() or source.is_symlink():
            raise ValueError("vocals_wav must be a regular file")
        if source_path is not None and fingerprint_source(source_path) != key.source_fingerprint:
            raise ValueError("source_path fingerprint does not match cache key")
        extra = _normalise_extra(metadata)
        timestamp = float(self._now() if created_at is None else created_at)
        if timestamp < 0:
            raise ValueError("created_at must be non-negative")
        with self._lock:
            self.root.mkdir(parents=True, exist_ok=True)
            entry = self._entry_path(key)
            temporary_dir = Path(tempfile.mkdtemp(prefix=f".{key.digest}.", dir=self.root))
            try:
                temporary_vocals = temporary_dir / _VOCALS_FILENAME
                shutil.copyfile(source, temporary_vocals)
                size_bytes = int(temporary_vocals.stat().st_size)
                manifest = {
                    "artifact": "demucs-vocals-wav",
                    "cache_format": key.cache_format,
                    "channels": key.channels,
                    "created_at": timestamp,
                    "demucs_model": key.demucs_model,
                    "key": key.canonical_payload(),
                    "last_used": timestamp,
                    "manifest_version": _MANIFEST_VERSION,
                    "metadata": extra,
                    "preprocess_version": key.preprocess_version,
                    "sample_rate": key.sample_rate,
                    "size_bytes": size_bytes,
                    "source_fingerprint": key.source_fingerprint,
                    "vocals_filename": _VOCALS_FILENAME,
                }
                self._write_manifest_atomic(temporary_dir / _MANIFEST_FILENAME, manifest)
                try:
                    temporary_dir.rename(entry)
                except FileExistsError:
                    # 同一 process の同一キー二重書込では、先に公開された有効 entry を採用。
                    existing = self._read_entry(key, touch=False)
                    if existing is None:
                        _safe_remove(entry, self.root)
                        temporary_dir.rename(entry)
                    else:
                        return existing
                return self._read_entry(key, touch=False) or (_ for _ in ()).throw(
                    RuntimeError("newly written cache entry failed validation")
                )
            finally:
                _safe_remove(temporary_dir, self.root)

    def prune(self) -> int:
        """期限切れを除去し、last_used の古い順に上限まで縮小する。"""

        with self._lock:
            if not self.root.is_dir():
                return 0
            now = float(self._now())
            entries: list[tuple[Path, int, float]] = []
            removed = 0
            for entry in list(self.root.iterdir()):
                if not entry.is_dir() or entry.is_symlink() or not _KEY_RE.fullmatch(entry.name):
                    continue
                manifest_path = self._manifest_path(entry)
                vocals_path = self._vocals_path(entry)
                try:
                    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
                    key_payload = payload.get("key")
                    if not isinstance(key_payload, dict):
                        raise ValueError
                    key = LyricsArtifactCacheKey(**key_payload)
                    item = self._read_entry(key, touch=False)
                    if item is None:
                        removed += 1
                        continue
                    if now - item.last_used > self.ttl_seconds:
                        _safe_remove(entry, self.root)
                        removed += 1
                        continue
                    entries.append((entry, item.size_bytes + int(manifest_path.stat().st_size), item.last_used))
                except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
                    _safe_remove(entry, self.root)
                    removed += 1
            total = sum(size for _entry, size, _last_used in entries)
            for entry, size, _last_used in sorted(entries, key=lambda row: row[2]):
                if total <= self.max_bytes:
                    break
                _safe_remove(entry, self.root)
                total -= size
                removed += 1
            return removed


__all__ = [
    "CACHE_FORMAT_VERSION",
    "CACHE_MAX_BYTES",
    "CACHE_TTL_SECONDS",
    "LyricsArtifactCache",
    "LyricsArtifactCacheKey",
    "LyricsArtifactMetadata",
    "build_cache_key",
    "compute_source_fingerprint",
    "default_cache_root",
    "fingerprint_source",
    "make_cache_key",
]
