import { describe, expect, it } from "vitest";

import {
  reconcileSegmentSelection,
  resolveSegmentSelection,
  segmentSelectionModifiers,
} from "./segmentSelection";

const orderedIds = ["a", "b", "c", "d"];

describe("segment selection", () => {
  it("uses a normal click as an exclusive primary selection", () => {
    const result = resolveSegmentSelection({
      orderedIds,
      selectedIds: new Set(["a", "b"]),
      primaryId: "b",
      targetId: "c",
    });
    expect([...result.selectedIds]).toEqual(["c"]);
    expect(result.primaryId).toBe("c");
  });

  it("toggles with Ctrl/Cmd and keeps a valid primary", () => {
    const added = resolveSegmentSelection({
      orderedIds,
      selectedIds: new Set(["a"]),
      primaryId: "a",
      targetId: "c",
      modifiers: { additive: true, range: false },
    });
    expect([...added.selectedIds]).toEqual(["a", "c"]);
    expect(added.primaryId).toBe("c");

    const removed = resolveSegmentSelection({
      orderedIds,
      selectedIds: added.selectedIds,
      primaryId: added.primaryId,
      targetId: "c",
      modifiers: { additive: true, range: false },
    });
    expect([...removed.selectedIds]).toEqual(["a"]);
    expect(removed.primaryId).toBe("a");
  });

  it("selects an inclusive Shift range and supports additive ranges", () => {
    const replaced = resolveSegmentSelection({
      orderedIds,
      selectedIds: new Set(["a"]),
      primaryId: "b",
      targetId: "d",
      modifiers: { additive: false, range: true },
    });
    expect([...replaced.selectedIds]).toEqual(["b", "c", "d"]);

    const added = resolveSegmentSelection({
      orderedIds,
      selectedIds: new Set(["a"]),
      primaryId: "c",
      targetId: "d",
      modifiers: { additive: true, range: true },
    });
    expect([...added.selectedIds]).toEqual(["a", "c", "d"]);
  });

  it("drops stale selections while preserving an existing primary", () => {
    expect(reconcileSegmentSelection({
      orderedIds: ["a", "b"],
      selectedIds: new Set(["a", "missing"]),
      primaryId: "b",
    })).toEqual({ selectedIds: new Set(["a", "b"]), primaryId: "b" });
    expect(reconcileSegmentSelection({
      orderedIds: ["a"],
      selectedIds: new Set(["a"]),
      primaryId: "missing",
    })).toEqual({ selectedIds: new Set(), primaryId: null });
  });

  it("maps platform modifiers without coupling the resolver to React", () => {
    expect(segmentSelectionModifiers({ ctrlKey: true, metaKey: false, shiftKey: true }))
      .toEqual({ additive: true, range: true });
    expect(segmentSelectionModifiers({ ctrlKey: false, metaKey: true, shiftKey: false }))
      .toEqual({ additive: true, range: false });
  });
});
