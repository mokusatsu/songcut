import { useState, type ReactNode } from "react";
import { CircleAlert, Info, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { localizeJobMessage, localizeUiMessage, tr } from "@/i18n";
import type { AppMode } from "@/lib/modes";
import type { ScratchProxyState } from "@/lib/scratchProxy";
import { clamp, formatTime } from "@/lib/time";
import type { TaskRegistryEntry, TaskSlot } from "@/lib/useTaskRegistry";
import type { useProgressiveWaveform } from "@/lib/useProgressiveWaveform";
import type { JobRecord, VideoInfo } from "@/types";

export type TaskStatusMetaItem = {
  key: string;
  label: string;
  value: ReactNode;
  className?: string;
};

export type ProjectInformationProps = {
  mode: AppMode;
  runningTasks: TaskRegistryEntry[];
  failedTasks: TaskRegistryEntry[];
  latestTerminalTask: JobRecord | null;
  message: string;
  videoInfo: VideoInfo | null;
  scratchProxyState: ScratchProxyState;
  waveformPhase: ReturnType<typeof useProgressiveWaveform>["phase"];
  waveformProgress: number;
  modeMeta?: TaskStatusMetaItem[];
  onDismiss: (slot: TaskSlot) => void;
  onWaveformRetry: (() => void) | null;
};

/** Cut/Sub共通の情報導線。通常画面には進行・失敗だけを示し、詳細はDialogへ集約する。 */
export function ProjectInformation(props: ProjectInformationProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ProjectInformationTrigger
        runningCount={props.runningTasks.length}
        failedCount={props.failedTasks.length}
        onClick={() => setOpen(true)}
      />
      <ProjectInformationDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** 情報Dialogを開く共通ボタンへ、実行中または失敗中の件数だけを表示する。 */
export function ProjectInformationTrigger({
  runningCount,
  failedCount,
  onClick,
}: {
  runningCount: number;
  failedCount: number;
  onClick: () => void;
}) {
  return (
      <Button
        variant="secondary"
        className="project-information-trigger"
        aria-label={tr("status.information")}
        onClick={onClick}
      >
        {failedCount > 0 ? <CircleAlert size={16} /> : runningCount > 0 ? <LoaderCircle size={16} className="spin" /> : <Info size={16} />}
        {tr("status.information")}
        {failedCount > 0 ? (
          <span className="project-information-badge failed" aria-label={tr("status.failedCount", { count: failedCount })}>
            {failedCount}
          </span>
        ) : runningCount > 0 ? (
          <span className="project-information-badge running" aria-label={tr("status.runningCount", { count: runningCount })}>
            {runningCount}
          </span>
        ) : null}
      </Button>
  );
}

/** プロジェクトと準備状態の詳細を共通Dialogとして表示する。 */
export function ProjectInformationDialog({
  open,
  onClose,
  mode,
  runningTasks,
  failedTasks,
  latestTerminalTask,
  message,
  videoInfo,
  scratchProxyState,
  waveformPhase,
  waveformProgress,
  modeMeta = [],
  onDismiss,
  onWaveformRetry,
}: ProjectInformationProps & { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title={tr("status.informationTitle")} onClose={onClose} className="project-information-dialog">
      <ScrollArea className="project-information-scroll" viewportClassName="project-information-scroll-viewport">
        <ProjectInformationDetails
          mode={mode}
          runningTasks={runningTasks}
          failedTasks={failedTasks}
          latestTerminalTask={latestTerminalTask}
          message={message}
          videoInfo={videoInfo}
          scratchProxyState={scratchProxyState}
          waveformPhase={waveformPhase}
          waveformProgress={waveformProgress}
          modeMeta={modeMeta}
          onDismiss={onDismiss}
          onWaveformRetry={onWaveformRetry}
        />
      </ScrollArea>
      <div className="dialog-actions"><span /><Button onClick={onClose}>{tr("common.close")}</Button></div>
    </Dialog>
  );
}

/** Cut/Sub共通情報とモード固有情報をDialog本文のセクションへ整理する。 */
export function ProjectInformationDetails({
  mode,
  runningTasks,
  failedTasks,
  latestTerminalTask,
  message,
  videoInfo,
  scratchProxyState,
  waveformPhase,
  waveformProgress,
  modeMeta = [],
  onDismiss,
  onWaveformRetry,
}: ProjectInformationProps) {
  const uiMessage = localizeUiMessage(message);
  const latestTask = runningTasks.length === 0 && failedTasks.length === 0 ? latestTerminalTask : null;

  return (
    <div className="project-information-content">
        <InformationSection title={tr("status.project")}>
          <dl className="status-meta-grid" data-status-mode={mode}>
            <InformationItem label={tr("status.mode")} value={mode === "cut" ? "Cut" : "Sub"} />
            {videoInfo ? (
              <InformationItem
                label={tr("status.media")}
                value={`${formatTime(videoInfo.duration)} / ${videoInfo.video.width}x${videoInfo.video.height} / ${videoInfo.video.codec}`}
              />
            ) : null}
            {uiMessage ? <InformationItem label={tr("status.message")} value={uiMessage} /> : null}
          </dl>
        </InformationSection>

        <InformationSection title={tr("status.mediaPreparation")}>
          <dl className="status-meta-grid">
            <InformationItem
              label={tr("status.scratchAudio")}
              value={localizedScratchProxyStatusLabel(scratchProxyState)}
              dataScratchProxyStatus={scratchProxyState}
            />
            <InformationItem
              label={tr("status.waveform")}
              value={(
                <span className="waveform-information-value">
                  <span>{waveformStatusLabel(waveformPhase, waveformProgress)}</span>
                  {onWaveformRetry ? <Button size="sm" variant="secondary" onClick={onWaveformRetry}>{tr("controls.retryWaveform")}</Button> : null}
                </span>
              )}
              dataWaveformStatus={waveformPhase}
            />
          </dl>
        </InformationSection>

        {modeMeta.length ? (
          <InformationSection title={tr("status.modeInformation", { mode: mode === "cut" ? "Cut" : "Sub" })}>
            <dl className="status-meta-grid">
              {modeMeta.map((item) => (
                <InformationItem key={item.key} label={item.label} value={item.value} className={item.className} />
              ))}
            </dl>
          </InformationSection>
        ) : null}

        <InformationSection title={tr("status.backgroundTasks")}>
          {runningTasks.length ? <div className="task-status-list">{runningTasks.map((entry) => <TaskStatusRow key={entry.slot} entry={entry} />)}</div> : null}
          {failedTasks.length ? (
            <div className="task-status-list task-status-failures">
              {failedTasks.map((entry) => <TaskStatusRow key={entry.slot} entry={entry} onDismiss={() => onDismiss(entry.slot)} />)}
            </div>
          ) : null}
          {latestTask ? <LatestTask job={latestTask} /> : null}
          {!runningTasks.length && !failedTasks.length && !latestTask ? <p className="project-information-empty">{tr("status.noTasks")}</p> : null}
        </InformationSection>
    </div>
  );
}

function InformationSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="project-information-section"><h3>{title}</h3>{children}</section>;
}

function InformationItem({
  label,
  value,
  className,
  dataScratchProxyStatus,
  dataWaveformStatus,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  dataScratchProxyStatus?: string;
  dataWaveformStatus?: string;
}) {
  return (
    <div
      className={["status-meta-item", className].filter(Boolean).join(" ")}
      data-scratch-proxy-status={dataScratchProxyStatus}
      data-waveform-status={dataWaveformStatus}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LatestTask({ job }: { job: JobRecord }) {
  return (
    <div className={`task-status-row task-status-${job.status}`} data-latest-task="true">
      <div className="task-status-heading"><strong>{jobKindLabel(job.kind)}</strong><span>{localizeJobMessage(job)}</span></div>
      <span className="task-status-percent">{Math.round(clamp(job.progress, 0, 1) * 100)}%</span>
      <progress value={clamp(job.progress, 0, 1)} max={1} />
      {job.error ? <div className="task-status-error">{job.error}</div> : null}
    </div>
  );
}

function TaskStatusRow({ entry, onDismiss }: { entry: TaskRegistryEntry; onDismiss?: () => void }) {
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
      {onDismiss ? <Button size="sm" variant="ghost" onClick={onDismiss}>{tr("common.close")}</Button> : null}
      <progress value={clamp(job.progress, 0, 1)} max={1} />
      {job.error ? <div className="task-status-error">{job.error}</div> : null}
    </div>
  );
}

/** バックグラウンド処理の種別を現在の表示言語の名称へ変換する。 */
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
    case "streaming": return tr("app.waveformProgress", { progress: Math.round(clamp(progress, 0, 1) * 100) });
    case "finalizing": return tr("app.waveformFinalizing");
    case "ready": return tr("app.waveformReady");
    case "failed": return tr("app.waveformUnavailable");
    case "idle": return tr("app.waveformWaiting");
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
