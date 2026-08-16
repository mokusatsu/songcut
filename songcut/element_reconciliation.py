from __future__ import annotations

import unicodedata
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from typing import Sequence

from .lyrics_elements import DisplayElement, split_display_elements, stable_display_element_id


MIN_ELEMENT_DURATION = 0.001
EPSILON = 1e-6


class ManualBoundaryConflict(ValueError):
    """新しい行範囲または他の手動要素とmanual境界が両立しない。"""


@dataclass(frozen=True)
class DisplayElementReconciliation:
    """自動再解析と既存manual表示素を統合した監査可能な結果。"""

    elements: tuple[DisplayElement, ...]
    preserved_manual_element_ids: tuple[str, ...] = ()
    orphaned_manual_element_ids: tuple[str, ...] = ()
    dropped_auto_element_ids: tuple[str, ...] = ()
    reconciliation_conflicts: tuple[str, ...] = ()


def _manual(element: DisplayElement) -> bool:
    return bool(
        element.source == "manual"
        or element.manual_start
        or element.manual_end
        or element.manual_structure
        or element.orphaned_manual
    )


def _canonical(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


def _graphemes(text: str):
    return split_display_elements(
        text,
        language="jpn",
        romanize=lambda value, _language: "x" if value else "",
    )


def _lcs_source_range(old_text: str, new_text: str, element: DisplayElement) -> tuple[int, int] | None:
    old_seeds = _graphemes(old_text)
    new_seeds = _graphemes(new_text)
    old_indexes = [
        index
        for index, seed in enumerate(old_seeds)
        if seed.source_start >= element.source_start and seed.source_end <= element.source_end
    ]
    if not old_indexes:
        return None
    matcher = SequenceMatcher(
        None,
        [_canonical(seed.text) for seed in old_seeds],
        [_canonical(seed.text) for seed in new_seeds],
        autojunk=False,
    )
    mapping: dict[int, int] = {}
    for old_start, new_start, size in matcher.get_matching_blocks():
        for offset in range(size):
            mapping[old_start + offset] = new_start + offset
    mapped = [mapping.get(index) for index in old_indexes]
    if any(index is None for index in mapped):
        return None
    new_indexes = [int(index) for index in mapped if index is not None]
    if new_indexes != list(range(new_indexes[0], new_indexes[0] + len(new_indexes))):
        return None
    return new_seeds[new_indexes[0]].source_start, new_seeds[new_indexes[-1]].source_end


def _matching_generated_index(
    old_text: str,
    new_text: str,
    manual: DisplayElement,
    generated: Sequence[DisplayElement],
    used: set[int],
) -> int | None:
    for index, candidate in enumerate(generated):
        if (
            index not in used
            and manual.origin_key
            and candidate.origin_key == manual.origin_key
            and _canonical(candidate.text) == _canonical(manual.text)
        ):
            return index
    mapped_range = _lcs_source_range(old_text, new_text, manual)
    if mapped_range is None:
        return None
    for index, candidate in enumerate(generated):
        if index in used:
            continue
        if (candidate.source_start, candidate.source_end) == mapped_range:
            return index
    return None


def _matching_generated_span_indexes(
    old_text: str,
    new_text: str,
    manual: DisplayElement,
    generated: Sequence[DisplayElement],
    used: set[int],
) -> tuple[int, ...]:
    """手動マージ範囲を連続する複数の新しいseedへ対応付ける。"""

    mapped_range = _lcs_source_range(old_text, new_text, manual)
    if mapped_range is None:
        return ()
    source_start, source_end = mapped_range
    candidates = [
        (index, candidate)
        for index, candidate in enumerate(generated)
        if index not in used
        and candidate.source_start >= source_start
        and candidate.source_end <= source_end
        and candidate.source_end > candidate.source_start
    ]
    if not candidates:
        return ()
    candidates.sort(key=lambda item: item[0])
    if candidates[0][1].source_start != source_start or candidates[-1][1].source_end != source_end:
        return ()
    if any(left[1].source_end != right[1].source_start for left, right in zip(candidates, candidates[1:])):
        return ()
    return tuple(index for index, _candidate in candidates)


def _partition_elements(
    elements: Sequence[DisplayElement],
    *,
    line_id: str,
    line_start: float,
    line_end: float,
    parent_revision: int,
) -> tuple[DisplayElement, ...]:
    working = sorted(elements, key=lambda item: (item.start, item.end, item.index))
    if not working:
        return (
            DisplayElement(
                index=0,
                text="",
                start=line_start,
                end=line_end,
                confidence=0.0,
                source="line-proportional",
                stable_id=stable_display_element_id(line_id, 0, "", 0, 0, origin_key="blank:empty"),
                origin_key="blank:empty",
                parent_revision=parent_revision,
            ),
        )

    while True:
        changed = False
        first = working[0]
        if first.manual_start or first.manual_structure:
            if abs(first.start - line_start) > EPSILON:
                if first.start > line_start + MIN_ELEMENT_DURATION:
                    working.insert(0, DisplayElement(
                        index=-1,
                        text="",
                        start=line_start,
                        end=first.start,
                        confidence=0.0,
                        source="line-proportional",
                        stable_id=stable_display_element_id(line_id, -1, "", 0, 0, origin_key="blank:leading"),
                        origin_key="blank:leading",
                        parent_revision=parent_revision,
                    ))
                else:
                    raise ManualBoundaryConflict("manual start lies outside the lyric line")
        else:
            working[0] = replace(first, start=line_start)
        last = working[-1]
        if last.manual_end or last.manual_structure:
            if abs(last.end - line_end) > EPSILON:
                if last.end < line_end - MIN_ELEMENT_DURATION:
                    working.append(DisplayElement(
                        index=len(working),
                        text="",
                        start=last.end,
                        end=line_end,
                        confidence=0.0,
                        source="line-proportional",
                        stable_id=stable_display_element_id(line_id, len(working), "", 0, 0, origin_key="blank:trailing"),
                        origin_key="blank:trailing",
                        parent_revision=parent_revision,
                    ))
                else:
                    raise ManualBoundaryConflict("manual end lies outside the lyric line")
        else:
            working[-1] = replace(last, end=line_end)

        for index in range(len(working) - 1):
            left = working[index]
            right = working[index + 1]
            left_fixed = left.manual_end or left.manual_structure
            right_fixed = right.manual_start or right.manual_structure
            if left_fixed and right_fixed:
                if left.end > right.start + EPSILON:
                    raise ManualBoundaryConflict("manual display elements overlap")
                if right.start - left.end >= MIN_ELEMENT_DURATION:
                    working.insert(index + 1, DisplayElement(
                        index=-1,
                        text="",
                        start=left.end,
                        end=right.start,
                        confidence=0.0,
                        source="line-proportional",
                        stable_id=stable_display_element_id(
                            line_id,
                            index,
                            "",
                            0,
                            0,
                            origin_key=f"blank:manual-gap:{index}",
                        ),
                        origin_key=f"blank:manual-gap:{index}",
                        parent_revision=parent_revision,
                    ))
                    changed = True
                    break
                boundary = (left.end + right.start) / 2
            elif left_fixed:
                boundary = left.end
            elif right_fixed:
                boundary = right.start
            else:
                boundary = (left.end + right.start) / 2
            if not left_fixed:
                left = replace(left, end=boundary)
                working[index] = left
            if not right_fixed:
                right = replace(right, start=boundary)
                working[index + 1] = right
            if left.duration < MIN_ELEMENT_DURATION - EPSILON:
                if _manual(left):
                    raise ManualBoundaryConflict("manual display element became shorter than 1ms")
                working.pop(index)
                changed = True
                break
            if right.duration < MIN_ELEMENT_DURATION - EPSILON:
                if _manual(right):
                    raise ManualBoundaryConflict("manual display element became shorter than 1ms")
                working.pop(index + 1)
                changed = True
                break
        if not changed:
            break

    return tuple(replace(element, index=index) for index, element in enumerate(working))


def reconcile_display_elements(
    *,
    line_id: str,
    old_text: str,
    new_text: str,
    existing: Sequence[DisplayElement],
    generated: Sequence[DisplayElement],
    line_start: float,
    line_end: float,
    parent_revision: int,
) -> DisplayElementReconciliation:
    """grapheme LCSでmanual表示素を対応付け、自動結果へ非破壊統合する。"""

    if line_end - line_start < MIN_ELEMENT_DURATION:
        raise ValueError("lyric line must be at least 1ms long")
    manual_elements = [element for element in existing if _manual(element)]
    for element in manual_elements:
        if element.start < line_start - EPSILON or element.end > line_end + EPSILON:
            raise ManualBoundaryConflict("new lyric line does not contain a manual display element")
        if element.duration < MIN_ELEMENT_DURATION - EPSILON:
            raise ManualBoundaryConflict("manual display element must have positive duration")
    if not manual_elements:
        partition = _partition_elements(
            [replace(element, parent_revision=parent_revision) for element in generated],
            line_id=line_id,
            line_start=line_start,
            line_end=line_end,
            parent_revision=parent_revision,
        )
        return DisplayElementReconciliation(elements=partition)

    working = [replace(element, parent_revision=parent_revision) for element in generated]
    used: set[int] = set()
    preserved: list[str] = []
    orphaned: list[str] = []
    conflicts: list[str] = []
    dropped: list[str] = []
    insertions: list[DisplayElement] = []
    for manual in manual_elements:
        matched_index = None if manual.text == "" else _matching_generated_index(
            old_text,
            new_text,
            manual,
            working,
            used,
        )
        if matched_index is None and manual.manual_structure:
            matched_span = _matching_generated_span_indexes(
                old_text,
                new_text,
                manual,
                working,
                used,
            )
            if matched_span:
                removed = set(matched_span)
                for index in reversed(matched_span):
                    dropped.append(working[index].stable_id)
                    working.pop(index)
                used = {
                    index - sum(removed_index < index for removed_index in removed)
                    for index in used
                    if index not in removed
                }
                preserved.append(manual.stable_id)
                insertions.append(manual)
                continue
        preserved.append(manual.stable_id)
        if matched_index is not None and not manual.manual_structure:
            candidate = working[matched_index]
            used.add(matched_index)
            working[matched_index] = replace(
                candidate,
                stable_id=manual.stable_id,
                start=manual.start if manual.manual_start else candidate.start,
                end=manual.end if manual.manual_end else candidate.end,
                manual_start=manual.manual_start,
                manual_end=manual.manual_end,
                manual_structure=False,
                parent_revision=manual.parent_revision,
                conflict=manual.conflict,
                orphaned_manual=manual.orphaned_manual,
            )
            continue
        if matched_index is not None:
            dropped.append(working[matched_index].stable_id)
            working.pop(matched_index)
            used = {index - 1 if index > matched_index else index for index in used if index != matched_index}
            insertions.append(manual)
            continue
        orphaned.append(manual.stable_id)
        conflict = "orphaned_manual" if manual.text == "" else "text_conflict"
        conflicts.append(f"{manual.stable_id}:{conflict}")
        insertions.append(replace(manual, conflict=conflict, orphaned_manual=True))

    structural_intervals = [
        element for element in insertions if element.manual_structure or element.orphaned_manual or element.source == "manual"
    ]
    kept: list[DisplayElement] = []
    for candidate in working:
        center = (candidate.start + candidate.end) / 2
        if any(item.start - EPSILON <= center <= item.end + EPSILON for item in structural_intervals):
            dropped.append(candidate.stable_id)
        else:
            kept.append(candidate)
    partition = _partition_elements(
        [*kept, *insertions],
        line_id=line_id,
        line_start=line_start,
        line_end=line_end,
        parent_revision=parent_revision,
    )
    return DisplayElementReconciliation(
        elements=partition,
        preserved_manual_element_ids=tuple(dict.fromkeys(preserved)),
        orphaned_manual_element_ids=tuple(dict.fromkeys(orphaned)),
        dropped_auto_element_ids=tuple(dict.fromkeys(dropped)),
        reconciliation_conflicts=tuple(dict.fromkeys(conflicts)),
    )
