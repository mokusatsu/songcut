import type { DisplayElement, LyricsSegment } from "@/lib/subtitles";

export const DISPLAY_ELEMENT_MIN_DURATION_SECONDS = 0.001;
export const DISPLAY_ELEMENT_BLANK_DURATION_SECONDS = 0.100;
const DISPLAY_ELEMENT_EPSILON = 1e-6;

export type DisplayElementUpdate = {
  elements: DisplayElement[];
  revision: number;
  selectedId: string;
  boundaryLocked: true;
};

/**
 * 表示素編集による行境界ロックが現在有効かを返す。
 * 明示値のないschema v3文書は未ロックとして読み、manual属性とは混同しない。
 */
export function isDisplayElementBoundaryLocked(segment: LyricsSegment): boolean {
  return segment.display_element_boundary_locked === true;
}

/** ロック中でも、対象端にblankがあればその範囲を吸収する境界handleを許可する。 */
export function isDisplayElementLineBoundaryEditable(
  segment: LyricsSegment,
  edge: "start" | "end",
): boolean {
  if (!isDisplayElementBoundaryLocked(segment)) return true;
  const elements = segment.display_elements;
  if (!elements?.length || elements.every(isBlankElement)) return true;
  return isBlankElement(edge === "start" ? elements[0] : elements[elements.length - 1]);
}

/**
 * 行境界の確定変更に合わせて表示素partitionを再配置する。
 * ロック中は非blank要素を絶対時刻へ固定し、端の連続blankだけで差分を吸収する。
 * ロック解除中はmanual属性を保持したまま、全表示素を新しい行範囲へ比例再配置する。
 */
export function retimeDisplayElementsForLine(
  segment: LyricsSegment,
  lineStart: number,
  lineEnd: number,
): DisplayElement[] | null {
  const elements = elementsForEditing(segment);
  if (!elements) return segment.display_elements?.length ? null : [];
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd) || lineEnd <= lineStart) return null;

  const originalBoundaries = [elements[0].start, ...elements.map((element) => element.end)];
  const boundaries = [...originalBoundaries];
  const locked = isDisplayElementBoundaryLocked(segment);
  const allBlank = elements.every(isBlankElement);

  if (!locked || allBlank) {
    if (!redistributeBoundaryRange(elements, boundaries, 0, elements.length, lineStart, lineEnd)) return null;
  } else {
    let leadingBlankCount = 0;
    while (leadingBlankCount < elements.length && isBlankElement(elements[leadingBlankCount])) {
      leadingBlankCount += 1;
    }
    let trailingBlankStart = elements.length;
    while (trailingBlankStart > 0 && isBlankElement(elements[trailingBlankStart - 1])) {
      trailingBlankStart -= 1;
    }

    if (Math.abs(lineStart - originalBoundaries[0]) > DISPLAY_ELEMENT_EPSILON) {
      if (leadingBlankCount === 0 || !redistributeBoundaryRange(
        elements,
        boundaries,
        0,
        leadingBlankCount,
        lineStart,
        originalBoundaries[leadingBlankCount],
      )) return null;
    }
    if (Math.abs(lineEnd - originalBoundaries[elements.length]) > DISPLAY_ELEMENT_EPSILON) {
      if (trailingBlankStart === elements.length || !redistributeBoundaryRange(
        elements,
        boundaries,
        trailingBlankStart,
        elements.length,
        originalBoundaries[trailingBlankStart],
        lineEnd,
      )) return null;
    }
  }

  return elements.map((element, index) => ({
    ...element,
    start: boundaries[index],
    end: boundaries[index + 1],
  }));
}

/** 行境界dragのpreview中も、表示素partitionを候補行範囲へ追従させる。 */
export function retimeSegmentForLineBoundaryPreview(
  sourceSegment: LyricsSegment,
  previewSegment: LyricsSegment,
): LyricsSegment | null {
  if (!sourceSegment.display_elements?.length) return previewSegment;
  const displayElements = retimeDisplayElementsForLine(
    sourceSegment,
    previewSegment.start,
    previewSegment.end,
  );
  if (displayElements === null) return null;
  return {
    ...previewSegment,
    display_elements: displayElements,
  };
}

function elementsForEditing(segment: LyricsSegment): DisplayElement[] | null {
  const elements = segment.display_elements;
  if (!elements?.length) return null;
  let cursor = segment.start;
  const ids = new Set<string>();
  for (const element of elements) {
    if (
      !element.stable_id
      || ids.has(element.stable_id)
      || !Number.isFinite(element.start)
      || !Number.isFinite(element.end)
      || element.end - element.start < DISPLAY_ELEMENT_MIN_DURATION_SECONDS - DISPLAY_ELEMENT_EPSILON
      || Math.abs(element.start - cursor) > DISPLAY_ELEMENT_EPSILON
    ) return null;
    ids.add(element.stable_id);
    cursor = element.end;
  }
  if (Math.abs(cursor - segment.end) > DISPLAY_ELEMENT_EPSILON) return null;
  return elements.map((element) => ({ ...element }));
}

function isBlankElement(element: Pick<DisplayElement, "text">): boolean {
  return element.text.length === 0;
}

function redistributeBoundaryRange(
  elements: readonly DisplayElement[],
  boundaries: number[],
  fromIndex: number,
  toIndex: number,
  fromTime: number,
  toTime: number,
): boolean {
  const count = toIndex - fromIndex;
  const available = toTime - fromTime;
  if (count <= 0 || available < count * DISPLAY_ELEMENT_MIN_DURATION_SECONDS - DISPLAY_ELEMENT_EPSILON) {
    return false;
  }
  boundaries[fromIndex] = fromTime;
  boundaries[toIndex] = toTime;
  if (count === 1) return true;

  const weights = elements.slice(fromIndex, toIndex).map((element) => (
    Math.max(0, element.end - element.start - DISPLAY_ELEMENT_MIN_DURATION_SECONDS)
  ));
  const weightTotal = weights.reduce((total, value) => total + value, 0);
  const flexible = Math.max(0, available - count * DISPLAY_ELEMENT_MIN_DURATION_SECONDS);
  let cursor = fromTime;
  for (let offset = 0; offset < count - 1; offset += 1) {
    const share = weightTotal > DISPLAY_ELEMENT_EPSILON
      ? flexible * (weights[offset] / weightTotal)
      : flexible / count;
    cursor += DISPLAY_ELEMENT_MIN_DURATION_SECONDS + share;
    boundaries[fromIndex + offset + 1] = cursor;
  }
  return true;
}

function finalizeUpdate(
  segment: LyricsSegment,
  elements: DisplayElement[],
  selectedId: string,
): DisplayElementUpdate {
  const revision = (segment.display_element_revision ?? 0) + 1;
  return {
    elements: elements.map((element, index) => ({
      ...element,
      index,
      parent_revision: revision,
    })),
    revision,
    selectedId,
    boundaryLocked: true,
  };
}

/** 行内共有境界をpreviewする。左右要素を同時更新し、各要素を1ms以上に保つ。 */
export function previewDisplayElementBoundary(
  segment: LyricsSegment,
  boundaryIndex: number,
  proposedTime: number,
): DisplayElement[] | null {
  const elements = elementsForEditing(segment);
  if (!elements || boundaryIndex < 0 || boundaryIndex >= elements.length - 1 || !Number.isFinite(proposedTime)) {
    return null;
  }
  const left = elements[boundaryIndex];
  const right = elements[boundaryIndex + 1];
  const minimum = left.start + DISPLAY_ELEMENT_MIN_DURATION_SECONDS;
  const maximum = right.end - DISPLAY_ELEMENT_MIN_DURATION_SECONDS;
  if (maximum < minimum) return null;
  const boundary = Math.min(maximum, Math.max(minimum, proposedTime));
  elements[boundaryIndex] = { ...left, end: boundary, manual_end: true };
  elements[boundaryIndex + 1] = { ...right, start: boundary, manual_start: true };
  return elements;
}

/** pointer-up時だけ共有境界編集をrevision付きの保存値へ変換する。 */
export function commitDisplayElementBoundary(
  segment: LyricsSegment,
  boundaryIndex: number,
  proposedTime: number,
): DisplayElementUpdate | null {
  const original = elementsForEditing(segment);
  const preview = previewDisplayElementBoundary(segment, boundaryIndex, proposedTime);
  if (!original || !preview) return null;
  if (Math.abs(original[boundaryIndex].end - preview[boundaryIndex].end) <= DISPLAY_ELEMENT_EPSILON) return null;
  return finalizeUpdate(segment, preview, original[boundaryIndex].stable_id);
}

/** 選択要素を右隣と結合し、左stable IDを維持する。 */
export function mergeDisplayElementRight(
  segment: LyricsSegment,
  selectedId: string,
): DisplayElementUpdate | null {
  const elements = elementsForEditing(segment);
  if (!elements) return null;
  const index = elements.findIndex((element) => element.stable_id === selectedId);
  if (index < 0 || index >= elements.length - 1) return null;
  const left = elements[index];
  const right = elements[index + 1];
  const merged: DisplayElement = {
    ...left,
    text: `${left.text}${right.text}`,
    end: right.end,
    confidence: Math.min(left.confidence, right.confidence),
    source: "manual",
    source_start: Math.min(left.source_start, right.source_start),
    source_end: Math.max(left.source_end, right.source_end),
    pronunciation: `${left.pronunciation}${right.pronunciation}`,
    token_start: Math.min(left.token_start, right.token_start),
    token_end: Math.max(left.token_end, right.token_end),
    origin_key: `manual-merge:${left.stable_id}:${right.stable_id}`,
    manual_start: true,
    manual_end: true,
    manual_structure: true,
    conflict: left.conflict ?? right.conflict,
    orphaned_manual: left.orphaned_manual || right.orphaned_manual,
  };
  elements.splice(index, 2, merged);
  return finalizeUpdate(segment, elements, left.stable_id);
}

/** 選択要素末尾100msを切り出し、右側へmanual blankを追加する。 */
export function addBlankDisplayElementRight(
  segment: LyricsSegment,
  selectedId: string,
  createId: () => string = () => `manual-${globalThis.crypto.randomUUID()}`,
): DisplayElementUpdate | null {
  const elements = elementsForEditing(segment);
  if (!elements) return null;
  const index = elements.findIndex((element) => element.stable_id === selectedId);
  if (index < 0) return null;
  const selected = elements[index];
  if (
    selected.end - selected.start
      < DISPLAY_ELEMENT_BLANK_DURATION_SECONDS + DISPLAY_ELEMENT_MIN_DURATION_SECONDS - DISPLAY_ELEMENT_EPSILON
  ) return null;
  const stableId = createId().trim();
  if (!stableId || elements.some((element) => element.stable_id === stableId)) return null;
  const splitTime = selected.end - DISPLAY_ELEMENT_BLANK_DURATION_SECONDS;
  const blank: DisplayElement = {
    index: index + 1,
    stable_id: stableId,
    text: "",
    start: splitTime,
    end: selected.end,
    confidence: 1,
    source: "manual",
    source_start: selected.source_end,
    source_end: selected.source_end,
    pronunciation: "",
    token_start: selected.token_end,
    token_end: selected.token_end,
    origin_key: `manual-blank:${stableId}`,
    manual_start: true,
    manual_end: true,
    manual_structure: true,
    parent_revision: selected.parent_revision,
    conflict: null,
    orphaned_manual: false,
  };
  elements[index] = { ...selected, end: splitTime, manual_end: true };
  elements.splice(index + 1, 0, blank);
  return finalizeUpdate(segment, elements, stableId);
}

/** 選択要素先頭100msを切り出し、左側へmanual blankを追加する。 */
export function addBlankDisplayElementLeft(
  segment: LyricsSegment,
  selectedId: string,
  createId: () => string = () => `manual-${globalThis.crypto.randomUUID()}`,
): DisplayElementUpdate | null {
  const elements = elementsForEditing(segment);
  if (!elements) return null;
  const index = elements.findIndex((element) => element.stable_id === selectedId);
  if (index < 0) return null;
  const selected = elements[index];
  if (
    selected.end - selected.start
      < DISPLAY_ELEMENT_BLANK_DURATION_SECONDS + DISPLAY_ELEMENT_MIN_DURATION_SECONDS - DISPLAY_ELEMENT_EPSILON
  ) return null;
  const stableId = createId().trim();
  if (!stableId || elements.some((element) => element.stable_id === stableId)) return null;
  const splitTime = selected.start + DISPLAY_ELEMENT_BLANK_DURATION_SECONDS;
  const blank: DisplayElement = {
    index,
    stable_id: stableId,
    text: "",
    start: selected.start,
    end: splitTime,
    confidence: 1,
    source: "manual",
    source_start: selected.source_start,
    source_end: selected.source_start,
    pronunciation: "",
    token_start: selected.token_start,
    token_end: selected.token_start,
    origin_key: `manual-blank:${stableId}`,
    manual_start: true,
    manual_end: true,
    manual_structure: true,
    parent_revision: selected.parent_revision,
    conflict: null,
    orphaned_manual: false,
  };
  elements[index] = { ...selected, start: splitTime, manual_start: true };
  elements.splice(index, 0, blank);
  return finalizeUpdate(segment, elements, stableId);
}

/** 選択要素を削除し、隣接要素へ時間範囲を吸収させる。 */
export function deleteDisplayElement(
  segment: LyricsSegment,
  selectedId: string,
): DisplayElementUpdate | null {
  const elements = elementsForEditing(segment);
  if (!elements || elements.length <= 1) return null;
  const index = elements.findIndex((element) => element.stable_id === selectedId);
  if (index < 0) return null;
  const removed = elements[index];

  if (index < elements.length - 1) {
    const right = elements[index + 1];
    elements[index + 1] = {
      ...right,
      start: removed.start,
      source: "manual",
      manual_start: true,
      manual_structure: true,
      origin_key: `manual-delete:${removed.stable_id}:${right.stable_id}`,
    };
    if (index > 0) {
      elements[index - 1] = { ...elements[index - 1], manual_end: true };
    }
    elements.splice(index, 1);
    return finalizeUpdate(segment, elements, right.stable_id);
  }

  const left = elements[index - 1];
  elements[index - 1] = {
    ...left,
    end: removed.end,
    source: "manual",
    manual_end: true,
    manual_structure: true,
    origin_key: `manual-delete:${removed.stable_id}:${left.stable_id}`,
  };
  elements.splice(index, 1);
  return finalizeUpdate(segment, elements, left.stable_id);
}

/** 選択要素の本文をそのまま置換し、manual text編集として確定する。 */
export function editDisplayElementText(
  segment: LyricsSegment,
  selectedId: string,
  text: string,
): DisplayElementUpdate | null {
  const elements = elementsForEditing(segment);
  if (!elements) return null;
  const index = elements.findIndex((element) => element.stable_id === selectedId);
  if (index < 0) return null;
  const selected = elements[index];
  if (selected.text === text) return null;
  elements[index] = {
    ...selected,
    text,
    source: "manual",
    manual_structure: true,
    origin_key: `manual-text:${selected.stable_id}`,
  };
  return finalizeUpdate(segment, elements, selected.stable_id);
}

/** 再生時刻に対応する表示素を半開区間で求め、行末だけ終端を含める。 */
export function activeDisplayElementId(
  elements: readonly DisplayElement[],
  currentTime: number,
): string | null {
  if (!Number.isFinite(currentTime)) return null;
  const lastIndex = elements.length - 1;
  const active = elements.find((element, index) => (
    currentTime >= element.start - DISPLAY_ELEMENT_EPSILON
    && (
      currentTime < element.end - DISPLAY_ELEMENT_EPSILON
      || (index === lastIndex && currentTime <= element.end + DISPLAY_ELEMENT_EPSILON)
    )
  ));
  return active?.stable_id ?? null;
}

/** 行内絶対秒を0..100%へ正規化したstyle値へ変換する。 */
export function displayElementPercentRange(
  segment: Pick<LyricsSegment, "start" | "end">,
  element: Pick<DisplayElement, "start" | "end">,
): { left: number; width: number } {
  const duration = segment.end - segment.start;
  if (!(duration > 0)) return { left: 0, width: 0 };
  return {
    left: Math.max(0, Math.min(100, ((element.start - segment.start) / duration) * 100)),
    width: Math.max(0, Math.min(100, ((element.end - element.start) / duration) * 100)),
  };
}
