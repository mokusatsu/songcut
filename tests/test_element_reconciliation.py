from __future__ import annotations

import pytest

from songcut.element_reconciliation import ManualBoundaryConflict, reconcile_display_elements
from songcut.lyrics_elements import DisplayElement


def element(
    index: int,
    text: str,
    start: float,
    end: float,
    *,
    stable_id: str,
    source_start: int,
    source_end: int,
    manual_start: bool = False,
    manual_end: bool = False,
    manual_structure: bool = False,
    source: str = "mms-ctc",
) -> DisplayElement:
    return DisplayElement(
        index=index,
        text=text,
        start=start,
        end=end,
        confidence=0.9,
        source=source,
        source_start=source_start,
        source_end=source_end,
        pronunciation=text,
        token_start=source_start,
        token_end=source_end,
        origin_key=f"line:{source_start}:{source_end}",
        stable_id=stable_id,
        manual_start=manual_start,
        manual_end=manual_end,
        manual_structure=manual_structure,
        parent_revision=2,
    )


def assert_partition(elements: tuple[DisplayElement, ...], start: float = 0, end: float = 3) -> None:
    assert elements[0].start == pytest.approx(start)
    assert elements[-1].end == pytest.approx(end)
    assert all(item.duration >= 0.001 - 1e-6 for item in elements)
    assert all(left.end == pytest.approx(right.start) for left, right in zip(elements, elements[1:]))


def test_no_manual_elements_uses_generated_partition() -> None:
    generated = (
        element(0, "あ", 0, 1.5, stable_id="new-a", source_start=0, source_end=1),
        element(1, "い", 1.5, 3, stable_id="new-i", source_start=1, source_end=2),
    )
    result = reconcile_display_elements(
        line_id="line", old_text="あい", new_text="あい", existing=(), generated=generated,
        line_start=0, line_end=3, parent_revision=4,
    )
    assert [item.stable_id for item in result.elements] == ["new-a", "new-i"]
    assert all(item.parent_revision == 4 for item in result.elements)
    assert_partition(result.elements)


def test_grapheme_lcs_preserves_manual_boundary_and_stable_id_after_insertion() -> None:
    existing = (
        element(0, "あ", 0, 1, stable_id="old-a", source_start=0, source_end=1, manual_end=True),
        element(1, "い", 1, 3, stable_id="old-i", source_start=1, source_end=2, manual_start=True),
    )
    generated = (
        element(0, "う", 0, 0.5, stable_id="new-u", source_start=0, source_end=1),
        element(1, "あ", 0.5, 1.5, stable_id="new-a", source_start=1, source_end=2),
        element(2, "い", 1.5, 3, stable_id="new-i", source_start=2, source_end=3),
    )
    result = reconcile_display_elements(
        line_id="line", old_text="あい", new_text="うあい", existing=existing, generated=generated,
        line_start=0, line_end=3, parent_revision=5,
    )
    preserved = {item.stable_id: item for item in result.elements}
    assert preserved["old-a"].end == pytest.approx(1)
    assert preserved["old-i"].start == pytest.approx(1)
    assert set(result.preserved_manual_element_ids) == {"old-a", "old-i"}
    assert_partition(result.elements)


def test_manual_merge_and_blank_survive_reanalysis() -> None:
    existing = (
        element(0, "あい", 0, 2.5, stable_id="merged", source_start=0, source_end=2,
                manual_start=True, manual_end=True, manual_structure=True, source="manual"),
        element(1, "", 2.5, 3, stable_id="blank", source_start=2, source_end=2,
                manual_start=True, manual_end=True, manual_structure=True, source="manual"),
    )
    generated = (
        element(0, "あ", 0, 1, stable_id="new-a", source_start=0, source_end=1),
        element(1, "い", 1, 3, stable_id="new-i", source_start=1, source_end=2),
    )
    result = reconcile_display_elements(
        line_id="line", old_text="あい", new_text="あい", existing=existing, generated=generated,
        line_start=0, line_end=3, parent_revision=6,
    )
    assert [item.stable_id for item in result.elements] == ["merged", "blank"]
    assert [item.text for item in result.elements] == ["あい", ""]
    assert_partition(result.elements)


def test_deleted_manual_text_is_kept_as_orphaned_conflict() -> None:
    existing = (
        element(0, "あ", 0, 1.5, stable_id="manual-a", source_start=0, source_end=1,
                manual_start=True, manual_end=True, manual_structure=True, source="manual"),
        element(1, "い", 1.5, 3, stable_id="old-i", source_start=1, source_end=2),
    )
    generated = (element(0, "い", 0, 3, stable_id="new-i", source_start=0, source_end=1),)
    result = reconcile_display_elements(
        line_id="line", old_text="あい", new_text="い", existing=existing, generated=generated,
        line_start=0, line_end=3, parent_revision=7,
    )
    orphan = next(item for item in result.elements if item.stable_id == "manual-a")
    assert orphan.text == "あ"
    assert orphan.orphaned_manual is True
    assert orphan.conflict == "text_conflict"
    assert result.orphaned_manual_element_ids == ("manual-a",)
    assert_partition(result.elements)


def test_new_line_boundary_cannot_exclude_manual_element() -> None:
    existing = (
        element(0, "あ", 0, 2, stable_id="manual", source_start=0, source_end=1,
                manual_start=True, manual_end=True, manual_structure=True, source="manual"),
    )
    with pytest.raises(ManualBoundaryConflict, match="does not contain"):
        reconcile_display_elements(
            line_id="line", old_text="あ", new_text="あ", existing=existing, generated=existing,
            line_start=0.5, line_end=2, parent_revision=3,
        )
