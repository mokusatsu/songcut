export type SegmentSelectionModifiers = {
  additive: boolean;
  range: boolean;
};

export type SegmentSelectionResult = {
  selectedIds: Set<string>;
  primaryId: string | null;
};

/** Pointer／mouse eventのmodifierを、mode共通の選択操作へ変換する。 */
export function segmentSelectionModifiers(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): SegmentSelectionModifiers {
  return {
    additive: event.ctrlKey || event.metaKey,
    range: event.shiftKey,
  };
}

/** 単一、追加解除、範囲選択を同じprimary／選択集合契約で解決する。 */
export function resolveSegmentSelection(input: {
  orderedIds: readonly string[];
  selectedIds: ReadonlySet<string>;
  primaryId: string | null;
  targetId: string;
  modifiers?: SegmentSelectionModifiers;
}): SegmentSelectionResult {
  const orderedIds = [...new Set(input.orderedIds)];
  const validIds = new Set(orderedIds);
  if (!validIds.has(input.targetId)) {
    return {
      selectedIds: new Set([...input.selectedIds].filter((id) => validIds.has(id))),
      primaryId: input.primaryId && validIds.has(input.primaryId) ? input.primaryId : null,
    };
  }

  const modifiers = input.modifiers ?? { additive: false, range: false };
  const current = new Set([...input.selectedIds].filter((id) => validIds.has(id)));
  const anchorIndex = input.primaryId ? orderedIds.indexOf(input.primaryId) : -1;
  const targetIndex = orderedIds.indexOf(input.targetId);

  if (modifiers.range && anchorIndex >= 0) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const selectedIds = modifiers.additive ? current : new Set<string>();
    for (const id of orderedIds.slice(start, end + 1)) selectedIds.add(id);
    return { selectedIds, primaryId: input.targetId };
  }

  if (modifiers.additive) {
    if (current.has(input.targetId)) current.delete(input.targetId);
    else current.add(input.targetId);
    const primaryId = current.has(input.targetId)
      ? input.targetId
      : input.primaryId && current.has(input.primaryId)
        ? input.primaryId
        : orderedIds.find((id) => current.has(id)) ?? null;
    return { selectedIds: current, primaryId };
  }

  return { selectedIds: new Set([input.targetId]), primaryId: input.targetId };
}

/** 削除やproject更新後に、存在するIDとprimaryだけから選択集合を再構築する。 */
export function reconcileSegmentSelection(input: {
  orderedIds: readonly string[];
  selectedIds: ReadonlySet<string>;
  primaryId: string | null;
}): SegmentSelectionResult {
  const validIds = new Set(input.orderedIds);
  if (!input.primaryId || !validIds.has(input.primaryId)) {
    return { selectedIds: new Set(), primaryId: null };
  }
  const selectedIds = new Set([...input.selectedIds].filter((id) => validIds.has(id)));
  selectedIds.add(input.primaryId);
  return { selectedIds, primaryId: input.primaryId };
}
