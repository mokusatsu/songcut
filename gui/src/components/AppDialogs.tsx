import { CircleAlert, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { JobProgressDialog } from "@/components/JobProgressDialog";
import { clamp, formatTime } from "@/lib/time";
import { DEFAULT_FILENAME_TEMPLATE, FILENAME_TEMPLATE_PLACEHOLDERS } from "@/lib/exportNaming";
import type { TimestampCommentFlow } from "@/lib/timestampComments";
import type { CutOutputItem } from "@/lib/useCutOperations";
import type { TaskRegistryEntry, TaskSlot } from "@/lib/useTaskRegistry";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import type {
  ExportRenderPlan,
  ExportRenderPlanItem,
  FfmpegCheckResult,
  JobRecord,
  SmartRenderEstimate,
  TimestampCommentCandidate,
  VideoInfo,
} from "@/types";
import { localizeJobMessage, localizeUiMessage, tr } from "@/i18n";
import type { ScratchProxyState } from "@/lib/scratchProxy";
import type { useProgressiveWaveform } from "@/lib/useProgressiveWaveform";

export const FFMPEG_DOWNLOAD_URL = "https://www.ffmpeg.org/download.html";

export type OutputItem = CutOutputItem;

export type ExportPlanState =
  | { status: "idle"; plan: null; error: null }
  | { status: "loading"; plan: ExportRenderPlan; error: null; completed: number; total: number; currentId: string | null }
  | { status: "ready"; plan: ExportRenderPlan; error: null }
  | { status: "error"; plan: null; error: string };

export type SegmentManagementReview =
  | {
      kind: "remove";
      title: string;
      message: string;
      confirmLabel: string;
      segmentIds: string[];
      items: OutputItem[];
    }
  | {
      kind: "sort";
      title: string;
      message: string;
      before: OutputItem[];
      after: OutputItem[];
    };

/** `TimestampCommentDialogs`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function TimestampCommentDialogs(props: {
  flow: TimestampCommentFlow;
  onClose: () => void;
  onSelect: (id: string) => void;
  onEditSelected: () => void;
  onDraftChange: (draft: string) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  if (props.flow.mode === "closed") return null;

  if (props.flow.mode === "select") {
    const selectionFlow = props.flow;
    return (
      <Dialog open title={tr("timestamp.choose")} onClose={props.onClose}>
        <p className="dialog-message">
          {tr("timestamp.found")}
        </p>
        <div className="timestamp-comment-candidates" role="radiogroup" aria-label={tr("timestamp.candidates")}>
          {selectionFlow.candidates.map((candidate) => {
            const selected = candidate.id === selectionFlow.selectedId;
            return (
              <label
                className={selected ? "timestamp-comment-candidate selected" : "timestamp-comment-candidate"}
                key={`${candidate.source}:${candidate.id}`}
              >
                <input
                  type="radio"
                  name="timestamp-comment-candidate"
                  value={candidate.id}
                  checked={selected}
                  onChange={() => props.onSelect(candidate.id)}
                />
                <div className="timestamp-comment-candidate-content">
                  <div className="timestamp-comment-candidate-header">
                    <strong>{timestampCommentSourceLabel(candidate)}</strong>
                    <span>{candidate.author}</span>
                    <span>{tr("timestamp.timestamps", { count: candidate.timestamp_count })}</span>
                    {candidate.like_count !== null ? <span>{tr("timestamp.likes", { count: candidate.like_count })}</span> : null}
                  </div>
                  <ScrollArea
                    className="timestamp-comment-preview"
                    viewportClassName="timestamp-comment-preview-viewport"
                    scrollbars={["vertical"]}
                  >
                    <div className="timestamp-comment-preview-content">{candidate.text}</div>
                  </ScrollArea>
                </div>
              </label>
            );
          })}
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={props.onClose}>
            {tr("common.skip")}
          </Button>
          <Button onClick={props.onEditSelected}>{tr("timestamp.editSelected")}</Button>
        </div>
      </Dialog>
    );
  }

  const editFlow = props.flow;
  const candidate = editFlow.candidates.find((item) => item.id === editFlow.candidateId);
  if (!candidate) return null;
  return (
    <Dialog open title={tr("timestamp.edit", { source: timestampCommentSourceLabel(candidate) })} onClose={props.onClose}>
      <form
        className="timestamp-comment-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onApply();
        }}
      >
        <p className="dialog-message">
          {tr("timestamp.removeNonSongs")}
        </p>
        <Textarea
          className="timestamp-comment-editor"
          value={editFlow.draft}
          autoFocus
          onChange={(event) => props.onDraftChange(event.currentTarget.value)}
        />
        <div className="dialog-actions">
          <div>
            {editFlow.canGoBack ? (
              <Button type="button" variant="secondary" onClick={props.onBack}>
                {tr("common.back")}
              </Button>
            ) : null}
          </div>
          <div className="dialog-action-group">
            <Button type="button" variant="secondary" onClick={props.onClose}>
              {tr("common.cancel")}
            </Button>
            <Button type="submit">{tr("timestamp.apply")}</Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function timestampCommentSourceLabel(candidate: TimestampCommentCandidate) {
  return tr(candidate.source === "description" ? "timestamp.description" : "timestamp.comment");
}

/** `OutputDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function OutputDialog(props: {
  open: boolean;
  items: OutputItem[];
  estimate: SmartRenderEstimate | null;
  renderPlanState: ExportPlanState;
  error: string | null;
  filenameTemplate: string;
  createSourceFolder: boolean;
  sourceFolderName: string;
  onClose: () => void;
  onPreview: (item: OutputItem) => void;
  onFilenameTemplate: (value: string) => void;
  onCreateSourceFolder: (value: boolean) => void;
  onCheckRenderDetails: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const renderPlans = new Map(props.renderPlanState.plan?.items.map((item) => [item.id, item]));
  return (
    <Dialog open={props.open} title={tr("output.review")} onClose={props.onClose}>
      <ExportCompatibilitySummary estimate={props.estimate} />
      <div className="output-options">
        <label className="output-template-field">
          <span>{tr("settings.filenameTemplate")}</span>
          <Input
            value={props.filenameTemplate}
            onChange={(event) => props.onFilenameTemplate(event.currentTarget.value)}
            aria-invalid={Boolean(props.error)}
            placeholder={DEFAULT_FILENAME_TEMPLATE}
          />
        </label>
        <div className="output-template-help">
          {tr("output.placeholders", { placeholders: FILENAME_TEMPLATE_PLACEHOLDERS.map((name) => `{${name}}`).join(", ") })}
        </div>
        {props.error ? <div className="output-template-error">{props.error}</div> : null}
        <label className="output-folder-option">
          <Checkbox
            checked={props.createSourceFolder}
            onChange={(event) => props.onCreateSourceFolder(event.currentTarget.checked)}
          />
          <span>{tr("output.createFolder", { name: props.sourceFolderName })}</span>
        </label>
      </div>
      <ScrollArea className="output-list" scrollbars={["vertical"]}>
        <SegmentReviewRows
          items={props.items.filter((item) => item.checked)}
          onPreview={props.onPreview}
          renderPlans={renderPlans}
          renderPlanStatus={props.renderPlanState.status}
          checkingItemId={props.renderPlanState.status === "loading" ? props.renderPlanState.currentId : null}
          defaultSuffix={props.estimate?.output_suffix ?? ".mp4"}
        />
      </ScrollArea>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>
          {tr("common.back")}
        </Button>
        <div className="dialog-action-group">
          <Button
            variant="secondary"
            onClick={props.onCheckRenderDetails}
            disabled={props.renderPlanState.status === "loading"}
          >
            {props.renderPlanState.status === "loading"
              ? tr("output.checkingProgress", {
                  completed: props.renderPlanState.completed,
                  total: props.renderPlanState.total
                })
              : tr("output.checkDetails")}
          </Button>
          <Button
            onClick={props.onExport}
            disabled={Boolean(props.error) || props.items.length === 0 || props.renderPlanState.status === "loading"}
          >
            {tr("common.export")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** `SegmentManagementDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function SegmentManagementDialog(props: {
  review: SegmentManagementReview | null;
  canPreview: boolean;
  onClose: () => void;
  onPreview: (item: OutputItem) => void;
  onConfirm: () => void;
}) {
  const review = props.review;
  return (
    <Dialog open={Boolean(review)} title={review?.title ?? tr("segments.management")} onClose={props.onClose}>
      {review ? (
        <>
          <p className="dialog-message">{review.message}</p>
          {review.kind === "sort" ? (
            <div className="segment-sort-comparison">
              <SegmentReviewPane label={tr("common.before")} items={review.before} canPreview={props.canPreview} onPreview={props.onPreview} />
              <SegmentReviewPane label={tr("common.after")} items={review.after} canPreview={props.canPreview} onPreview={props.onPreview} />
            </div>
          ) : (
            <ScrollArea className="output-list segment-management-list" scrollbars={["vertical"]}>
              <SegmentReviewRows items={review.items} onPreview={props.canPreview ? props.onPreview : undefined} />
            </ScrollArea>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={props.onClose}>{tr("common.cancel")}</Button>
            <Button variant={review.kind === "remove" ? "danger" : "default"} onClick={props.onConfirm}>
              {review.kind === "remove" ? review.confirmLabel : tr("segments.sort")}
            </Button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function SegmentReviewPane(props: {
  label: string;
  items: OutputItem[];
  canPreview: boolean;
  onPreview: (item: OutputItem) => void;
}) {
  return (
    <section className="segment-review-pane" aria-label={props.label}>
      <h3>{props.label}</h3>
      <ScrollArea className="segment-review-list" scrollbars={["vertical"]}>
        <SegmentReviewRows items={props.items} onPreview={props.canPreview ? props.onPreview : undefined} />
      </ScrollArea>
    </section>
  );
}

function SegmentReviewRows(props: {
  items: OutputItem[];
  onPreview?: (item: OutputItem) => void;
  renderPlans?: Map<string, ExportRenderPlanItem>;
  renderPlanStatus?: ExportPlanState["status"];
  checkingItemId?: string | null;
  defaultSuffix?: string;
}) {
  return (
    <div className="output-list-content">
      {props.items.map((item) => {
        const renderPlan = props.renderPlans?.get(item.id);
        const renderStatus: ExportPlanState["status"] = renderPlan
          ? "ready"
          : props.renderPlanStatus === "loading" && props.checkingItemId !== item.id
            ? "idle"
            : props.renderPlanStatus ?? "idle";
        const suffix = renderPlan?.output_suffix ?? props.defaultSuffix ?? ".mp4";
        return (
          <button
            key={item.id}
            className="output-row"
            onClick={() => props.onPreview?.(item)}
            disabled={!props.onPreview}
          >
            <span className="output-main">
              <span className="output-title-line">
                <span className="output-title">{item.title.trim() || item.segmentId || item.id}</span>
                {props.renderPlans || props.renderPlanStatus ? (
                  <ExportRenderBadge plan={renderPlan} status={renderStatus} />
                ) : null}
              </span>
              <span className="output-meta">
                ID: {item.segmentId || item.id} / {tr("output.file")}: {item.filename_stem}{suffix}
              </span>
              {renderPlan ? <span className="output-render-detail">{exportRenderDetail(renderPlan)}</span> : null}
            </span>
            <span className="output-time">
              {formatTime(item.start)} - {formatTime(item.end)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExportRenderBadge(props: { plan?: ExportRenderPlanItem; status: ExportPlanState["status"] }) {
  if (props.status === "loading" && !props.plan) return <span className="render-badge render-badge-checking">{tr("output.checking")}</span>;
  if (props.status === "error") return <span className="render-badge render-badge-error">{tr("output.checkFailedBadge")}</span>;
  if (!props.plan) return <span className="render-badge render-badge-unchecked">{tr("output.notChecked")}</span>;
  return (
    <span className={`render-badge ${props.plan.smart_render ? "render-badge-smart" : "render-badge-reencode"}`}>
      {tr(props.plan.smart_render ? "output.smart" : "output.full")}
    </span>
  );
}

function ExportCompatibilitySummary(props: { estimate: SmartRenderEstimate | null }) {
  const estimate = props.estimate;
  if (!estimate) {
    return <div className="export-render-summary"><span className="render-badge render-badge-unknown">{tr("common.unknownTitle")}</span></div>;
  }
  return (
    <div className="export-render-summary">
      <span className={`render-badge ${estimate.smart_render ? "render-badge-smart" : "render-badge-reencode"}`}>
        {tr(estimate.smart_render ? "output.smartEstimate" : "output.fullEstimate")}
      </span>
      <span>
        {tr("output.estimateSummary", {
          container: estimate.source_container.toUpperCase(),
          codec: estimate.video_codec.toUpperCase() || tr("common.unknownTitle")
        })}
      </span>
    </div>
  );
}

function ExportRenderSummary(props: { state: ExportPlanState }) {
  const state = props.state;
  if (state.status === "loading") {
    return <div className="export-render-summary"><ExportRenderBadge status="loading" /><span>{tr("output.checkingSummary")}</span></div>;
  }
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <div className="export-render-summary export-render-summary-error">
        <ExportRenderBadge status="error" />
        <span>{tr("output.checkFailed", { error: state.error })}</span>
      </div>
    );
  }
  if (!state.plan) return null;
  const smartCount = state.plan.items.filter((item) => item.smart_render).length;
  const reencodeCount = state.plan.items.length - smartCount;
  return (
    <div className="export-render-summary">
      {smartCount > 0 ? <span className="render-badge render-badge-smart">{tr("output.smartCount", { count: smartCount })}</span> : null}
      {reencodeCount > 0 ? <span className="render-badge render-badge-reencode">{tr("output.fullCount", { count: reencodeCount })}</span> : null}
      <span>{tr(reencodeCount === 0 ? "output.allSmart" : "output.mixed")}</span>
    </div>
  );
}

function exportRenderDetail(plan: ExportRenderPlanItem) {
  if (plan.smart_render) {
    return tr("output.smartDetail", { codec: plan.video_codec.toUpperCase(), copied: formatDuration(plan.copied_seconds), encoded: formatDuration(plan.encoded_seconds) });
  }
  if (plan.fallback_reason?.startsWith("no keyframe-aligned GOP")) {
    return tr("output.noGop");
  }
  if (plan.fallback_reason?.startsWith("unsupported smart-render codec/container")) {
    return tr("output.unsupported", { codec: plan.video_codec.toUpperCase() || tr("common.unknownTitle"), container: plan.container_family.toUpperCase() });
  }
  return plan.fallback_reason || tr("output.fullDetail");
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

/** `WhisperDownloadProgressDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function WhisperDownloadProgressDialog(props: {
  open: boolean;
  job: JobRecord | null;
  onClose: () => void;
}) {
  return (
    <ModelDownloadProgressDialog
      {...props}
      title={tr("dialogs.whisperDownloadTitle")}
      description={tr("dialogs.whisperDownloadDescription")}
      preparing={tr("dialogs.whisperDownloadPreparing")}
      failed={tr("dialogs.whisperDownloadFailed")}
      complete={tr("dialogs.whisperDownloadComplete")}
    />
  );
}

/** `ModelDownloadProgressDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function ModelDownloadProgressDialog(props: {
  open: boolean;
  job: JobRecord | null;
  title: string;
  description: string;
  preparing: string;
  failed: string;
  complete: string;
  onClose: () => void;
}) {
  const status = props.job?.status ?? "queued";
  const result =
    props.job?.result && typeof props.job.result === "object"
      ? props.job.result as {
          downloaded_bytes?: number;
          total_bytes?: number;
          installed_bytes?: number | null;
        }
      : null;
  const downloadedBytes = result?.downloaded_bytes ?? (status === "completed" ? result?.installed_bytes : null);
  const totalBytes = result?.total_bytes ?? (status === "completed" ? result?.installed_bytes : null);
  const progress =
    typeof downloadedBytes === "number" && typeof totalBytes === "number" && totalBytes > 0
      ? clamp(downloadedBytes / totalBytes, 0, 1)
      : clamp(props.job?.progress ?? 0, 0, 1);
  const transferLabel =
    typeof downloadedBytes === "number" && typeof totalBytes === "number" && totalBytes > 0
      ? `${formatDownloadBytes(downloadedBytes)} / ${formatDownloadBytes(totalBytes)}`
      : null;
  return (
    <JobProgressDialog
      open={props.open}
      title={props.title}
      job={props.job}
      pendingMessage={props.preparing}
      description={<p className="dialog-message">{props.description}</p>}
      statusMessage={(state) =>
        state.status === "completed"
          ? props.complete
          : state.status === "failed"
            ? props.failed
            : props.preparing
      }
      progressOverride={progress}
      note={transferLabel ? <div className="export-progress-note">{transferLabel}</div> : null}
      onClose={props.onClose}
      bodyClassName="export-progress"
      closeAction={{ statuses: ["completed", "failed"], activeLabel: tr("common.hide"), terminalLabel: tr("common.close") }}
    />
  );
}

function formatDownloadBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.max(0, Math.round(value))} B`;
}

/** `ExportProgressDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function ExportProgressDialog(props: {
  open: boolean;
  job: JobRecord | null;
  estimate: SmartRenderEstimate | null;
  renderPlanState: ExportPlanState;
  onClose: () => void;
}) {
  const progress = clamp(props.job?.progress ?? 0, 0, 1);
  const status = props.job?.status ?? "queued";
  const complete = status === "completed";
  const failed = status === "failed";
  const actualRenderPlanState = actualExportPlanState(props.job);
  const checkedRenderPlanState = props.renderPlanState.status === "ready" ? props.renderPlanState : null;
  const progressRenderPlanState = actualRenderPlanState ?? checkedRenderPlanState;
  return (
    <JobProgressDialog
      open={props.open}
      title={tr("output.progress")}
      job={props.job}
      pendingMessage={tr("output.preparing")}
      progressOverride={progress}
      beforeStatus={
        progressRenderPlanState
          ? <ExportRenderSummary state={progressRenderPlanState} />
          : <ExportCompatibilitySummary estimate={props.estimate} />
      }
      statusMessage={localizeJobMessage(props.job) || tr("output.preparing")}
      note={
        <div className="export-progress-note">
          {failed
            ? props.job?.error || tr("output.failed")
            : complete
              ? tr("output.complete")
              : tr("output.progressNote")}
        </div>
      }
      error={false}
      onClose={props.onClose}
      bodyClassName="export-progress"
      closeAction={{
        statuses: "always",
        activeLabel: tr("common.hide"),
        terminalLabel: tr("common.close"),
        label: (state) => state.status === "completed" || state.status === "failed" ? tr("common.close") : tr("common.hide"),
      }}
    />
  );
}

function actualExportPlanState(job: JobRecord | null): ExportPlanState | null {
  if (job?.status !== "completed" || !job.result || typeof job.result !== "object") return null;
  const exported = (job.result as { exported?: unknown }).exported;
  if (!Array.isArray(exported)) return null;
  const items: ExportRenderPlanItem[] = [];
  for (const result of exported) {
    if (!result || typeof result !== "object") return null;
    const row = result as { id?: unknown; smart_render_plan?: unknown };
    if (typeof row.id !== "string" || !row.smart_render_plan || typeof row.smart_render_plan !== "object") return null;
    const plan = row.smart_render_plan as Record<string, unknown>;
    const spans = Array.isArray(plan.spans) ? plan.spans : [];
    const copiedSeconds = spans.reduce((total, span) => {
      if (!span || typeof span !== "object") return total;
      const value = span as Record<string, unknown>;
      return value.mode === "copy" && typeof value.start === "number" && typeof value.end === "number"
        ? total + Math.max(0, value.end - value.start)
        : total;
    }, 0);
    const start = typeof plan.start === "number" ? plan.start : 0;
    const end = typeof plan.end === "number" ? plan.end : start;
    const fallbackReason = typeof plan.fallback_reason === "string" ? plan.fallback_reason : null;
    items.push({
      id: row.id,
      smart_render: fallbackReason === null,
      output_suffix: typeof plan.output_suffix === "string" ? plan.output_suffix : ".mp4",
      video_codec: typeof plan.video_codec === "string" ? plan.video_codec : "",
      container_family: typeof plan.container_family === "string" ? plan.container_family : "",
      copied_seconds: copiedSeconds,
      encoded_seconds: Math.max(0, end - start - copiedSeconds),
      fallback_reason: fallbackReason
    });
  }
  return { status: "ready", plan: { items }, error: null };
}

/** `FfmpegCheckDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function FfmpegCheckDialog(props: {
  open: boolean;
  pending: boolean;
  result: FfmpegCheckResult | null;
  onClose: () => void;
}) {
  const downloadUrl = props.result?.download_url || FFMPEG_DOWNLOAD_URL;
  return (
    <Dialog open={props.open} title={tr("ffmpeg.title")} onClose={props.onClose}>
      <div className="ffmpeg-check">
        {props.pending ? (
          <p className="dialog-message">{tr("ffmpeg.checking")}</p>
        ) : props.result?.ok ? (
          <>
            <p className="dialog-message">{tr("ffmpeg.available")}</p>
            <div className="ffmpeg-check-paths">
              <span>ffmpeg</span>
              <code>{props.result.ffmpeg}</code>
              <span>ffprobe</span>
              <code>{props.result.ffprobe}</code>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-message">{tr("ffmpeg.missing")}</p>
            <pre className="ffmpeg-check-error">{props.result?.error || tr("ffmpeg.failed")}</pre>
            <a className="external-link" href={downloadUrl} target="_blank" rel="noreferrer">
              {tr("ffmpeg.download")}
            </a>
          </>
        )}
      </div>
      <div className="dialog-actions">
        <Button onClick={props.onClose}>{tr("common.ok")}</Button>
      </div>
    </Dialog>
  );
}

/** `TaskStatusPanel`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function TaskStatusPanel({
  runningTasks,
  failedTasks,
  latestTerminalTask,
  message,
  videoInfo,
  scratchProxyState,
  waveformPhase,
  waveformProgress,
  onDismiss,
  onWaveformRetry
}: {
  runningTasks: TaskRegistryEntry[];
  failedTasks: TaskRegistryEntry[];
  latestTerminalTask: JobRecord | null;
  message: string;
  videoInfo: VideoInfo | null;
  scratchProxyState: ScratchProxyState;
  waveformPhase: ReturnType<typeof useProgressiveWaveform>["phase"];
  waveformProgress: number;
  onDismiss: (slot: TaskSlot) => void;
  onWaveformRetry: (() => void) | null;
}) {
  const waveformRetryFocusProps = useEditorActionFocusProps<HTMLButtonElement>(onWaveformRetry ?? undefined);
  const idleJob = runningTasks.length === 0 && failedTasks.length === 0 ? latestTerminalTask : null;
  const idleJobMessage = localizeJobMessage(idleJob);
  const uiMessage = localizeUiMessage(message);
  return (
    <aside className="status-panel" aria-live="polite">
      {runningTasks.length ? (
        <div className="task-status-list">
          {runningTasks.map((entry) => (
            <TaskStatusRow key={entry.slot} entry={entry} />
          ))}
        </div>
      ) : null}
      {failedTasks.length ? (
        <div className="task-status-list task-status-failures">
          {failedTasks.map((entry) => (
            <TaskStatusRow key={entry.slot} entry={entry} onDismiss={() => onDismiss(entry.slot)} />
          ))}
        </div>
      ) : null}
      {runningTasks.length === 0 && failedTasks.length === 0 ? (
        <>
          <div className="status-main">
            {idleJob?.status === "completed" ? <CheckCircle2 size={16} /> : null}
            {idleJob ? <strong>{jobKindLabel(idleJob.kind)}</strong> : null}
            <span>{idleJobMessage || uiMessage || tr("app.idle")}</span>
          </div>
          {idleJobMessage && uiMessage && idleJobMessage !== uiMessage ? (
            <div className="status-secondary-message">{uiMessage}</div>
          ) : null}
        </>
      ) : null}
      {videoInfo ? (
        <div className="status-meta">
          <div className="meta-line">
            {formatTime(videoInfo.duration)} / {videoInfo.video.width}x{videoInfo.video.height} / {videoInfo.video.codec}
          </div>
          <div className="meta-line" data-scratch-proxy-status={scratchProxyState}>
            {localizedScratchProxyStatusLabel(scratchProxyState)}
          </div>
          <div className="meta-line waveform-status-line" data-waveform-status={waveformPhase}>
            <span>{waveformStatusLabel(waveformPhase, waveformProgress)}</span>
            {onWaveformRetry ? (
              <button {...waveformRetryFocusProps} type="button" className="waveform-retry">{tr("controls.retryWaveform")}</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function TaskStatusRow({ entry, onDismiss }: { entry: TaskRegistryEntry; onDismiss?: () => void }) {
  const dismissFocusProps = useEditorActionFocusProps<HTMLButtonElement>(onDismiss);
  const { job } = entry;
  const failed = job.status === "failed" || job.status === "cancelled";
  return (
    <div className={`task-status-row task-status-${job.status}`}>
      <div className="task-status-heading">
        {failed ? <CircleAlert size={15} /> : null}
        <strong>{jobKindLabel(job.kind)}</strong>
        <span>{localizeJobMessage(job)}</span>
      </div>
      <span className="task-status-percent">{Math.round(clamp(job.progress, 0, 1) * 100)}%</span>
      {onDismiss ? (
        <button {...dismissFocusProps} type="button" className="task-status-dismiss">
          {tr("common.close")}
        </button>
      ) : null}
      <progress value={clamp(job.progress, 0, 1)} max={1} />
      {job.error ? <div className="task-status-error">{job.error}</div> : null}
    </div>
  );
}

/** `jobKindLabel`のjob種別をtask status表示用の文言へ変換する。 */
export function jobKindLabel(kind: string) {
  if (kind === "analysis") return tr("tasks.analysis");
  if (kind === "lyrics-analysis") return tr("tasks.lyricsAnalysis");
  if (kind === "transcription") return tr("tasks.transcription");
  if (kind === "export") return tr("tasks.export");
  if (kind === "subtitle-export") return tr("tasks.subtitleExport");
  if (kind === "subtitle-render") return tr("tasks.subtitleRender");
  if (kind === "download-whisper") return tr("tasks.download");
  if (kind === "download-demucs") return tr("tasks.demucsDownload");
  if (kind === "download-mms") return tr("tasks.mmsDownload");
  if (kind === "waveform") return tr("tasks.waveform");
  if (kind === "scratch-proxy") return tr("tasks.proxy");
  return tr("tasks.generic");
}

function waveformStatusLabel(phase: ReturnType<typeof useProgressiveWaveform>["phase"], progress: number) {
  switch (phase) {
    case "streaming":
      return tr("app.waveformProgress", { progress: Math.round(clamp(progress, 0, 1) * 100) });
    case "finalizing":
      return tr("app.waveformFinalizing");
    case "ready":
      return tr("app.waveformReady");
    case "failed":
      return tr("app.waveformUnavailable");
    case "idle":
      return tr("app.waveformWaiting");
  }
}

function localizedScratchProxyStatusLabel(state: ScratchProxyState) {
  switch (state) {
    case "disabled": return tr("app.scratchDisabled");
    case "preparing":
    case "loading": return tr("app.scratchPreparing");
    case "ready": return tr("app.scratchReady");
    case "failed": return tr("app.scratchFailed");
    case "idle":
    case "original": return tr("app.scratchOriginal");
  }
}
