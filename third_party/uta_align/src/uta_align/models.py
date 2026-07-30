from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

BoundarySupport = Literal["word", "segment", "line", "unknown"]
PromptStrategy = Literal[
    "unprompted",
    "global_initial_prompt",
    "local_initial_prompt",
    "local_hotwords",
]


@dataclass(frozen=True)
class LyricLine:
    index: int
    block: int
    text: str
    normalized: str


@dataclass(frozen=True)
class Observation:
    start: float
    end: float
    text: str
    confidence: float = 0.5
    no_speech_prob: float = 0.0
    provenance: str = "unknown"
    request_kind: str = "unknown"
    boundary_support: BoundarySupport = "unknown"
    request_id: str = "unknown"
    prompt_strategy: PromptStrategy = "unprompted"
    source_family: str = "unknown"
    independence_group: str = "unknown"
    prompt_strategies: tuple[PromptStrategy, ...] = ()
    source_families: tuple[str, ...] = ()
    independence_groups: tuple[str, ...] = ()

    def shifted(self, offset: float, provenance: str | None = None) -> Observation:
        return Observation(
            start=self.start + offset,
            end=self.end + offset,
            text=self.text,
            confidence=self.confidence,
            no_speech_prob=self.no_speech_prob,
            provenance=provenance or self.provenance,
            request_kind=self.request_kind,
            boundary_support=self.boundary_support,
            request_id=self.request_id,
            prompt_strategy=self.prompt_strategy,
            source_family=self.source_family,
            independence_group=self.independence_group,
            prompt_strategies=self.prompt_strategies,
            source_families=self.source_families,
            independence_groups=self.independence_groups,
        )


@dataclass(frozen=True)
class TranscriptionRequest:
    start: float
    end: float
    kind: Literal["global", "overlap", "head_retry", "gap_retry"]
    prompt: str | None = None
    context_reset: bool = False
    prompt_strategy: PromptStrategy = "unprompted"
    source_family: str = "unknown"
    independence_group: str = "unknown"
    initial_prompt: str | None = None
    hotwords: str | None = None


@dataclass(frozen=True)
class Candidate:
    line_index: int
    obs_start_index: int
    obs_end_index: int
    start: float
    end: float
    similarity: float
    confidence: float
    score: float
    provenance: tuple[str, ...]
    boundary_support: BoundarySupport = "unknown"
    request_ids: tuple[str, ...] = ()
    support_observation_indexes: tuple[int, ...] = ()
    no_speech_prob: float = 0.0
    support_count: int = 1
    time_dispersion: float = 0.0
    quality_score: float = 1.0
    consensus: bool = False
    freeze_eligible: bool = True
    quality_reason: str = "legacy_candidate"
    independence_groups: tuple[str, ...] = ()
    prompt_strategies: tuple[PromptStrategy, ...] = ()
    source_families: tuple[str, ...] = ()
    boundary_support_types: tuple[BoundarySupport, ...] = ()
    lattice_path_confidence: float = 1.0
    lattice_remote_disagreement: bool = False
    lattice_top_path_votes: int = 0
    lattice_top_path_agreeing_votes: int = 0


@dataclass
class AlignedLine:
    index: int
    block: int
    text: str
    start: float
    end: float
    confidence: float
    provenance: list[str]
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AlignmentResult:
    lines: list[AlignedLine]
    duration: float
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "duration": self.duration,
            "lines": [line.to_dict() for line in self.lines],
            "diagnostics": self.diagnostics,
        }
