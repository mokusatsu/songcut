# uta-align

`uta-align` aligns every line of **known lyrics** to the time at which it is
sung. It is intended for Japanese songs where ordinary speech-to-text output is
useful as noisy temporal evidence but must never be treated as the source of the
lyrics.

The JSON result contains exactly the non-empty input lyric lines, in the same
order. It never emits an STT-only line. SRT and LRC are optional secondary
outputs.

## Why this is not transcript matching

A single Whisper transcript commonly loses the first phrase of a song, loses
the first phrase after an instrumental, or invents credit-like text in quiet
audio. `uta-align` therefore uses several distinct stages:

1. Parse lyrics into ordered lines. Blank lines create explicit lyric blocks. The
   trimmed original input text is preserved byte-for-byte at the Unicode
   code-point level for JSON/SRT/LRC; NFKC, case folding, whitespace folding,
   and punctuation removal apply only to the separate matching form.
2. Run an unprompted full-audio pass plus at most one short head/global
   `initial_prompt`, then context-reset overlapping windows that rotate among
   unprompted, local `initial_prompt`, and local `hotwords` strategies. Local
   lyric context is selected from cumulative lyric-character progress at the
   window midpoint, kept in original line order, and capped by a conservative
   token budget. A request never sends both prompt mechanisms.
3. Detect long recognition gaps, then run the same bounded strategy variants
   around the song head and each candidate block boundary. The total contextual
   request budget is fixed, prompted failures are nonfatal, and loop guards
   prevent retry amplification. A vocal stem can provide additional trustworthy
   silence boundaries and can be used for STT. Retry planning first checks which
   lyric lines already have strong candidates; it retries only while coverage is
   missing. Confirmed silence triggers a retry only when it is internal and
   bracketed by observations—leading and trailing silence do not.
4. Remove known credit/subtitle hallucinations unless they genuinely match an
   input lyric line.
5. Build line candidates from consecutive timestamped STT observations, then
   cluster each line's timing hypotheses across decorrelated independence
   groups. Repeated evidence from the same window/strategy/boundary family is
   capped before consensus and cannot inflate support. Robust weighted medians
   combine agreeing groups; support count, strategy diversity, temporal
   dispersion, text similarity, confidence, no-speech probability, and boundary
   kind produce an explicit consensus quality score. On a normal mixture,
   single-pass generic segments and word/unknown-only boundaries remain weak
   hints rather than frozen anchors. Near-equal, semantically strong clusters at
   different times are demoted for a unique lyric line instead of being guessed.
   Repeated lyrics remain eligible as separate temporal occurrence slots.
6. Before freeze selection, every line's full candidate pool enters a global
   monotonic lattice with candidate and line skips. It enforces interval order,
   non-overlap, repeat-slot uniqueness, hard barriers, and duration bounds.
   Emissions combine similarity, quality, strategy diversity, and a prompt-
   correlation penalty; transitions compare audio gaps with cumulative lyric-
   character progress. Prior fitting retains the configured top-K unprompted or
   trusted word hypotheses per line instead of locally collapsing to one. Pair
   models use one vote per distinct lyric line and are chosen lexicographically
   by line coverage, time span, then quality before a Theil-Sen refit. Slope vs.
   usable-audio proportional rate, predicted span, inlier fraction, and endpoint
   coverage must pass generic plausibility bounds; otherwise the weak/no-penalty
   proportional fallback is used. Emissions and skips are median/MAD-normalized.
   The whole lattice is accepted when selected ratio and an authoritative,
   validated robust progress prior pass; path margin is diagnostic and never
   rejects an otherwise valid path. A rejected or insufficient multi-hypothesis
   fit remains a diagnostic proportional prior and atomically injects no path.
   The legacy proportional-authority behavior requires an explicit opt-in and
   marks every selected hint low-confidence. The bounded top-path beam reports
   aggregate scores and per-line
   agreement buckets. Low agreement or a remote alias lowers local confidence
   and adds provenance, but the best-path nonstrong item still supplies its own
   line's authoritative desired center and fused duration. It never gains
   interpolation/extrapolation authority. A rejected lattice injects nothing.
   Strong unprompted/trusted anchors stay exact when they pass the applicable
   progress gate; contradictory prompt-only freezes are demoted. Without a
   validated robust prior, normal-mixture freeze candidates must lie within a
   generic cumulative-lyric/usable-audio normalized progress envelope. Leading,
   trailing, and internal hard barriers are removed from the audio coordinate.
   Validated robust priors use a bounded residual gate instead. Explicit trusted
   acoustic sources are exempt, and outliers remain local-only weak hints.
   A small bounded end-reliability term breaks otherwise close start-emission
   ties. After starts are fixed, independent source/group-capped word/segment
   ends are fused by a weighted upper quantile (default q=0.85, configurable
   from 0.50 to 0.95). The former Huber medoid remains a legacy option. If fewer
   than two independent end groups remain, an optional robust seconds-per-
   character prior is blended 50/50 with raw duration, then clamped by order,
   hard barriers, and configured duration.
7. A monotonic dynamic program assigns only freeze-eligible candidates in the
   strict pass. It scores time order, long gaps, explicit block changes, and
   repeated occurrence slots; unresolved alternatives remain visible in
   structured diagnostics. After retries, recognition gaps are derived only
   from observations supporting high-quality consensus candidates. Unrelated,
   hallucinated, weak, or outlier-only STT evidence cannot close a gap.
   Recognition-only gaps are soft diagnostics, never hard forbidden intervals.
   Hard barriers require a confirmed silence from a trusted vocal signal or the
   semantic condition below. Confirmed acoustic silences are softened if the
   remaining safe capacity cannot fit missing lines at minimum duration or is
   pathologically fragmented. Additionally, a hard gap between adjacent
   high-quality lyric anchors becomes
   a semantic no-singing barrier because no input lyric line is missing between
   those anchors.
8. Keep both Whisper word and segment timing hypotheses. For a trusted
   isolated-vocal signal, extend a line toward its connected activity component
   and use neighboring anchors plus local pause minima to partition components.
   On an ordinary mix, a segment candidate freezes only when similarity is at
   least 0.78, at least two source-family-capped decorrelated groups and two
   prompt strategies agree, an independent-family word boundary agrees in time,
   at least one contributing source is unprompted or trusted acoustic evidence,
   and the configured duration/quality checks pass. A failed candidate remains a local
   weak hint only; it cannot interpolate, extrapolate, or propagate timing.
9. Refine strict anchored starts and ends within a small acoustic search radius,
   then validate positive, monotonic, bounded timestamps and forbidden-interval
   exclusion.
10. If strict alignment fails ordinarily, continue through completion-first
   fallbacks: relaxed strong-anchor assignment, component-aware interpolation,
   then a barrier-aware provisional schedule. The exception path first reruns
   eligible-only assignment and preserves its strong anchors. An all-candidate
   pass supplies hints only for lines without a strong anchor; a higher-scoring
   weak candidate can never overwrite a strong candidate for the same line.
   A locally ambiguous strong line is demoted without discarding strong anchors
   on other lines. If a repeated-lyric occurrence group remains unresolved, all
   indexes in that group are demoted together; a partially selected repetition
   is never left frozen. Resolved repetition groups stay eligible. Public group
   diagnostics use an ordinal group ID, indexes, and reason code without lyric
   text. Stage 3 receives frozen anchors and weak hints separately,
   freezes valid anchors at their original times/components, and applies hints
   only inside surrounding strong bounds and one safe component.
11. Stage 4 preserves every valid frozen anchor at its exact time, component,
   and candidate provenance. Leading, intermediate, and trailing unanchored runs
   are allocated independently between those fixed boundaries. Stage 4 reuses
   Stage 3 desired centers, desired durations, and bounded weak hints. A weak
   hint becomes a direct provisional center only when it satisfies the existing
   consensus quality, independent support, dispersion, similarity, no-speech,
   boundary, anchor-bound, and safe-component checks. Accepted hints remain
   unfrozen. Candidates demoted for ambiguity, unresolved repetition, competing
   temporal clusters, ordering, forbidden-interval, component, or zero-capacity
   conflict are excluded from both direct geometry and weak blending. Their
   stable reason remains in candidate metadata and text-free diagnostics. Safe
   single-pass and low-support hints remain bounded weak signals. A
   maximum-quality monotonic chain rejects other contradictory hints; two
   or more accepted hints interpolate internal gaps and extrapolate missing run
   ends, while one hint changes only its own desired center. With no trusted hint,
   desired centers are spread by cumulative lyric-weight quantiles across the
   anchor-adjacent safe component or the available region between anchors; they
   are not packed immediately beside an anchor. When trusted vocal activity is
   available, desired centers first use activity capacity inside the same
   barrier/anchor bounds; multiple activity components are traversed in order.
   Safe capacity outside activity is used only when activity alone is
   insufficient. Recognition-only gaps are passed into Stage 4 as typed soft intervals.
   By default they contribute a finite, graded overlap cost to the timing
   objective instead of a lexicographic zero-overlap constraint, so ordinary
   geometric fidelity can outweigh a small soft-gap overlap. The optional
   `conservative_soft_gap_avoidance` mode restores the older avoid/compress/
   minimum-intrusion policy. Trusted vocal activity remains preferred over the
   soft penalty. A low-support hint inside an
   unconfirmed recognition gap is downweighted locally and never gains
   interpolation or extrapolation authority. Stage 4 otherwise keeps desired
   durations when capacity is sufficient and uses weighted order-constrained
   projection to minimize each line's center error across safe components;
   proportional compression occurs only when a run lacks capacity. Only run lines may become positive sub-minimum durations, with confidence at most
   0.02; anchors never move and no line crosses a silence or semantic barrier.
   If an anchor leaves mathematically zero positive capacity for an adjacent
   run, the lower-quality adjacent anchor is demoted and the schedule is retried.
   With no frozen anchors, Stage 4 uses accepted authoritative lattice hints
   only for their own lines when present; otherwise it uses the global safe-
   component schedule.
   Only zero total safe capacity triggers an emergency full-audio schedule,
   declaring barrier_override=true and confidence at most 0.01.


Mixture RMS is **not** called singing VAD. On a normal mix the energy envelope
is only a small local boundary cue. Only an explicitly supplied vocal stem, or
main audio explicitly declared isolated vocal with `--vocal-only`, can produce
trusted activity/no-vocal intervals. STT confidence/no-speech evidence remains
separate and is reported separately. For a normal mix, precise boundaries
require a synchronized vocal stem, another explicitly trusted singing-activity
signal, or sufficient model segment/line support. Without one of those, the strict pass fails and `uta-align` returns a clearly
labeled low-confidence fallback instead of silently claiming precision.

## Install

Python 3.10 or later is required.

```bash
python -m pip install .
```

For real recognition with faster-whisper:

```bash
python -m pip install '.[whisper]'
```

For development:

```bash
python -m pip install '.[dev]'
pytest
ruff check .
mypy src
```

`ffmpeg` is required for compressed audio. PCM WAV works without it.
faster-whisper downloads/loads the configured model in its normal manner; that
can require substantial disk, memory, and GPU/CPU time.

## Usage

The lyrics file is plain UTF-8 text. Keep a blank line where a verse or other
known block boundary occurs:

```text
最初のフレーズ
次のフレーズ

二番の最初
二番の続き
```

Run the real backend:

```bash
uta-align song.wav lyrics.txt \
  --output aligned.json \
  --srt aligned.srt \
  --lrc aligned.lrc \
  --backend faster-whisper \
  --model large-v3 \
  --language ja
```

If a synchronized vocal stem is available, prefer it:

```bash
uta-align mixture.flac lyrics.txt \
  --vocal-stem vocals.flac \
  --output aligned.json
```

The stem duration must agree with the mixture within 0.25 seconds. By default it
is used for both STT and acoustic boundary work.

When the input itself is an isolated vocal rather than a normal mix:

```bash
uta-align isolated-vocal.wav lyrics.txt \
  --vocal-only \
  --output aligned.json
```

Do not use `--vocal-only` for a normal accompaniment mix.

### Deterministic JSON backend

This backend is useful for tests, tuning the aligner independently of model
changes, and ingesting timestamped output produced elsewhere:

```bash
uta-align song.wav lyrics.txt \
  --backend json \
  --transcript-json observations.json \
  --output aligned.json
```

`observations.json`:

```json
{
  "observations": [
    {
      "start": 1.02,
      "end": 1.84,
      "text": "最初のフレーズ",
      "confidence": 0.91,
      "no_speech_prob": 0.03,
      "boundary_support": "segment"
    }
  ]
}
```

Timestamps are absolute seconds. The optional `visible_in` array can contain
`global`, `overlap`, `head_retry`, or `gap_retry`; it exists to reproduce model
omissions in deterministic regression tests. `boundary_support` is `word`,
`segment`, `line`, or `unknown`; JSON observations default to `segment`.

## Configuration

CLI options cover common tuning:

```text
--model --language --device --compute-type
--window-seconds --overlap-seconds
--retry-window-seconds
--long-gap-seconds --hard-gap-seconds
--boundary-search-seconds --adaptive-boundary-seconds
--max-line-seconds --vocal-only
```

`--config settings.json` accepts every `AlignConfig` field. CLI values override
the file:

```json
{
  "model": "large-v3",
  "language": "ja",
  "window_seconds": 45.0,
  "overlap_seconds": 8.0,
  "retry_window_seconds": 18.0,
  "retry_offsets": [-1.0, -0.35, 0.0, 0.35],
  "long_gap_seconds": 8.0,
  "hard_gap_seconds": 2.0,
  "boundary_search_seconds": 0.75,
  "adaptive_boundary_seconds": 4.0,
  "activity_bridge_seconds": 0.18,
  "activity_min_seconds": 0.1,
  "forbidden_tolerance_seconds": 0.025,
  "min_similarity": 0.42,
  "anchor_similarity": 0.57,
  "ambiguity_score_margin": 0.65,
  "consensus_cluster_seconds": 0.9,
  "consensus_max_dispersion_seconds": 0.65,
  "consensus_min_quality": 0.68,
  "consensus_competition_margin": 0.1,
  "consensus_min_independent_support": 2,
  "segment_freeze_min_similarity": 0.78,
  "segment_freeze_min_independence_groups": 2,
  "segment_freeze_min_strategy_groups": 2,
  "segment_word_agreement_seconds": 0.85,
  "context_prompt_max_tokens": 96,
  "context_prompt_line_radius": 3,
  "contextual_request_budget": 24,
  "enable_contextual_prompts": true,
  "soft_gap_penalty_weight": 0.35,
  "conservative_soft_gap_avoidance": false,
  "progress_prior_top_k_per_line": 4,
  "progress_prior_min_slope_ratio": 0.25,
  "progress_prior_max_slope_ratio": 4.0,
  "progress_prior_min_span_ratio": 0.15,
  "progress_prior_max_span_ratio": 1.25,
  "progress_prior_min_inlier_fraction": 0.45,
  "progress_prior_min_endpoint_coverage": 0.55,
  "lattice_prior_penalty_cap": 0.8,
  "lattice_skip_relative_penalty": 0.35,
  "lattice_min_selected_ratio": 0.7,
  "lattice_min_path_margin": 0.05,
  "lattice_require_valid_prior": true,
  "allow_proportional_authoritative_lattice": false,
  "max_progress_deviation": 0.20,
  "lattice_path_summary_count": 5,
  "lattice_end_reliability_weight": 0.12,
  "end_fusion_method": "weighted_upper_quantile",
  "end_fusion_quantile": 0.85,
  "max_observation_span": 5,
  "min_line_seconds": 0.16,
  "max_line_seconds": 12.0,
  "input_audio_is_vocal_only": false,
  "word_boundary_confidence_scale": 0.72
}
```

Unknown configuration keys and invalid ranges are errors.
lattice_min_path_margin is retained for configuration compatibility and
reporting only; it is not an acceptance gate.
allow_proportional_authoritative_lattice defaults to false because a rejected
multi-hypothesis fit is not authoritative evidence. max_progress_deviation is
the normal-mixture fallback envelope, defaults conservatively to 0.20, and
must be between 0 and 0.50. Values above 0.20 are reported as an explicitly
relaxed envelope.

## Output

JSON is mandatory:

```json
{
  "schema_version": 1,
  "duration": 203.71,
  "lines": [
    {
      "index": 0,
      "block": 0,
      "text": "最初のフレーズ",
      "start": 1.02,
      "end": 2.31,
      "confidence": 0.88,
      "provenance": ["faster-whisper:head_retry:segment"],
      "diagnostics": {
        "anchored": true,
        "text_similarity": 1.0,
        "observation_span": [0, 2],
        "acoustic_refinement": {}
      }
    }
  ],
  "diagnostics": {
    "backend_requests": [],
    "rejected_observations": [],
    "confirmed_vocal_stem_silences": [],
    "post_retry_recognition_gaps": [],
    "semantic_no_singing_barriers": [],
    "semantic_barrier_diagnostics": [],
    "candidate_consensus": {},
    "global_candidate_lattice": {},
    "alignment": {},
    "fallback": null
  }
}
```

Confidence is an aligner score in `[0, 1]`, not a calibrated probability.
`safe_interpolation` provenance identifies strict two-sided inference. Fallback
provenance names stage 2, 3, or 4 and its confidence is deliberately capped.

`diagnostics.fallback` is `null` for a strict result. Otherwise it records
stage, strict and fallback reason codes, affected lyric indexes, warnings, STT
request count, and the original strict failure. Ambiguity also includes the
score margin, competing candidate times, and best/alternative path summaries.
Unresolved repetition diagnostics identify groups by ordinal ID and lyric line
indexes, never by normalized lyric text.
Fallback diagnostics record candidate-input counts and classification counts
separately from actual final-output counts. actual_frozen_count,
actual_demoted_count, and actual_weak_hint_used_count are recomputed from
line provenance; compatibility fields such as strong_frozen_count always mean
the actual output. Stage 4 also reports barrier respect/override, safe component
capacity, compressed-line count, and any anchor-preservation failure reason.

Forbidden-interval diagnostics distinguish confirmed acoustic silence,
recognition-only soft gaps, and semantic barriers, including hard/soft status
and capacity-guard reasons without recognized text.

Global-lattice diagnostics expose only aggregate candidate/valid/path-selected/
skip and accepted/injected/rejected/overridden/actual-used lineage counts,
acceptance reason, path score/margin, top-path accepted/rejected score summaries,
prior rate/intercept and usable/predicted spans, validation subreasons, per-line
agreement histogram counts, remote-disagreement count, end-fusion family-group
histogram, proportional-authority decision/reason, normalized progress-gate
counts and deviation buckets, and duration-prior counts. They contain no lyric,
recognized text, candidate-time arrays, or per-line timestamps.

No raw STT text or lyric prompt text is emitted anywhere in successful JSON
diagnostics. Rejected observations and request records expose only non-text
metadata such as reason, timing, confidence, no-speech probability, request
kind, prompt strategy/source family/independence group, token count, and
boundary support. Output text always comes from the trimmed original lyrics
input.

The public `align_lyrics` pipeline returns a complete result for ordinary
ambiguity, missing anchors, silence conflicts, unsupported boundaries, and
insufficient evidence. The CLI exits 0 and writes JSON/SRT/LRC for those
fallbacks. Invalid configuration, unreadable or undecodable audio, and other
technical input failures can still exit nonzero.

## Known constraints

- Precise results still depend on useful timestamp evidence. With no lyric
  anchor, stage 4 distributes all lines provisionally across the decoded audio
  span; those times are not observed singing events.
- Stage 3 never moves a valid high-quality anchor across a forbidden gap.
  Weak candidates are hints only and cannot cross strong-anchor bounds,
  no-singing barriers, or safe components. The allocator reserves component
  capacity for remaining lines, but falls through to stage 4 when no valid
  component-aware schedule exists.
- Stage 4 retains classified frozen anchors in the actual output and compresses
  only the runs around them. Classification and actual provenance counts are
  reported separately. Only when total safe capacity is exactly zero does the
  emergency schedule override barriers, with explicit warnings and confidence
  at most 0.01.
- Whisper boundaries for melisma, breathy vocals, overlapping singers, or
  extreme tempo remain acoustically ambiguous.
- A separated vocal stem helps, but separation artifacts can shift its envelope.
- LRC carries starts only; use JSON or SRT when end times matter.
- The included tests use public generated PCM audio and deterministic fake/JSON
  recognition. They do not establish accuracy for a particular model or song.
