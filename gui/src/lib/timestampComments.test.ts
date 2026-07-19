import { describe, expect, it } from "vitest";

import {
  applyTimestampCommentToGuide,
  backToTimestampCommentSelection,
  beginTimestampCommentFlow,
  closeTimestampCommentFlow,
  editSelectedTimestampComment,
  selectTimestampCommentCandidate,
  updateTimestampCommentDraft
} from "@/lib/timestampComments";
import type { TimestampCommentCandidate } from "@/types";

const description = candidate("description", "description", "description text");
const comment = candidate("comment", "comment-1", "comment text");

describe("timestamp comment dialog flow", () => {
  it("stays closed without candidates", () => {
    expect(beginTimestampCommentFlow([])).toEqual(closeTimestampCommentFlow());
  });

  it("opens the editor directly for one candidate", () => {
    const flow = beginTimestampCommentFlow([comment]);

    expect(flow.mode).toBe("edit");
    if (flow.mode !== "edit") throw new Error("expected edit flow");
    expect(flow.candidateId).toBe(comment.id);
    expect(flow.draft).toBe(comment.text);
    expect(flow.canGoBack).toBe(false);
  });

  it("selects the first description before editing when two candidates exist", () => {
    const flow = beginTimestampCommentFlow([description, comment]);

    expect(flow).toMatchObject({ mode: "select", selectedId: description.id });
  });

  it("selects, edits, updates, and returns to the candidate list", () => {
    const started = beginTimestampCommentFlow([description, comment]);
    const selected = selectTimestampCommentCandidate(started, comment.id);
    const editing = editSelectedTimestampComment(selected);
    const updated = updateTimestampCommentDraft(editing, "edited comment");
    const returned = backToTimestampCommentSelection(updated);

    expect(editing).toMatchObject({ mode: "edit", candidateId: comment.id, canGoBack: true });
    expect(updated).toMatchObject({ mode: "edit", draft: "edited comment" });
    expect(returned).toMatchObject({ mode: "select", selectedId: comment.id });
  });

  it("changes the guide only when an editor draft is applied", () => {
    const existing = "existing guide";
    const selecting = beginTimestampCommentFlow([description, comment]);
    const editing = updateTimestampCommentDraft(editSelectedTimestampComment(selecting), "edited description");

    expect(applyTimestampCommentToGuide(selecting, existing)).toBe(existing);
    expect(applyTimestampCommentToGuide(closeTimestampCommentFlow(), existing)).toBe(existing);
    expect(applyTimestampCommentToGuide(editing, existing)).toBe("edited description");
  });
});

function candidate(
  source: TimestampCommentCandidate["source"],
  id: string,
  text: string
): TimestampCommentCandidate {
  return {
    source,
    id,
    author: "author",
    text,
    timestamp_count: 2,
    like_count: source === "comment" ? 1 : null
  };
}
