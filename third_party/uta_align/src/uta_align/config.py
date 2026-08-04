from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, fields
from numbers import Real
from pathlib import Path
from typing import Any


@dataclass
class AlignConfig:
    model: str = "large-v3"
    language: str = "ja"
    device: str = "auto"
    compute_type: str = "default"
    window_seconds: float = 45.0
    overlap_seconds: float = 8.0
    retry_window_seconds: float = 18.0
    retry_offsets: tuple[float, ...] = (-1.0, -0.35, 0.0, 0.35)
    long_gap_seconds: float = 8.0
    hard_gap_seconds: float = 2.0
    boundary_search_seconds: float = 0.75
    adaptive_boundary_seconds: float = 4.0
    activity_bridge_seconds: float = 0.18
    activity_min_seconds: float = 0.10
    forbidden_tolerance_seconds: float = 0.025
    min_similarity: float = 0.42
    anchor_similarity: float = 0.57
    ambiguity_score_margin: float = 0.65
    consensus_cluster_seconds: float = 0.9
    consensus_max_dispersion_seconds: float = 0.65
    consensus_min_quality: float = 0.68
    consensus_competition_margin: float = 0.10
    consensus_min_independent_support: int = 2
    segment_freeze_min_similarity: float = 0.78
    segment_freeze_min_independence_groups: int = 2
    segment_freeze_min_strategy_groups: int = 2
    segment_word_agreement_seconds: float = 0.85
    require_segment_word_corroboration: bool = True
    context_prompt_max_tokens: int = 96
    context_prompt_line_radius: int = 3
    contextual_request_budget: int = 24
    enable_contextual_prompts: bool = True
    soft_gap_penalty_weight: float = 0.35
    conservative_soft_gap_avoidance: bool = False
    progress_prior_top_k_per_line: int = 4
    progress_prior_min_slope_ratio: float = 0.25
    progress_prior_max_slope_ratio: float = 4.0
    progress_prior_min_span_ratio: float = 0.15
    progress_prior_max_span_ratio: float = 1.25
    progress_prior_min_inlier_fraction: float = 0.45
    progress_prior_min_endpoint_coverage: float = 0.55
    lattice_prior_penalty_cap: float = 0.80
    lattice_skip_relative_penalty: float = 0.35
    lattice_min_selected_ratio: float = 0.70
    lattice_min_path_margin: float = 0.05
    lattice_require_valid_prior: bool = True
    allow_proportional_authoritative_lattice: bool = False
    max_progress_deviation: float = 0.20
    lattice_path_summary_count: int = 5
    lattice_end_reliability_weight: float = 0.12
    end_fusion_method: str = "weighted_upper_quantile"
    end_fusion_quantile: float = 0.85
    max_observation_span: int = 5
    min_line_seconds: float = 0.16
    max_line_seconds: float = 12.0
    use_vocal_stem_for_stt: bool = True
    input_audio_is_vocal_only: bool = False
    word_boundary_confidence_scale: float = 0.72
    beam_size: int = 5

    @classmethod
    def from_json(cls, path: str | Path) -> AlignConfig:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("configuration root must be an object")
        allowed = {f.name for f in fields(cls)}
        unknown = sorted(set(raw) - allowed)
        if unknown:
            raise ValueError(f"unknown configuration keys: {', '.join(unknown)}")
        if "retry_offsets" in raw:
            raw["retry_offsets"] = tuple(float(x) for x in raw["retry_offsets"])
        return cls(**raw)

    def merged(self, overrides: dict[str, Any]) -> AlignConfig:
        values = asdict(self)
        values.update({key: value for key, value in overrides.items() if value is not None})
        values["retry_offsets"] = tuple(values["retry_offsets"])
        return AlignConfig(**values)

    def validate(self) -> None:
        for name in ("model", "language", "device", "compute_type"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must not be empty")
        numeric_names = (
            "window_seconds",
            "overlap_seconds",
            "retry_window_seconds",
            "long_gap_seconds",
            "hard_gap_seconds",
            "boundary_search_seconds",
            "adaptive_boundary_seconds",
            "activity_bridge_seconds",
            "activity_min_seconds",
            "forbidden_tolerance_seconds",
            "min_similarity",
            "anchor_similarity",
            "ambiguity_score_margin",
            "consensus_cluster_seconds",
            "consensus_max_dispersion_seconds",
            "consensus_min_quality",
            "consensus_competition_margin",
            "segment_freeze_min_similarity",
            "segment_word_agreement_seconds",
            "soft_gap_penalty_weight",
            "progress_prior_min_slope_ratio",
            "progress_prior_max_slope_ratio",
            "progress_prior_min_span_ratio",
            "progress_prior_max_span_ratio",
            "progress_prior_min_inlier_fraction",
            "progress_prior_min_endpoint_coverage",
            "lattice_prior_penalty_cap",
            "lattice_skip_relative_penalty",
            "lattice_min_selected_ratio",
            "lattice_min_path_margin",
            "max_progress_deviation",
            "lattice_end_reliability_weight",
            "end_fusion_quantile",
            "min_line_seconds",
            "max_line_seconds",
            "word_boundary_confidence_scale",
        )
        for name in numeric_names:
            value = getattr(self, name)
            if (
                isinstance(value, bool)
                or not isinstance(value, Real)
                or not math.isfinite(float(value))
            ):
                raise ValueError(f"{name} must be a finite number")
        if self.window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        if not 0 <= self.overlap_seconds < self.window_seconds:
            raise ValueError("overlap_seconds must be >= 0 and smaller than window_seconds")
        if self.retry_window_seconds <= 0:
            raise ValueError("retry_window_seconds must be positive")
        if not self.retry_offsets or not all(math.isfinite(item) for item in self.retry_offsets):
            raise ValueError("retry_offsets must contain finite values")
        if self.hard_gap_seconds <= 0:
            raise ValueError("hard_gap_seconds must be positive")
        if self.long_gap_seconds < self.hard_gap_seconds:
            raise ValueError("long_gap_seconds must be >= hard_gap_seconds")
        if self.boundary_search_seconds < 0:
            raise ValueError("boundary_search_seconds must not be negative")
        if self.adaptive_boundary_seconds < self.boundary_search_seconds:
            raise ValueError(
                "adaptive_boundary_seconds must be >= boundary_search_seconds"
            )
        if self.activity_bridge_seconds < 0 or self.activity_min_seconds <= 0:
            raise ValueError("invalid activity component settings")
        if not 0 <= self.forbidden_tolerance_seconds < self.hard_gap_seconds:
            raise ValueError("invalid forbidden_tolerance_seconds")
        if self.min_line_seconds <= 0 or self.max_line_seconds <= self.min_line_seconds:
            raise ValueError("invalid line duration bounds")
        if not 0 <= self.min_similarity <= self.anchor_similarity <= 1:
            raise ValueError("similarity thresholds must satisfy 0 <= min <= anchor <= 1")
        if self.ambiguity_score_margin < 0:
            raise ValueError("ambiguity_score_margin must not be negative")
        if self.consensus_cluster_seconds <= 0:
            raise ValueError("consensus_cluster_seconds must be positive")
        if self.consensus_max_dispersion_seconds <= 0:
            raise ValueError("consensus_max_dispersion_seconds must be positive")
        if not 0 <= self.consensus_min_quality <= 1:
            raise ValueError("consensus_min_quality must be in [0, 1]")
        if self.consensus_competition_margin < 0:
            raise ValueError("consensus_competition_margin must not be negative")
        if not 0 <= self.segment_freeze_min_similarity <= 1:
            raise ValueError("segment_freeze_min_similarity must be in [0, 1]")
        if self.segment_word_agreement_seconds < 0:
            raise ValueError("segment_word_agreement_seconds must not be negative")
        if self.soft_gap_penalty_weight < 0:
            raise ValueError("soft_gap_penalty_weight must not be negative")
        if not (
            0 < self.progress_prior_min_slope_ratio
            <= self.progress_prior_max_slope_ratio
        ):
            raise ValueError("invalid progress prior slope ratios")
        if not (
            0 < self.progress_prior_min_span_ratio
            <= self.progress_prior_max_span_ratio
        ):
            raise ValueError("invalid progress prior span ratios")
        for name in (
            "progress_prior_min_inlier_fraction",
            "progress_prior_min_endpoint_coverage",
            "lattice_min_selected_ratio",
        ):
            value = getattr(self, name)
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be in [0, 1]")
        if self.lattice_prior_penalty_cap < 0:
            raise ValueError("lattice_prior_penalty_cap must not be negative")
        if self.lattice_skip_relative_penalty < 0:
            raise ValueError(
                "lattice_skip_relative_penalty must not be negative"
            )
        if self.lattice_min_path_margin < 0:
            raise ValueError("lattice_min_path_margin must not be negative")
        if not 0 <= self.max_progress_deviation <= 0.50:
            raise ValueError("max_progress_deviation must be in [0, 0.50]")
        if not 0 <= self.lattice_end_reliability_weight <= 0.25:
            raise ValueError("lattice_end_reliability_weight must be in [0, 0.25]")
        if not 0.50 <= self.end_fusion_quantile <= 0.95:
            raise ValueError("end_fusion_quantile must be in [0.50, 0.95]")
        if self.end_fusion_method not in {
            "weighted_upper_quantile",
            "huber_medoid",
        }:
            raise ValueError(
                "end_fusion_method must be weighted_upper_quantile or huber_medoid"
            )
        if (
            not isinstance(self.consensus_min_independent_support, int)
            or self.consensus_min_independent_support < 2
        ):
            raise ValueError("consensus_min_independent_support must be at least 2")
        for name in (
            "segment_freeze_min_independence_groups",
            "segment_freeze_min_strategy_groups",
        ):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 2:
                raise ValueError(f"{name} must be at least 2")
        if (
            not isinstance(self.progress_prior_top_k_per_line, int)
            or isinstance(self.progress_prior_top_k_per_line, bool)
            or self.progress_prior_top_k_per_line < 2
        ):
            raise ValueError(
                "progress_prior_top_k_per_line must be at least 2"
            )
        if (
            not isinstance(self.lattice_path_summary_count, int)
            or isinstance(self.lattice_path_summary_count, bool)
            or self.lattice_path_summary_count < 2
        ):
            raise ValueError("lattice_path_summary_count must be at least 2")
        if (
            not isinstance(self.context_prompt_max_tokens, int)
            or isinstance(self.context_prompt_max_tokens, bool)
            or self.context_prompt_max_tokens < 1
        ):
            raise ValueError("context_prompt_max_tokens must be at least 1")
        if (
            not isinstance(self.context_prompt_line_radius, int)
            or isinstance(self.context_prompt_line_radius, bool)
            or self.context_prompt_line_radius < 0
        ):
            raise ValueError("context_prompt_line_radius must not be negative")
        if (
            not isinstance(self.contextual_request_budget, int)
            or isinstance(self.contextual_request_budget, bool)
            or self.contextual_request_budget < 0
        ):
            raise ValueError("contextual_request_budget must not be negative")
        if not isinstance(self.max_observation_span, int) or self.max_observation_span < 1:
            raise ValueError("max_observation_span must be at least 1")
        if not 0 < self.word_boundary_confidence_scale <= 1:
            raise ValueError("word_boundary_confidence_scale must be in (0, 1]")
        if not isinstance(self.beam_size, int) or self.beam_size < 1:
            raise ValueError("beam_size must be at least 1")
        if not isinstance(self.lattice_require_valid_prior, bool):
            raise ValueError("lattice_require_valid_prior must be boolean")
        if not isinstance(
            self.allow_proportional_authoritative_lattice,
            bool,
        ):
            raise ValueError(
                "allow_proportional_authoritative_lattice must be boolean"
            )
        if not isinstance(self.use_vocal_stem_for_stt, bool):
            raise ValueError("use_vocal_stem_for_stt must be boolean")
        if not isinstance(self.input_audio_is_vocal_only, bool):
            raise ValueError("input_audio_is_vocal_only must be boolean")
        if not isinstance(
            self.require_segment_word_corroboration,
            bool,
        ):
            raise ValueError(
                "require_segment_word_corroboration must be boolean"
            )
        if not isinstance(self.enable_contextual_prompts, bool):
            raise ValueError("enable_contextual_prompts must be boolean")
        if not isinstance(self.conservative_soft_gap_avoidance, bool):
            raise ValueError("conservative_soft_gap_avoidance must be boolean")
