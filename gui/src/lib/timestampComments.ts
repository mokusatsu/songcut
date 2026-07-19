import type { TimestampCommentCandidate } from "@/types";

export type TimestampCommentFlow =
  | { mode: "closed"; candidates: TimestampCommentCandidate[] }
  | { mode: "select"; candidates: TimestampCommentCandidate[]; selectedId: string }
  | {
      mode: "edit";
      candidates: TimestampCommentCandidate[];
      candidateId: string;
      draft: string;
      canGoBack: boolean;
    };

export function closeTimestampCommentFlow(): TimestampCommentFlow {
  return { mode: "closed", candidates: [] };
}

export function beginTimestampCommentFlow(candidates: TimestampCommentCandidate[]): TimestampCommentFlow {
  const available = candidates.slice(0, 2);
  if (available.length === 0) return closeTimestampCommentFlow();
  if (available.length === 1) {
    return {
      mode: "edit",
      candidates: available,
      candidateId: available[0].id,
      draft: available[0].text,
      canGoBack: false
    };
  }
  return { mode: "select", candidates: available, selectedId: available[0].id };
}

export function selectTimestampCommentCandidate(flow: TimestampCommentFlow, id: string): TimestampCommentFlow {
  if (flow.mode !== "select" || !flow.candidates.some((candidate) => candidate.id === id)) return flow;
  return { ...flow, selectedId: id };
}

export function editSelectedTimestampComment(flow: TimestampCommentFlow): TimestampCommentFlow {
  if (flow.mode !== "select") return flow;
  const candidate = flow.candidates.find((item) => item.id === flow.selectedId);
  if (!candidate) return flow;
  return {
    mode: "edit",
    candidates: flow.candidates,
    candidateId: candidate.id,
    draft: candidate.text,
    canGoBack: true
  };
}

export function updateTimestampCommentDraft(flow: TimestampCommentFlow, draft: string): TimestampCommentFlow {
  return flow.mode === "edit" ? { ...flow, draft } : flow;
}

export function backToTimestampCommentSelection(flow: TimestampCommentFlow): TimestampCommentFlow {
  if (flow.mode !== "edit" || !flow.canGoBack) return flow;
  return { mode: "select", candidates: flow.candidates, selectedId: flow.candidateId };
}

export function applyTimestampCommentToGuide(flow: TimestampCommentFlow, currentGuide: string): string {
  return flow.mode === "edit" ? flow.draft : currentGuide;
}
