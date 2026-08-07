import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { clamp } from "@/lib/time";
import type { JobRecord } from "@/types";

export type JobStatus = JobRecord["status"];

export type JobProgressDialogState = {
  status: JobStatus;
  progress: number;
  percent: number;
  active: boolean;
  terminal: boolean;
  showCloseAction: boolean;
};

export type JobProgressCloseAction = {
  statuses: "always" | readonly JobStatus[];
  activeLabel: string;
  terminalLabel: string;
  label?: string | ((state: JobProgressDialogState) => string);
};

export type JobProgressDialogProps = {
  open: boolean;
  title: string;
  job: JobRecord | null;
  pendingMessage: string;
  onClose: () => void;
  className?: string;
  bodyClassName?: string;
  description?: ReactNode;
  beforeStatus?: ReactNode;
  note?: ReactNode | ((state: JobProgressDialogState) => ReactNode);
  progressOverride?: number;
  statusMessage?: string | ((state: JobProgressDialogState) => string);
  error?: string | null | false;
  closeAction?: JobProgressCloseAction;
};

/** `resolveJobProgressDialogState`の候補と条件から、利用すべき値または操作を決定する。 */
export function resolveJobProgressDialogState(
  job: JobRecord | null | undefined,
  progressOverride?: number,
  closeStatuses: JobProgressCloseAction["statuses"] = "always",
): JobProgressDialogState {
  const status = job?.status ?? "queued";
  const rawProgress = progressOverride ?? job?.progress ?? 0;
  const progress = Number.isFinite(rawProgress) ? clamp(rawProgress, 0, 1) : 0;
  const active = status === "queued" || status === "running";
  const terminal = !active;
  const showCloseAction = closeStatuses === "always" || closeStatuses.includes(status);
  return {
    status,
    progress,
    percent: Math.round(progress * 100),
    active,
    terminal,
    showCloseAction,
  };
}

/** `resolveJobProgressMessage`の候補と条件から、利用すべき値または操作を決定する。 */
export function resolveJobProgressMessage(
  job: JobRecord | null | undefined,
  pendingMessage: string,
  state: JobProgressDialogState,
  statusMessage?: JobProgressDialogProps["statusMessage"],
) {
  if (typeof statusMessage === "function") return statusMessage(state);
  if (typeof statusMessage === "string") return statusMessage;
  return job?.message || pendingMessage;
}

/** `shouldRenderJobProgressError`の入力が要求された条件やschemaを満たすか検証する。 */
export function shouldRenderJobProgressError(
  job: JobRecord | null | undefined,
  error: JobProgressDialogProps["error"],
) {
  return error !== false && Boolean(error ?? job?.error);
}

/** `resolveJobProgressDialogActionLabel`の候補と条件から、利用すべき値または操作を決定する。 */
export function resolveJobProgressDialogActionLabel(
  state: JobProgressDialogState,
  closeAction: JobProgressCloseAction,
) {
  if (typeof closeAction.label === "function") return closeAction.label(state);
  if (typeof closeAction.label === "string") return closeAction.label;
  return state.active ? closeAction.activeLabel : closeAction.terminalLabel;
}

/** `JobProgressDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function JobProgressDialog(props: JobProgressDialogProps) {
  const state = resolveJobProgressDialogState(props.job, props.progressOverride, props.closeAction?.statuses);
  const statusMessage = resolveJobProgressMessage(props.job, props.pendingMessage, state, props.statusMessage);
  const errorMessage = props.error === false ? null : props.error ?? props.job?.error ?? null;
  const note = typeof props.note === "function" ? props.note(state) : props.note;
  return (
    <Dialog open={props.open} title={props.title} className={props.className} onClose={props.onClose}>
      <div className={props.bodyClassName}>
        {props.description}
        {props.beforeStatus}
        <div className={`export-progress-status export-progress-status-${state.status}`}>
          <span>{statusMessage}</span>
          <strong>{state.percent}%</strong>
        </div>
        <progress value={state.progress} max={1} />
        {note}
        {shouldRenderJobProgressError(props.job, props.error) ? (
          <div className="warning-text">{errorMessage}</div>
        ) : null}
      </div>
      {props.closeAction && state.showCloseAction ? (
        <div className="dialog-actions">
          <Button variant="secondary" onClick={props.onClose}>
            {resolveJobProgressDialogActionLabel(state, props.closeAction)}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
