"""歌詞行を表示素へ分割し、CTC token の時刻を逆マッピングする純粋処理。

このモジュールは音声モデルやファイル I/O を直接呼び出さない。Standard Align と
MMS/CTC の間で交換する中間表現だけを扱うため、通常の単体テストでは合成 token
span を入力できる。日本語の読み変換は ``pykakasi`` を遅延 import し、呼び出し側が
``romanize`` を渡せばモデルに依存しない検証も行える。
"""

from __future__ import annotations

import hashlib
import math
import statistics
import unicodedata
from dataclasses import dataclass, replace
from typing import Callable, Iterable, Mapping, Sequence


Romanizer = Callable[[str, str], str]


@dataclass(frozen=True)
class DisplayElementSeed:
    """原文範囲と発音範囲を対応付けた表示素の種。

    ``source_start``/``source_end`` は Python 文字列の code point offset、発音範囲
    は同じ行の発音列を連結したときの offset である。表示素の安定 ID は時刻に
    依存しないため、再解析しても同じ原文要素を識別できる。
    """

    index: int
    text: str
    source_start: int
    source_end: int
    pronunciation: str = ""
    pronunciation_start: int = 0
    pronunciation_end: int = 0
    origin_key: str = ""
    stable_id: str = ""
    token_start: int = 0
    token_end: int = 0

    @property
    def id(self) -> str:
        """安定 ID の短縮別名。"""

        return self.stable_id


@dataclass(frozen=True)
class CtcTokenSpan:
    """CTC backtrace で得た一 token の絶対秒範囲。"""

    token_index: int
    token_id: int
    token_text: str
    line_index: int
    start: float
    end: float
    confidence: float
    seed_index: int | None = None
    pronunciation_start: int | None = None
    pronunciation_end: int | None = None
    is_star: bool = False

    @property
    def duration(self) -> float:
        """token の正の長さ（負値は品質判定で無効として扱う）。"""

        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class DisplayElementTokenMapping:
    """表示素一つが占める発音文字・MMS token の範囲。"""

    seed_index: int
    pronunciation_start: int
    pronunciation_end: int
    token_start: int
    token_end: int
    token_ids: tuple[int, ...] = ()
    token_text: str = ""

    @property
    def token_count(self) -> int:
        """対応 token 数。"""

        return max(0, self.token_end - self.token_start)


@dataclass(frozen=True)
class DisplayElement:
    """保存・GUI表示用の表示素。

    時刻は歌詞行ではなく音源全体に対する絶対秒である。``manual_*`` は境界を
    ユーザーが固定したか、``manual_structure`` はマージや blank 追加など構造を
    ユーザーが編集したかを表す。``parent_revision`` が行 revision と一致しない
    場合は stale と判定できる。
    """

    index: int
    text: str
    start: float
    end: float
    confidence: float
    source: str
    source_start: int = 0
    source_end: int = 0
    pronunciation: str = ""
    token_start: int = 0
    token_end: int = 0
    origin_key: str = ""
    stable_id: str = ""
    manual_start: bool = False
    manual_end: bool = False
    manual_structure: bool = False
    parent_revision: int = 0
    conflict: str | None = None
    orphaned_manual: bool = False

    @property
    def id(self) -> str:
        """安定 ID の短縮別名。"""

        return self.stable_id

    @property
    def is_blank(self) -> bool:
        """文字に対応しない blank 表示素か。"""

        return self.text == ""

    @property
    def duration(self) -> float:
        """表示素の正の長さ。"""

        return max(0.0, self.end - self.start)


# 計画書で使われた名前も外部利用しやすいように公開する。
AlignedDisplayElement = DisplayElement


@dataclass(frozen=True)
class DisplayAlignmentDiagnostics:
    """表示素 CTC の品質指標と採否理由。

    ``accepted`` が false のときは行全体の発音量比例 fallback を選ぶ。
    ``partial`` は token が一部だけ欠落しており、隣接成功 token 間を補間した
    ことを表す。しきい値はモデル依存なので引数で上書き可能だが、初期値は
    synthetic test と実音源の監視に使える保守的な値にしている。
    """

    coverage: float = 0.0
    confidence: float = 0.0
    low_confidence: float = 0.0
    median_duration: float = 0.0
    max_duration_ratio: float = 0.0
    star_ratio: float = 0.0
    window_edge_concentration: float = 0.0
    speed: float = 0.0
    next_anchor_displacement: float | None = None
    isolated_first_token: bool = False
    monotonicity_violations: int = 0
    boundary_conflict: bool = False
    overflow_before: float = 0.0
    overflow_after: float = 0.0
    accepted: bool = False
    partial: bool = False
    rejection_reasons: tuple[str, ...] = ()

    @property
    def token_coverage(self) -> float:
        """coverage の互換別名。"""

        return self.coverage

    @property
    def median_token_confidence(self) -> float:
        """confidence の互換別名。"""

        return self.confidence

    @property
    def edge_concentration(self) -> float:
        """window edge 集中率の短縮別名。"""

        return self.window_edge_concentration


ElementAlignmentDiagnostics = DisplayAlignmentDiagnostics


@dataclass(frozen=True)
class DisplayAlignmentResult:
    """表示素列と診断結果。

    リストとして扱う既存の呼び出し側にも配慮し、``len(result)`` と添字アクセスを
    ``elements`` へ委譲する。
    """

    elements: tuple[DisplayElement, ...]
    diagnostics: DisplayAlignmentDiagnostics
    source: str
    parent_revision: int = 0

    def __iter__(self):
        return iter(self.elements)

    def __len__(self) -> int:
        return len(self.elements)

    def __getitem__(self, item):
        return self.elements[item]


def stable_display_element_id(
    line_id: str | int | None,
    index: int,
    text: str,
    source_start: int,
    source_end: int,
    *,
    origin_key: str | None = None,
) -> str:
    """時刻に依存しない表示素 stable ID を決定論的に生成する。

    原文範囲と line ID を namespace に含め、同じ行を再解析しても ID が変わらない。
    ``origin_key`` は手動構造を引き継ぐ場合に呼び出し側が指定できる。
    """

    key = origin_key or f"{line_id!s}:{index}:{source_start}:{source_end}:{text}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return f"de-{digest}"


_SMALL_KANA = frozenset(
    "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶゕゖ"
    "ㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ"
)
_SOKUON = frozenset("っッ")
_LONG_VOWEL = "ー"
_VARIATION_RANGES = ((0xFE00, 0xFE0F), (0xE0100, 0xE01EF))
_MIN_ELEMENT_DURATION = 0.001


def _is_combining_or_variation(character: str) -> bool:
    codepoint = ord(character)
    if unicodedata.category(character).startswith("M") or codepoint == 0x200D:
        return True
    return any(start <= codepoint <= end for start, end in _VARIATION_RANGES)


def _is_small_kana(character: str) -> bool:
    return character in _SMALL_KANA


def _is_non_pronouncing(grapheme: str) -> bool:
    """句読点・記号・空白を発音なしとみなす。"""

    if not grapheme:
        return True
    first = grapheme[0]
    if first in _SOKUON or first == _LONG_VOWEL or _is_small_kana(first):
        return False
    if first.isspace():
        return True
    category = unicodedata.category(first)
    return category.startswith(("P", "S"))


def _raw_graphemes(text: str) -> list[tuple[str, int, int]]:
    output: list[tuple[str, int, int]] = []
    for offset, character in enumerate(text):
        if _is_combining_or_variation(character) and output:
            previous, start, _end = output[-1]
            if not previous.isspace():
                output[-1] = (previous + character, start, offset + 1)
                continue
        if _is_small_kana(character) and character not in _SOKUON and output:
            previous, start, _end = output[-1]
            # 長音・句読点に続く小かなは独立表示素にする。
            if not _is_non_pronouncing(previous) and previous[-1] not in _SOKUON:
                output[-1] = (previous + character, start, offset + 1)
                continue
        if character == _LONG_VOWEL and output:
            previous, start, _end = output[-1]
            if previous and not _is_non_pronouncing(previous) and previous[-1] not in _SOKUON:
                output[-1] = (previous + character, start, offset + 1)
                continue
        output.append((character, offset, offset + 1))
    return output


def _default_romanize(text: str, language: str) -> str:
    if language.lower() in {"ja", "jpn", "japanese"}:
        try:
            from pykakasi import kakasi
        except ImportError:
            # pykakasi は optional dependency なので、読みを提供できない環境でも
            # API を利用できるよう原文を返す。実際の MMS 経路は導入を要求する。
            return text
        return "".join(str(item.get("hepburn", "")) for item in kakasi().convert(text))
    return text


def _normalize_pronunciation(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        character
        for character in normalized
        if character.isascii() and (character.isalnum() or character == "'")
    )


def _contextual_pronunciations(
    individual: Sequence[str],
    contextual: str,
) -> tuple[str, ...]:
    """行全体の読みを、原文順を保ったまま各表示素へ再配分する。

    ``pykakasi`` は ``っ`` を単独では ``tsu``、語中では子音促音として変換し、
    漢字の読みも前後文脈で変わる。このため表示素ごとの変換結果をそのまま連結
    すると、MMSへ渡した行全体のtarget token列と一致しない。個別読みの連結と
    文脈付き読みを編集距離で単調整列し、各表示素の境界を文脈付き列へ写す。
    戻り値の連結は必ず ``contextual`` と一致する。
    """

    if not individual:
        return ()
    nonempty_positions = [index for index, pronunciation in enumerate(individual) if pronunciation]
    if not nonempty_positions:
        return tuple("" for _ in individual)
    if len(nonempty_positions) != len(individual):
        nonempty = tuple(individual[index] for index in nonempty_positions)
        mapped = _contextual_pronunciations(nonempty, contextual)
        output = [""] * len(individual)
        for index, pronunciation in zip(nonempty_positions, mapped):
            output[index] = pronunciation
        return tuple(output)
    source = "".join(individual)
    if not contextual:
        return tuple(individual)
    if not source:
        return (contextual,) + tuple("" for _ in individual[1:])

    source_length = len(source)
    target_length = len(contextual)
    costs = [[0] * (target_length + 1) for _ in range(source_length + 1)]
    moves = [[""] * (target_length + 1) for _ in range(source_length + 1)]
    for source_index in range(1, source_length + 1):
        costs[source_index][0] = source_index
        moves[source_index][0] = "delete"
    for target_index in range(1, target_length + 1):
        costs[0][target_index] = target_index
        moves[0][target_index] = "insert"
    for source_index in range(1, source_length + 1):
        for target_index in range(1, target_length + 1):
            substitution = costs[source_index - 1][target_index - 1] + (
                source[source_index - 1] != contextual[target_index - 1]
            )
            deletion = costs[source_index - 1][target_index] + 1
            insertion = costs[source_index][target_index - 1] + 1
            best = min(substitution, deletion, insertion)
            costs[source_index][target_index] = best
            # Matching/substitution keeps element boundaries most stable. On a
            # tie, consume source before treating a target character as an
            # insertion at the next element boundary.
            moves[source_index][target_index] = (
                "diagonal" if substitution == best else "delete" if deletion == best else "insert"
            )

    path: list[str] = []
    source_index = source_length
    target_index = target_length
    while source_index or target_index:
        move = moves[source_index][target_index]
        path.append(move)
        if move == "diagonal":
            source_index -= 1
            target_index -= 1
        elif move == "delete":
            source_index -= 1
        else:
            target_index -= 1
    path.reverse()

    source_boundaries: list[int] = []
    cursor = 0
    for pronunciation in individual:
        cursor += len(pronunciation)
        source_boundaries.append(cursor)
    target_boundaries: list[int] = []
    source_cursor = 0
    target_cursor = 0
    boundary_index = 0
    for move in path:
        if move in {"diagonal", "delete"}:
            source_cursor += 1
        if move in {"diagonal", "insert"}:
            target_cursor += 1
        while boundary_index < len(source_boundaries) and source_cursor >= source_boundaries[boundary_index]:
            target_boundaries.append(target_cursor)
            boundary_index += 1
    while len(target_boundaries) < len(individual):
        target_boundaries.append(target_length)
    target_boundaries[-1] = target_length

    output: list[str] = []
    previous = 0
    for boundary in target_boundaries:
        boundary = min(target_length, max(previous, boundary))
        output.append(contextual[previous:boundary])
        previous = boundary
    if previous < target_length:
        output[-1] += contextual[previous:]
    return tuple(output)


def split_display_elements(
    text: str,
    *,
    line_id: str | int | None = None,
    language: str = "jpn",
    romanize: Romanizer | None = None,
) -> tuple[DisplayElementSeed, ...]:
    """原文を発音に対応する deterministic な表示素へ分割する。

    結合文字・variation selector は直前 code point に結合し、小書きかなは直前の
    発音単位へ、促音 ``っ/ッ`` は独立要素へ、長音記号は直前要素へ含める。句読点・
    記号は空白で区切られた各範囲内で、直前の発音要素（先頭なら直後の要素）へ付加
    する。空白は一文字ずつ独立した表示素にするため、seed を連結した ``text`` は
    常に原文と一致する。
    """

    if not text:
        return ()
    raw = _raw_graphemes(text)
    grouped: list[tuple[str, int, int]] = []

    def flush_non_whitespace(segment: list[tuple[str, int, int]]) -> None:
        pending: list[tuple[str, int, int]] = []
        segment_grouped: list[tuple[str, int, int]] = []
        for grapheme, start, end in segment:
            if _is_non_pronouncing(grapheme):
                if segment_grouped:
                    previous, previous_start, _previous_end = segment_grouped[-1]
                    segment_grouped[-1] = (previous + grapheme, previous_start, end)
                else:
                    pending.append((grapheme, start, end))
                continue
            if pending:
                prefix = "".join(item[0] for item in pending)
                start = pending[0][1]
                grapheme = prefix + grapheme
                pending.clear()
            segment_grouped.append((grapheme, start, end))
        if pending:
            if segment_grouped:
                previous, previous_start, _previous_end = segment_grouped[-1]
                segment_grouped[-1] = (previous + "".join(item[0] for item in pending), previous_start, pending[-1][2])
            else:
                segment_grouped = pending
        grouped.extend(segment_grouped)

    non_whitespace: list[tuple[str, int, int]] = []
    for item in raw:
        if item[0].isspace():
            flush_non_whitespace(non_whitespace)
            non_whitespace = []
            grouped.append(item)
        else:
            non_whitespace.append(item)
    flush_non_whitespace(non_whitespace)

    convert = romanize or _default_romanize
    individual_pronunciations: list[str] = []
    for element_text, _source_start, _source_end in grouped:
        if element_text.isspace():
            individual_pronunciations.append("")
            continue
        try:
            individual_pronunciations.append(_normalize_pronunciation(convert(element_text, language)))
        except Exception:
            # 変換器の一部入力で失敗しても原文範囲を失わず fallback できる。
            individual_pronunciations.append(_normalize_pronunciation(element_text))
    try:
        contextual = _normalize_pronunciation(convert(text, language))
    except Exception:
        contextual = ""
    pronunciations = (
        _contextual_pronunciations(individual_pronunciations, contextual)
        if contextual
        else tuple(individual_pronunciations)
    )

    seeds: list[DisplayElementSeed] = []
    pronunciation_offset = 0
    for index, (element_text, source_start, source_end) in enumerate(grouped):
        pronunciation = pronunciations[index]
        pronunciation_start = pronunciation_offset
        pronunciation_offset += len(pronunciation)
        origin_key = f"{line_id!s}:{source_start}:{source_end}" if line_id is not None else ""
        stable_id = stable_display_element_id(
            line_id,
            index,
            element_text,
            source_start,
            source_end,
            origin_key=origin_key or None,
        )
        seeds.append(
            DisplayElementSeed(
                index=index,
                text=element_text,
                source_start=source_start,
                source_end=source_end,
                pronunciation=pronunciation,
                pronunciation_start=pronunciation_start,
                pronunciation_end=pronunciation_offset,
                origin_key=origin_key,
                stable_id=stable_id,
            )
        )
    return tuple(seeds)


def build_display_element_seeds(
    text: str,
    *,
    line_id: str | int | None = None,
    language: str = "jpn",
    romanize: Romanizer | None = None,
) -> tuple[DisplayElementSeed, ...]:
    """``split_display_elements`` の読みやすい公開別名。"""

    return split_display_elements(text, line_id=line_id, language=language, romanize=romanize)


def map_pronunciation_to_tokens(
    seeds: Sequence[DisplayElementSeed],
    vocabulary: Mapping[str, int],
) -> tuple[DisplayElementTokenMapping, ...]:
    """表示素の発音文字を MMS 語彙へ写像し、token 範囲を保存する。

    MMS の日本語前処理と同じく一文字 token を基本とし、語彙に存在しない発音は
    mapping から除外する。除外された発音は coverage を下げるため、呼び出し側は
    CTC 不採用時に発音量比例 fallback を選択できる。
    """

    result: list[DisplayElementTokenMapping] = []
    token_cursor = 0
    for seed in seeds:
        token_ids: list[int] = []
        token_text: list[str] = []
        for character in seed.pronunciation:
            if character.isspace():
                continue
            candidate = character.casefold()
            token_id = vocabulary.get(character)
            if token_id is None:
                token_id = vocabulary.get(candidate)
            if token_id is None:
                continue
            token_ids.append(int(token_id))
            token_text.append(candidate)
        start = token_cursor
        token_cursor += len(token_ids)
        result.append(
            DisplayElementTokenMapping(
                seed_index=seed.index,
                pronunciation_start=seed.pronunciation_start,
                pronunciation_end=seed.pronunciation_end,
                token_start=start,
                token_end=token_cursor,
                token_ids=tuple(token_ids),
                token_text="".join(token_text),
            )
        )
    return tuple(result)


def map_seed_pronunciation_to_tokens(
    seeds: Sequence[DisplayElementSeed],
    vocabulary: Mapping[str, int],
) -> tuple[DisplayElementTokenMapping, ...]:
    """``map_pronunciation_to_tokens`` の明示的な別名。"""

    return map_pronunciation_to_tokens(seeds, vocabulary)


def attach_token_ranges(
    seeds: Sequence[DisplayElementSeed],
    mappings: Sequence[DisplayElementTokenMapping],
) -> tuple[DisplayElementSeed, ...]:
    """token mapping の範囲を immutable seed へ反映する。"""

    by_index = {mapping.seed_index: mapping for mapping in mappings}
    return tuple(
        replace(
            seed,
            token_start=by_index[seed.index].token_start if seed.index in by_index else 0,
            token_end=by_index[seed.index].token_end if seed.index in by_index else 0,
        )
        for seed in seeds
    )


def evaluate_display_alignment_quality(
    tokens: Sequence[CtcTokenSpan],
    *,
    expected_token_count: int | None = None,
    window_start: float | None = None,
    window_end: float | None = None,
    next_anchor: float | None = None,
    next_anchor_candidate: float | None = None,
    observed_star_ratio: float | None = None,
    coverage_threshold: float = 0.60,
    confidence_threshold: float = 0.35,
    max_duration_ratio_threshold: float = 6.0,
    star_ratio_threshold: float = 0.55,
    edge_concentration_threshold: float = 0.85,
    minimum_speed: float = 0.40,
    maximum_speed: float = 20.0,
    next_anchor_displacement_threshold: float = 1.5,
) -> DisplayAlignmentDiagnostics:
    """CTC token の coverage・confidence・異常 duration 等を診断する。

    ここでは行を変更せず、採否と診断値だけを返す。window 端集中、孤立 first token、
    STAR 率、次 anchor 変位を明示的に計算するため、局所 CTC の部分失敗を UI/API
    が表示できる。
    """

    ordered = sorted(tokens, key=lambda token: token.token_index)
    stars = [token for token in ordered if token.is_star or token.token_text == "*" or token.token_text == "<star>"]
    valid = [token for token in ordered if token not in stars and token.end > token.start and math.isfinite(token.start) and math.isfinite(token.end)]
    expected = expected_token_count if expected_token_count is not None else len([token for token in ordered if token not in stars])
    coverage = len(valid) / max(1, expected)
    confidences = [max(0.0, min(1.0, float(token.confidence))) for token in valid]
    # MMS CTC commonly gives strong evidence to consonant/onset tokens while
    # sustained vowels remain in the blank state. A median of every roman
    # character therefore rejects good singing even when ordered onset
    # anchors are unambiguous. Keep the minimum as a diagnostic, and use the
    # upper-half median as the aggregate evidence score.
    confidence = (
        statistics.median(sorted(confidences)[len(confidences) // 2 :])
        if confidences
        else 0.0
    )
    low_confidence = min(confidences) if confidences else 0.0
    durations = [token.end - token.start for token in valid]
    median_duration = statistics.median(durations) if durations else 0.0
    max_duration_ratio = max(durations) / median_duration if median_duration > 0 else (math.inf if durations else 0.0)

    edge_concentration = 0.0
    if valid and window_start is not None and window_end is not None and window_end > window_start:
        width = window_end - window_start
        tolerance = max(0.05, width * 0.10)
        edge_count = sum(
            token.start <= window_start + tolerance or token.end >= window_end - tolerance
            for token in valid
        )
        edge_concentration = edge_count / len(valid)

    monotonicity_violations = sum(
        right.start < left.start or right.end < left.end
        for left, right in zip(valid, valid[1:])
    )
    isolated_first = False
    if len(valid) >= 2:
        first, second = valid[0], valid[1]
        gap = second.start - first.end
        isolated_first = (
            gap > max(0.20, median_duration * 2.5)
            or first.duration > max(0.05, median_duration * 4.0)
            or (window_start is not None and first.start <= window_start + max(0.05, (window_end or window_start + 1) - window_start) * 0.02 and gap > max(0.10, median_duration * 1.5))
        )
    speed = len(valid) / max(1e-9, valid[-1].end - valid[0].start) if valid else 0.0
    displacement = (
        abs(next_anchor_candidate - next_anchor)
        if next_anchor_candidate is not None and next_anchor is not None
        else None
    )
    boundary_conflict = False
    overflow_before = 0.0
    overflow_after = 0.0
    if window_start is not None:
        overflow_before = max(0.0, window_start - min((token.start for token in valid), default=window_start))
    if window_end is not None:
        overflow_after = max(0.0, max((token.end for token in valid), default=window_end) - window_end)
    boundary_conflict = overflow_before > 0 or overflow_after > 0

    reasons: list[str] = []
    if coverage < coverage_threshold:
        reasons.append("coverage")
    if confidence < confidence_threshold:
        reasons.append("confidence")
    if max_duration_ratio > max_duration_ratio_threshold:
        reasons.append("duration")
    star_ratio = (
        max(0.0, min(1.0, float(observed_star_ratio)))
        if observed_star_ratio is not None
        else len(stars) / max(1, len(ordered))
    )
    if star_ratio > star_ratio_threshold:
        reasons.append("star_ratio")
    if edge_concentration > edge_concentration_threshold:
        reasons.append("window_edge")
    if valid and (speed < minimum_speed or speed > maximum_speed):
        reasons.append("speed")
    if displacement is not None and displacement > next_anchor_displacement_threshold:
        reasons.append("next_anchor_displacement")
    if monotonicity_violations:
        reasons.append("monotonicity")
    if isolated_first:
        reasons.append("isolated_first_token")
    return DisplayAlignmentDiagnostics(
        coverage=coverage,
        confidence=confidence,
        low_confidence=low_confidence,
        median_duration=median_duration,
        max_duration_ratio=max_duration_ratio,
        star_ratio=star_ratio,
        window_edge_concentration=edge_concentration,
        speed=speed,
        next_anchor_displacement=displacement,
        isolated_first_token=isolated_first,
        monotonicity_violations=monotonicity_violations,
        boundary_conflict=boundary_conflict,
        overflow_before=overflow_before,
        overflow_after=overflow_after,
        accepted=not reasons,
        partial=not reasons and coverage < 1.0,
        rejection_reasons=tuple(reasons),
    )


def quality_gate(*args, **kwargs) -> DisplayAlignmentDiagnostics:
    """品質診断関数の短縮別名。"""

    return evaluate_display_alignment_quality(*args, **kwargs)


def _seed_weights(
    seeds: Sequence[DisplayElementSeed],
    mappings: Mapping[int, DisplayElementTokenMapping] | None,
) -> list[float]:
    weights: list[float] = []
    for seed in seeds:
        mapping = mappings.get(seed.index) if mappings else None
        count = mapping.token_count if mapping is not None else sum(not character.isspace() for character in seed.pronunciation)
        weights.append(float(max(1, count)))
    return weights


def _token_seed_assignments(
    seeds: Sequence[DisplayElementSeed],
    tokens: Sequence[CtcTokenSpan],
    mappings: Mapping[int, DisplayElementTokenMapping] | None,
) -> dict[int, list[CtcTokenSpan]]:
    assignments: dict[int, list[CtcTokenSpan]] = {seed.index: [] for seed in seeds}
    mapping_ranges = [mapping for mapping in mappings.values()] if mappings else []
    for token_position, token in enumerate(sorted(tokens, key=lambda item: item.token_index)):
        if token.is_star or token.token_text in {"*", "<star>"}:
            continue
        seed_index = token.seed_index
        if seed_index is None and mapping_ranges:
            for mapping in mapping_ranges:
                if mapping.token_start <= token.token_index < mapping.token_end:
                    seed_index = mapping.seed_index
                    break
        if seed_index is None and seeds:
            # mapping がない合成入力では token を発音量に応じた累積範囲へ割り当てる。
            cursor = 0
            candidates: list[tuple[int, int]] = []
            for seed in seeds:
                mapping = mappings.get(seed.index) if mappings else None
                count = (
                    mapping.token_count
                    if mapping is not None
                    else len(seed.pronunciation.replace(" ", ""))
                )
                if count <= 0:
                    continue
                candidates.append((seed.index, count))
            for candidate_index, count in candidates:
                if cursor <= token_position < cursor + count:
                    seed_index = candidate_index
                    break
                cursor += count
            if seed_index is None and candidates:
                seed_index = candidates[-1][0]
        if seed_index in assignments:
            assignments[seed_index].append(token)
    return assignments


def _proportional_bounds(start: float, end: float, weights: Sequence[float]) -> list[tuple[float, float]]:
    if end <= start or not weights:
        return []
    total = sum(weights) or float(len(weights))
    cursor = start
    output: list[tuple[float, float]] = []
    for position, weight in enumerate(weights):
        next_cursor = end if position == len(weights) - 1 else cursor + (end - start) * max(0.0, weight) / total
        output.append((cursor, next_cursor))
        cursor = next_cursor
    return output


def _interpolate_missing_bounds(
    seeds: Sequence[DisplayElementSeed],
    known: Mapping[int, tuple[float, float]],
    weights: Sequence[float],
    line_start: float,
    line_end: float,
) -> dict[int, tuple[float, float]]:
    output = dict(known)
    if not seeds:
        return output

    def assign_bounds(first: int, last: int, start: float, end: float) -> bool:
        if end <= start:
            return False
        segment = _proportional_bounds(start, end, weights[first : last + 1])
        if len(segment) != last - first + 1:
            return False
        for seed_position, bounds in zip(range(first, last + 1), segment):
            output[seeds[seed_position].index] = bounds
        return True

    missing_positions = [position for position, seed in enumerate(seeds) if seed.index not in known]
    position = 0
    while position < len(missing_positions):
        first_position = missing_positions[position]
        last_position = first_position
        while position + 1 < len(missing_positions) and missing_positions[position + 1] == last_position + 1:
            position += 1
            last_position = missing_positions[position]
        left_bound = line_start
        if first_position > 0:
            left_seed = seeds[first_position - 1]
            left_bound = output.get(left_seed.index, (line_start, line_start))[1]
        right_bound = line_end
        if last_position + 1 < len(seeds):
            right_seed = seeds[last_position + 1]
            right_bound = output.get(right_seed.index, (line_end, line_end))[0]

        gap_start = min(left_bound, right_bound)
        gap_end = max(left_bound, right_bound)
        missing_count = last_position - first_position + 1
        if gap_end - gap_start < _MIN_ELEMENT_DURATION * missing_count:
            # 隣接CTC spanでは空白の割当て区間がゼロ幅になる。直接の前後
            # anchorを含む局所範囲を、既存のseed重みで再partitionして、anchor
            # 自体の境界も一緒に動かす。
            local_first = first_position - 1 if first_position > 0 else first_position
            local_last = last_position + 1 if last_position + 1 < len(seeds) else last_position
            local_start = (
                output[seeds[local_first].index][0]
                if seeds[local_first].index in output
                else line_start
            )
            local_end = (
                output[seeds[local_last].index][1]
                if seeds[local_last].index in output
                else line_end
            )
            assign_bounds(local_first, local_last, local_start, local_end)
        else:
            assign_bounds(first_position, last_position, gap_start, gap_end)
        position += 1
    return output


def _to_partition(
    elements: Sequence[DisplayElement],
    *,
    line_start: float,
    line_end: float,
    line_id: str | int | None,
    parent_revision: int,
) -> tuple[DisplayElement, ...]:
    """要素の間へ blank を挿入し、行全体を連続 partition にする。"""

    if line_end <= line_start:
        return ()
    ordered = sorted(elements, key=lambda element: (element.start, element.index))
    output: list[DisplayElement] = []
    cursor = line_start
    blank_index = 0
    for element in ordered:
        start = max(line_start, min(line_end, element.start))
        end = max(line_start, min(line_end, element.end))
        if end <= start:
            continue
        if start > cursor + 1e-9:
            stable_id = stable_display_element_id(
                line_id,
                100000 + blank_index,
                "",
                0,
                0,
                origin_key=f"blank:{line_id!s}:{blank_index}:{cursor:.9f}:{start:.9f}",
            )
            output.append(
                DisplayElement(
                    index=100000 + blank_index,
                    text="",
                    start=cursor,
                    end=start,
                    confidence=1.0,
                    source="blank",
                    stable_id=stable_id,
                    origin_key=f"blank:{line_id!s}:{blank_index}",
                    parent_revision=parent_revision,
                )
            )
            blank_index += 1
        start = max(cursor, start)
        if end <= start:
            continue
        output.append(replace(element, start=start, end=end, parent_revision=parent_revision))
        cursor = end
    if cursor < line_end - 1e-9:
        stable_id = stable_display_element_id(
            line_id,
            100000 + blank_index,
            "",
            0,
            0,
            origin_key=f"blank:{line_id!s}:{blank_index}:{cursor:.9f}:{line_end:.9f}",
        )
        output.append(
            DisplayElement(
                index=100000 + blank_index,
                text="",
                start=cursor,
                end=line_end,
                confidence=1.0,
                source="blank",
                stable_id=stable_id,
                origin_key=f"blank:{line_id!s}:{blank_index}",
                parent_revision=parent_revision,
            )
        )
    return tuple(output)


def align_display_elements(
    seeds: Sequence[DisplayElementSeed],
    tokens: Sequence[CtcTokenSpan],
    *,
    line_start: float,
    line_end: float,
    mappings: Sequence[DisplayElementTokenMapping] | None = None,
    line_id: str | int | None = None,
    parent_revision: int = 0,
    start_locked: bool = False,
    end_locked: bool = False,
    next_anchor: float | None = None,
    next_anchor_candidate: float | None = None,
    observed_star_ratio: float | None = None,
    window_start: float | None = None,
    window_end: float | None = None,
    blank_intervals: Sequence[tuple[float, float]] = (),
) -> DisplayAlignmentResult:
    """固定された歌詞行境界の内側へ CTC token を逆写像する。

    token が全体品質を満たす場合は ``mms-ctc``、一部表示素の token が欠落した
    場合は token 数重み補間の ``mms-ctc-interpolated``、行全体が不採用の場合は
    ``line-proportional`` を使用する。本文中の空白文字は本文を保持する表示素として
    内挿し、音声由来の空白区間だけを ``text == ""`` の blank 要素として補う。
    どの経路でも正時間長要素だけを返し、beat snap や隣接行の変更は行わない。
    """

    seed_list = tuple(seeds)
    if line_end <= line_start:
        diagnostics = DisplayAlignmentDiagnostics(rejection_reasons=("line_range",))
        return DisplayAlignmentResult((), diagnostics, "line-proportional", parent_revision)
    mapping_by_seed = {mapping.seed_index: mapping for mapping in (mappings or ())}
    expected = sum(max(0, mapping.token_count) for mapping in mapping_by_seed.values())
    if expected <= 0:
        expected = sum(len(seed.pronunciation.replace(" ", "")) for seed in seed_list)
    diagnostics = evaluate_display_alignment_quality(
        tokens,
        expected_token_count=expected,
        window_start=window_start,
        window_end=window_end,
        next_anchor=next_anchor,
        next_anchor_candidate=next_anchor_candidate,
        observed_star_ratio=observed_star_ratio,
    )
    assignments = _token_seed_assignments(seed_list, tokens, mapping_by_seed or None)
    quality_usable = diagnostics.accepted
    if diagnostics.isolated_first_token:
        # 探索窓先頭へ吸着した token は表示素の開始根拠から除外する。ほかの
        # token が品質条件を満たす場合は行全体を捨てず、欠落した要素だけを
        # token 数重みで補間する。診断には isolated_first_token を残す。
        ordered_valid = sorted(
            (token for token in tokens if not token.is_star and token.end > token.start),
            key=lambda token: token.token_index,
        )
        if len(ordered_valid) >= 2:
            first_token = ordered_valid[0]
            for seed_index, seed_tokens in assignments.items():
                assignments[seed_index] = [
                    token for token in seed_tokens if token.token_index != first_token.token_index
                ]
            remaining_tokens = [token for token in tokens if token.token_index != first_token.token_index]
            remaining_diagnostics = evaluate_display_alignment_quality(
                remaining_tokens,
                expected_token_count=expected,
                window_start=window_start,
                window_end=window_end,
                next_anchor=next_anchor,
                next_anchor_candidate=next_anchor_candidate,
                observed_star_ratio=observed_star_ratio,
            )
            quality_usable = remaining_diagnostics.accepted
    known: dict[int, tuple[float, float]] = {}
    token_bounds: dict[int, tuple[int, int]] = {}
    boundary_conflict = diagnostics.boundary_conflict
    overflow_before = diagnostics.overflow_before
    overflow_after = diagnostics.overflow_after
    for seed in seed_list:
        valid = [token for token in assignments.get(seed.index, ()) if token.end > token.start and not token.is_star]
        if not valid:
            mapping = mapping_by_seed.get(seed.index)
            if mapping is not None:
                token_bounds[seed.index] = (mapping.token_start, mapping.token_end)
            continue
        raw_start = min(token.start for token in valid)
        raw_end = max(token.end for token in valid)
        overflow_before = max(overflow_before, max(0.0, line_start - raw_start))
        overflow_after = max(overflow_after, max(0.0, raw_end - line_end))
        boundary_conflict = boundary_conflict or raw_start < line_start or raw_end > line_end
        start = max(line_start, min(line_end, raw_start))
        end = max(line_start, min(line_end, raw_end))
        if end <= start:
            continue
        known[seed.index] = (start, end)
        token_bounds[seed.index] = (min(token.token_index for token in valid), max(token.token_index for token in valid) + 1)

    diagnostics = replace(
        diagnostics,
        boundary_conflict=boundary_conflict,
        overflow_before=overflow_before,
        overflow_after=overflow_after,
    )
    weights = _seed_weights(seed_list, mapping_by_seed or None)
    source = "mms-ctc"
    if not quality_usable:
        bounds = dict(zip((seed.index for seed in seed_list), _proportional_bounds(line_start, line_end, weights)))
        source = "line-proportional"
        known = bounds
        token_bounds = {}
    else:
        missing = any(seed.index not in known for seed in seed_list)
        if missing:
            source = "mms-ctc-interpolated"
            known = _interpolate_missing_bounds(seed_list, known, weights, line_start, line_end)

        # CTC states are sparse onset evidence. Their final frame must not
        # create an empty display element after every phoneme: a display
        # element normally continues until the next onset. Only a VAD-confirmed
        # positive silence is left as a blank interval.
        element_starts = {
            seed.index: known[seed.index][0]
            for seed in seed_list
            if seed.index in known
        }
        silence = sorted(
            (
                (max(line_start, float(start)), min(line_end, float(end)))
                for start, end in blank_intervals
                if math.isfinite(start) and math.isfinite(end) and end - start >= 0.12
            ),
            key=lambda item: item[0],
        )
        # A sokuon is a real element whose onset is the closure start. CTC emits
        # the repeated consonant near the closure end, so move it to the
        # preceding silence rather than turning the closure into a blank.
        for position, seed in enumerate(seed_list):
            if not seed.text or seed.text[0] not in _SOKUON or seed.index not in element_starts:
                continue
            onset = element_starts[seed.index]
            candidate = next(
                (
                    interval
                    for interval in reversed(silence)
                    if interval[0] < onset and interval[1] >= onset - 0.08
                ),
                None,
            )
            if candidate is not None:
                previous_start = (
                    element_starts.get(seed_list[position - 1].index, line_start)
                    if position > 0
                    else line_start
                )
                element_starts[seed.index] = max(previous_start, candidate[0])

        onset_bounds: dict[int, tuple[float, float]] = {}
        for position, seed in enumerate(seed_list):
            start = element_starts.get(seed.index)
            if start is None:
                continue
            if position == 0 and start - line_start <= 0.02:
                # CTC spans are millisecond-rounded. Do not serialize a
                # sub-frame leading blank caused only by that rounding.
                start = line_start
            next_start = line_end
            for next_seed in seed_list[position + 1 :]:
                if next_seed.index in element_starts:
                    next_start = element_starts[next_seed.index]
                    break
            end = max(start, next_start)
            next_seed = seed_list[position + 1] if position + 1 < len(seed_list) else None
            if next_seed is not None and next_seed.text[:1] not in _SOKUON:
                evidence_end = known[seed.index][1]
                pause = next(
                    (
                        interval
                        for interval in silence
                        if interval[0] >= evidence_end - 0.06
                        and interval[0] > start + 0.04
                        and interval[1] <= next_start + 0.10
                    ),
                    None,
                )
                if pause is not None:
                    end = min(end, pause[0])
            if end > start:
                onset_bounds[seed.index] = (start, end)
        known = onset_bounds

    generated: list[DisplayElement] = []
    for seed_position, seed in enumerate(seed_list):
        bounds = known.get(seed.index)
        if bounds is None:
            continue
        start, end = bounds
        if end <= start:
            continue
        token_start, token_end = token_bounds.get(seed.index, (seed.token_start, seed.token_end))
        confidence = 1.0 if source == "line-proportional" else (
            statistics.median([token.confidence for token in assignments.get(seed.index, ()) if token.end > token.start])
            if assignments.get(seed.index)
            else 0.0
        )
        generated.append(
            DisplayElement(
                index=seed.index,
                text=seed.text,
                start=start,
                end=end,
                confidence=max(0.0, min(1.0, float(confidence))),
                source=source if seed.index in known else "mms-ctc-interpolated",
                source_start=seed.source_start,
                source_end=seed.source_end,
                pronunciation=seed.pronunciation,
                token_start=token_start,
                token_end=token_end,
                origin_key=seed.origin_key,
                stable_id=seed.stable_id or stable_display_element_id(line_id, seed.index, seed.text, seed.source_start, seed.source_end, origin_key=seed.origin_key or None),
                manual_start=start_locked,
                manual_end=end_locked,
                parent_revision=parent_revision,
                conflict="boundary_conflict" if boundary_conflict else None,
            )
        )
    partition = _to_partition(
        generated,
        line_start=line_start,
        line_end=line_end,
        line_id=line_id,
        parent_revision=parent_revision,
    )
    return DisplayAlignmentResult(tuple(partition), diagnostics, source, parent_revision)


def align_line_display_elements(*args, **kwargs) -> DisplayAlignmentResult:
    """``align_display_elements`` の行単位 API 別名。"""

    return align_display_elements(*args, **kwargs)


__all__ = [
    "AlignedDisplayElement",
    "CtcTokenSpan",
    "DisplayAlignmentDiagnostics",
    "DisplayAlignmentResult",
    "DisplayElement",
    "DisplayElementSeed",
    "DisplayElementTokenMapping",
    "ElementAlignmentDiagnostics",
    "align_display_elements",
    "align_line_display_elements",
    "attach_token_ranges",
    "build_display_element_seeds",
    "evaluate_display_alignment_quality",
    "map_pronunciation_to_tokens",
    "map_seed_pronunciation_to_tokens",
    "quality_gate",
    "split_display_elements",
    "stable_display_element_id",
]
