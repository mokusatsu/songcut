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

/** `closeTimestampCommentFlow`のflowまたはdialogを閉じ、編集中の一時状態を初期化する。 */
export function closeTimestampCommentFlow(): TimestampCommentFlow {
  return { mode: "closed", candidates: [] };
}

/** `beginTimestampCommentFlow`で複数段階の入力flowを次または前の状態へ遷移させる。 */
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

/** `selectTimestampCommentCandidate`の候補と条件から、利用すべき値または操作を決定する。 */
export function selectTimestampCommentCandidate(flow: TimestampCommentFlow, id: string): TimestampCommentFlow {
  if (flow.mode !== "select" || !flow.candidates.some((candidate) => candidate.id === id)) return flow;
  return { ...flow, selectedId: id };
}

/** 選択済みtimestamp候補を編集段階へ進め、既存文面をdraftとして設定する。 */
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

/** `updateTimestampCommentDraft`で指定された変更を不変更新として状態へ反映する。 */
export function updateTimestampCommentDraft(flow: TimestampCommentFlow, draft: string): TimestampCommentFlow {
  return flow.mode === "edit" ? { ...flow, draft } : flow;
}

/** `backToTimestampCommentSelection`で複数段階の入力flowを次または前の状態へ遷移させる。 */
export function backToTimestampCommentSelection(flow: TimestampCommentFlow): TimestampCommentFlow {
  if (flow.mode !== "edit" || !flow.canGoBack) return flow;
  return { mode: "select", candidates: flow.candidates, selectedId: flow.candidateId };
}

/** `applyTimestampCommentToGuide`で指定された変更を不変更新として状態へ反映する。 */
export function applyTimestampCommentToGuide(flow: TimestampCommentFlow, currentGuide: string): string {
  return flow.mode === "edit" ? flow.draft : currentGuide;
}
