# Worker report

## Scope and privacy

Only the public source, tests, and documentation in this project were used.
No upload area, Library content, song test data, audio/subtitle/video asset,
reviewer directory, or reviewer log was opened. The implementation responds
only to generalized engineering findings.

## Implemented behavior

The aligner treats STT as fallible temporal evidence and always emits text from
the known lyrics input. Matching uses a separate NFKC/case-folded,
punctuation-insensitive form; displayed JSON/SRT/LRC text preserves every
internal code point and punctuation mark from the trimmed original lyric line.
A leading UTF-8 BOM is treated as file metadata rather than lyric content.

The strict monotonic DP now retains competing paths and reports structured
`AlignmentError` data. Repeated lyric groups are mapped to temporal occurrence
slots. Lyric order, selected unique anchors, explicit blocks, segment/line
support, and a bounded positional prior for a missing internal occurrence
resolve ordinary chorus repetitions. Unresolved hypotheses report affected
lines, score margin, best and competing paths, candidate times, slot analysis,
and executed STT request count.

The public pipeline preserves strict behavior as its first stage and then
completes ordinary failures through:

1. strict materialization and validation;
2. relaxed order-constrained assignment;
3. component-aware anchor interpolation/extrapolation;
4. a global provisional schedule.

Fallback results contain every non-empty input lyric line with positive,
monotonic times. Stage 2 confidence is capped at 0.46. Stage 3 uses at most 0.34
for frozen anchors, 0.14 for inferred lines, and 0.10 for a demoted anchor line.
Stage 4 uses 0.04. Provenance names the fallback stage and result diagnostics
preserve the strict failure, fallback reasons, affected lines, warnings, STT
request count, and ambiguity alternatives.

## Generalized review remediation

### Alias-resistant multi-hypothesis progress prior

Progress fitting no longer collapses each lyric line to its locally top-ranked
candidate. It retains the configured top-K high-confidence unprompted/trusted
word hypotheses per line, generates models only from distinct-line candidate
pairs, and gives each lyric line at most one inlier vote. Models are ranked
lexicographically by distinct-line coverage, covered time span, then evidence
quality, followed by a Theil-Sen refit. This lets a lower-ranked chronological
hypothesis defeat a slightly higher but temporally collapsed coherent alias.

The model is validated against the hard-barrier-excluded usable-audio
proportional rate, predicted lyric-span/audio ratio, inlier-line fraction,
endpoint coverage, and predicted overlap with the audio. All bounds are generic
configuration. Rejected robust fits become a proportional fallback with no
candidate prior penalty; no private timing value or lyric text participates.

### Normalized lattice acceptance and authoritative local use

Candidate emissions are median/MAD-normalized before applying a capped prior
penalty. Skip cost is on the same relative scale, so a valid candidate normally
beats a skip while gross order/barrier/duration violations remain skippable.
The complete path is accepted only when selected-line ratio and an authoritative validated robust prior pass; path margin is diagnostic. Proportional fallback is diagnostic-only by default and requires explicit low-confidence opt-in. Otherwise all lattice selections are rejected and legacy
strict/completion behavior receives no partial hint injection.

For an accepted path, nonstrong selections become authoritative desired centers
and fused durations for their own Stage 3/4 lines. They cannot interpolate or
extrapolate neighboring lines. Strong unprompted/trusted anchors override them
and remain exact. Prompt-only conflicting freezes can be demoted to the accepted
path. Diagnostics expose aggregate selected, accepted, rejected, injected,
strong-override and demotion counts plus stable reasons, without text.
### Reliable-source freeze gate

Normal-mixture freezing now requires at least one unprompted or trusted-acoustic
source. Evidence is capped by source family after the existing independence-
group/boundary cap, so multiple lyric-conditioned variants cannot manufacture
independence. Segment/word corroboration also requires distinct groups and
families and must include reliable-source evidence. Prompt-only consensus remains
a local provisional hint and has no interpolation or extrapolation authority.

### Global candidate lattice and robust timing priors

All per-line candidates, including provisional ones, enter a bounded global beam
lattice with candidate/line skips. The path enforces interval order, non-overlap,
repeat-slot uniqueness, hard barriers, and configured durations. Emissions use
similarity, quality, confidence, strategy diversity, freeze state, and a prompt-
correlation penalty. Transitions compare observed start gaps with cumulative
lyric-character progress. High-confidence unprompted/trusted word candidates
fit a deterministic fixed-threshold pair-consensus/Theil-Sen progress-to-time
prior; insufficient evidence uses global proportional progress.

A lattice choice is local provisional evidence for its own line. It never gains
propagation authority. A conflicting prompt-only freeze is demoted when the
path selects reliable evidence. Insufficient lattice coverage enters the
existing completion-first Stage 4 path and still returns every lyric line.

Starts are selected first. Ends from the same line/start cluster are then capped
by group and source family and fused with a weighted upper quantile (default q=0.85; legacy Huber remains configurable). Only when
independent end evidence is insufficient, a robust seconds-per-character prior
learned from corroborated segment+word candidates is blended 50/50 with the raw
duration. Ends are clamped by the next selected start, hard barriers, and
configured duration limits. Public lattice diagnostics contain aggregate counts,
path score/margin, prior point/inlier counts, and fusion counts only—never text.
### Bounded contextual request planning

The full-audio unprompted pass is always retained. At most one short head/global
`initial_prompt` is added, while overlap and retry windows rotate through
unprompted, local `initial_prompt`, and local `hotwords` strategies. Local
context is selected from cumulative lyric-character progress at each window
midpoint, remains in line order, and is capped by a conservative token proxy.
Requests carry prompt strategy, source family, and independence-group metadata;
`initial_prompt` and `hotwords` are mutually exclusive. A fixed contextual
request budget and loop guard bound work. Prompted backend failures are recorded
without prompt/error text and do not prevent the unprompted completion path.

### Candidate consensus quality gate

Timing candidates are clustered per lyric line across decorrelated independence
groups. Evidence from the same window/strategy/boundary family is capped before
the robust weighted-median consensus and cannot inflate support. Each public
candidate diagnostic reports decorrelated group count/IDs, strategy diversity,
source families, request IDs, temporal dispersion, similarity, confidence,
no-speech probability, boundary kind, aggregate quality, freeze eligibility,
and a stable reason code. On a normal mixture, a segment freezes only at
similarity >= 0.78 with at least two decorrelated groups, two strategies, and
independent time-agreeing word evidence, in addition to duration/quality checks.
A failed segment remains a local weak hint and receives no interpolation,
extrapolation, or propagation authority. A single generic segment or a
word/unknown-only boundary is retained only as a weak hint. Near-equal high-quality clusters at distinct
times are also demoted for a unique lyric line, while repeated lyric lines keep
separate occurrence slots for ordered assignment.

Recognition gaps now use only observations that support freeze-eligible,
high-quality consensus candidates, but recognition-only gaps remain soft and
never become hard forbidden intervals. Hard barriers require independent trusted
vocal evidence for confirmed acoustic silence, or adjacent high-quality lyric
anchors with no missing input line. Confirmed silences pass a missing-line
capacity, one-line minimum, and fragmentation guard; impossible barriers are
softened with a stable reason. Diagnostics type every interval as confirmed
acoustic silence, recognition-only gap, or semantic barrier without text.
Stage 3 freezes only eligible anchors;
demoted candidates can influence desired centers only between surrounding
strong anchors and inside the same safe interval, never across a barrier or
component.

### Strong-anchor recovery and weak-hint isolation

After any strict failure, the pipeline first reruns eligible-only assignment
without raising on ambiguity. Only lyric indexes identified by an ordinary strict
ambiguity are demoted; unrelated strong lines remain available. If repetition
slot resolution is still non-unique, every occurrence index in that unresolved
group is demoted together, while resolved groups remain frozen. Public group
diagnostics use only an ordinal group ID, lyric indexes, and a reason code; they
never include normalized lyric text. The subsequent
hint search fixes those surviving strong candidates in its candidate map and
uses all candidates only on lines that lack a strong anchor. A higher-scoring
weak candidate therefore cannot replace or distort a strong line. Stage 3 takes
frozen anchors and weak hints as separate inputs. Diagnostics report selected,
frozen, and demoted strong counts, weak-hint count, and a stable overwrite
prevention reason without recognized text.

### Recognition-soft-aware Stage 4

Recognition-only gaps reach Stage 4 as typed soft intervals instead of remaining
report-only metadata. Frozen anchors, hard acoustic/semantic barriers, safe
component identity, lyric order, and run bounds remain unchanged. The default
optimizer assigns soft overlap a finite, graded cost together with weighted
center/hint error, rather than enforcing zero overlap lexicographically.
Ordinary timing geometry can therefore outweigh a small soft-gap intrusion.
The previous avoid/compress/minimum-intrusion policy remains available only with
`conservative_soft_gap_avoidance=true`. Slot counting still accounts for
fragmented capacity.

Trusted vocal activity is removed from the soft penalty before scheduling and
therefore wins over recognition omissions. Low-support weak hints whose centers
fall inside an unconfirmed recognition gap receive a local-only weight
reduction; they still cannot interpolate or extrapolate surrounding lines.
Ambiguous and semantically conflicted candidates remain excluded. Text-free
diagnostics report mixture-only/trusted-activity state, penalty mode and weight,
desired/minimum/free capacity, overlap seconds, and conservative-only unavoidable
overlap.

### Anchor-preserving compressed Stage 4

When Stage 3 fails only because an unanchored run cannot meet normal minimum
durations, Stage 4 now reuses the same classified anchors, weak hints, exact
safe components, and barriers. Frozen anchors are materialized at their exact
candidate times with candidate provenance. Leading, intermediate, and trailing
runs are allocated independently between fixed anchor bounds. The allocator
receives the same desired centers and durations as Stage 3 and preserves desired
duration when capacity is sufficient. Weak hints that meet the existing
consensus-quality, independent-support, dispersion, similarity, no-speech, and
boundary conditions become direct provisional center observations without
becoming frozen anchors. Candidates demoted for local ambiguity, unresolved repetition,
competing temporal clusters, monotonic conflict, forbidden collision, component
conflict, or zero-capacity anchor conflict are excluded from both direct geometry
and low-quality blending. Their stable reason remains in candidate metadata and
text-free line/group diagnostics. Safe single-pass, low-support hints remain
bounded weak signals. A maximum-quality monotonic hint chain rejects other
contradictions; two or more accepted hints interpolate internal missing lines and
extrapolate leading or trailing missing lines, while a single hint affects only
its own line. Runs with no trusted hint distribute desired centers by cumulative
lyric-weight quantiles across the anchor-adjacent safe component or the available
span between two anchors instead of packing against an anchor. Weighted isotonic
regression plus a component dynamic program
minimizes per-line desired-center error. Desired durations are proportionally
compressed only when safe run capacity is insufficient.

If a run has zero positive capacity beside frozen anchors, Stage 4 demotes the
lower-quality adjacent anchor and retries. Exact barrier collision and monotonic
anchor conflicts are likewise resolved by maximum anchor count, then aggregate
quality, then score. Total zero safe capacity remains the only emergency
barrier-override condition.

Candidate input counts, classified counts, and final actual counts are separate.
Actual frozen, demoted, and used-weak counts are derived from output provenance;
legacy strong count fields are overwritten with those actual values, preventing
a reported-frozen/non-frozen-output mismatch.
### Barrier-aware completion Stage 4

Stage 4 computes the complement of all acoustic, recognition, and semantic
barriers, distributes ordered lyric lines among safe components, and allocates
duration by lyric-length weight without crossing a component boundary. When
safe capacity is below the normal minimum-duration budget, it compresses lines
to positive durations and caps their confidence at 0.02. Every positive safe
interval remains usable even below the normal tolerance. Only exactly zero safe
capacity activates the emergency full-audio schedule, which declares
barrier_override=true, emits explicit warnings, and caps confidence at 0.01.
### Component-aware stage 3

Stage 3 no longer scans safe intervals with earliest-fit placement. Candidate
anchors are first checked for audio bounds, configured duration, forbidden-gap
intersection, and containment in one safe component. A maximum-cardinality,
maximum-score monotonic anchor chain is frozen at the exact original times.
Invalid or order-conflicting anchors are explicitly demoted rather than moved to
another component.

Only unanchored runs are scheduled. Each run is bounded by its adjacent frozen
anchors (or the audio edge), considers every safe component in that span, and
chooses the feasible placement closest to its desired center. The allocator
reserves a minimum-duration slot count for every later line, so a locally
attractive placement cannot consume required downstream capacity. The complete
stage-3 result is passed through final strict validation; failure falls through
to stage 4 without breaking the completion-first contract.

Recognition-gap evidence is now limited to observations participating in a
candidate at or above `anchor_similarity`. An unrelated or hallucinated STT
observation cannot create a false evidence island or split a real hard gap.
Broad segment observations that genuinely support a lyric candidate continue to
contribute their full temporal coverage.

### No raw STT text in public diagnostics

Rejected-observation diagnostics no longer include `text` or a text hash.
They expose reason, start/end, confidence, no-speech probability, provenance,
request kind, prompt strategy/source family/independence group, and boundary
support only. Backend request diagnostics expose strategy, context token count,
reset/failure state, and loop-guard state, but never recognized text, lyric
prompt text, or backend exception text. Candidate/path diagnostics contain timing
and scores but no recognition text. Public tests serialize the entire result
and verify that unknown raw STT tokens are absent.

### Original lyric text preservation

`parse_lyrics_text` now uses `strip()` only for the displayed line and keeps
full-width punctuation, compatibility characters, ellipses, tabs, repeated
internal spaces, and ideographic spaces. NFKC and punctuation removal are
confined to `normalized`, which is used only for matching.

## Public regression coverage

The public generated/synthetic suite covers Japanese normalization, exact
source-text preservation, BOM handling, credit hallucination filtering without
text leakage, missing heads and long interludes, held-vowel boundary support,
strict gaps, two/four/six/eight repeated occurrences, unique-anchor and block
constraints, a supported missing repetition, true ambiguity diagnostics,
all four completion stages, no-anchor/no-evidence completion, JSON/SRT/LRC CLI
output, and optimized STT request counts.

Component-aware tests cover the specific public reproduction with safe
intervals [0,10] and [20,30] and a late anchor [25,27], multiple anchors and
components, leading/trailing runs, forbidden-anchor demotion, order-conflict
demotion, and insufficient capacity falling through to stage 4. Added regressions cover
unresolved repetition-group-wide demotion with resolved-group preservation and
text-free group diagnostics, plus leading/intermediate/trailing Stage 4 excess
capacity with desired durations/centers and weak hints. Further tests reproduce
the prior 64.5667-second pooled placement, verify two-hint interpolation and both
directions of extrapolation, single-hint behavior, conflicting-hint rejection,
barrier/component containment, capacity compression, exact anchor bounds, and
configured-duration rejection of a synthetic 4.848-second proxy candidate.
Round-eight coverage excludes seven semantic-conflict reason classes from weak
geometry, mixes safe and ambiguous hints, preserves bounded single-pass hints,
spreads no-hint leading/intermediate/trailing runs, checks multiple components,
and verifies robust multi-observation end consensus against a long single proxy.
Round-nine coverage verifies recognition-only gaps remain soft with no trusted
activity, confirmed-silence capacity softening, activity-guided anchored and
global schedules with one or multiple components, and safe-capacity fallback
when trusted activity alone is insufficient. Round-ten coverage adds leading,
intermediate, trailing, multiple-soft, hard-barrier, frozen-anchor,
trusted-activity, low-support-hint, proportional-compression,
minimum-intrusion, and all-fallback soft-gap schedules in explicit conservative
mode. Round-eleven coverage verifies local progress-based context and token caps,
exact faster-whisper `initial_prompt`/`hotwords` transfer and mutual exclusion,
contextual coverage gain, nonfatal/redacted prompt failure, independence-group
support caps, each segment-freeze condition and their passing combination, and
the default finite soft-gap penalty. Round-thirteen coverage adds coherent-alias
majority rejection with the chronological path, plausible multi-hypothesis
time-span selection, normalized selection above 70%, sparse whole-path rejection,
Stage 3 authoritative center/fused-end use, exact strong anchors, rejected-path
legacy full-line completion, and text-free acceptance diagnostics. Round-fourteen coverage adds zero-margin full-path acceptance with every authoritative hint used, remote top-path disagreement with low confidence and provenance, weighted q=0.85 later-than-median end fusion with ordering/duration clamps, source-family vote caps, bounded end-reliability tie-breaking, and redacted replay-stable aggregate diagnostics. H14-1 coverage adds atomic rejection of a 28/30 proportional-fallback path, explicit low-confidence opt-in, normalized 76-second progress-outlier demotion, hard-barrier/padding-aware in-envelope retention, trusted acoustic exemption, and validated-prior residual gating. The conservative follow-up fixes the default envelope at 0.20, rejects the public 30-line line-23 synthetic at about 0.221 deviation, and labels an explicit 0.25 configuration as relaxed. Round-twelve
coverage adds prompt-only
multi-group rejection, reliable unprompted corroboration, source-family caps,
globally consistent lower-score selection, repeat slots, barrier/line skips,
robust progress outlier rejection, local-freeze path demotion, source-capped weighted-quantile end fusion, robust duration blending, and lattice-failure Stage 4
completion.
Consensus coverage additionally exercises
robust median behavior with an outlier, single-pass generic demotion, competing
unique-line clusters, repeated occurrence separation, semantic barriers, and
weak-hint containment.

## Verification

- `pytest -q`: 158 passed
- `ruff check .`: passed
- `mypy src`: 14 source files, no issues
- wheel and sdist build: passed
- CLI `--help`: exit 0
- extracted-sdist test run: 158 passed

## Residual risks

No real faster-whisper model or real singing audio was run in this environment,
so real-song timing accuracy is not established. Compressed-audio decoding was
not exercised by the generated PCM tests. Stage 4 is intentionally a
completeness fallback, not an accuracy claim. Normal Stage 4 remains inside safe
components; only the explicit zero-capacity emergency may overlap no-singing
regions, with barrier override, confidence, provenance, and warnings exposed.
