import { useEffect, useRef, useState } from "react";

import { tr } from "@/i18n";
import {
  getDemucsStatus,
  getMmsStatus,
  getWhisperStatus,
  startDemucsDownload,
  startMmsDownload,
  startWhisperDownload,
  waitForJob,
  type DemucsStatus,
  type MmsStatus,
  type WhisperModelKey,
  type WhisperStatus,
} from "@/lib/api";
import { createPendingTask, failTask, type TaskSlot } from "@/lib/useTaskRegistry";
import type { JobRecord } from "@/types";

type EnsureOptions = { showReadyState?: boolean };

type ModelDownloadConfig<TStatus> = {
  taskSlot: TaskSlot;
  taskKind: string;
  readyJobId: string;
  startingJobId: string;
  preparingMessage: string;
  failedMessage: string;
  completeMessage: string;
  showReadyState: boolean;
  fetchStatus: () => Promise<TStatus>;
  isReady: (status: TStatus) => boolean;
  createReadyResult: (status: TStatus) => Record<string, unknown>;
  startDownload: () => Promise<JobRecord>;
  waitForDownload: (job: JobRecord, onProgress: (job: JobRecord) => void) => Promise<JobRecord>;
  afterDownload?: () => Promise<void> | void;
  updateTask: (slot: TaskSlot, job: JobRecord | null) => void;
  openDialog: () => void;
  onReady?: () => void;
};

export type ModelPreparationServices = {
  getWhisperStatus: typeof getWhisperStatus;
  getDemucsStatus: typeof getDemucsStatus;
  getMmsStatus: typeof getMmsStatus;
  startWhisperDownload: typeof startWhisperDownload;
  startDemucsDownload: typeof startDemucsDownload;
  startMmsDownload: typeof startMmsDownload;
  waitForJob: typeof waitForJob;
};

const defaultServices: ModelPreparationServices = {
  getWhisperStatus,
  getDemucsStatus,
  getMmsStatus,
  startWhisperDownload,
  startDemucsDownload,
  startMmsDownload,
  waitForJob,
};

/**
 * 一つのモデルについて、準備済み判定、download、進捗反映、失敗反映を同じ順序で実行する。
 */
export async function runModelDownload<TStatus>(config: ModelDownloadConfig<TStatus>): Promise<void> {
  let trackedJob = createPendingTask(config.taskKind, config.preparingMessage);
  const trackDownload = (job: JobRecord) => {
    trackedJob = job;
    config.updateTask(config.taskSlot, job);
  };

  try {
    const currentStatus = await config.fetchStatus();
    if (config.isReady(currentStatus)) {
      if (config.showReadyState) {
        const now = Date.now() / 1000;
        trackDownload({
          id: config.readyJobId,
          kind: config.taskKind,
          status: "completed",
          progress: 1,
          message: config.completeMessage,
          result: config.createReadyResult(currentStatus),
          created_at: now,
          updated_at: now,
        });
        config.openDialog();
        config.onReady?.();
      }
      return;
    }

    const now = Date.now() / 1000;
    config.openDialog();
    trackDownload({
      id: config.startingJobId,
      kind: config.taskKind,
      status: "queued",
      progress: 0,
      message: config.preparingMessage,
      created_at: now,
      updated_at: now,
    });
    const started = await config.startDownload();
    trackDownload(started);
    await config.waitForDownload(started, trackDownload);
    await config.afterDownload?.();
  } catch (error) {
    config.openDialog();
    trackDownload(failTask(trackedJob, error, config.failedMessage));
    throw error;
  }
}

export type UseModelPreparationOptions = {
  apiBaseUrl: string;
  whisperModel: WhisperModelKey;
  updateTask: (slot: TaskSlot, job: JobRecord | null) => void;
  onMessage: (message: string) => void;
  services?: ModelPreparationServices;
};

/**
 * Whisper、Demucs、MMSの状態取得とdownload lifecycle、dialog表示状態を所有する。
 */
export function useModelPreparation(options: UseModelPreparationOptions) {
  const services = options.services ?? defaultServices;
  const whisperPromiseRef = useRef<Promise<void> | null>(null);
  const demucsPromiseRef = useRef<Promise<void> | null>(null);
  const mmsPromiseRef = useRef<Promise<void> | null>(null);
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus | null>(null);
  const [demucsStatus, setDemucsStatus] = useState<DemucsStatus | null>(null);
  const [mmsStatus, setMmsStatus] = useState<MmsStatus | null>(null);
  const [whisperPreflightOpen, setWhisperPreflightOpen] = useState(false);
  const [whisperDownloadOpen, setWhisperDownloadOpen] = useState(false);
  const [demucsDownloadOpen, setDemucsDownloadOpen] = useState(false);
  const [mmsDownloadOpen, setMmsDownloadOpen] = useState(false);

  /** `refreshWhisperStatus`でmodel状態を再取得し、未準備なら重複を抑止してdownloadする。 */
  async function refreshWhisperStatus() {
    if (!options.apiBaseUrl) return null;
    const status = await services.getWhisperStatus(options.apiBaseUrl);
    setWhisperStatus(status);
    return status;
  }

  /** `refreshDemucsStatus`でmodel状態を再取得し、未準備なら重複を抑止してdownloadする。 */
  async function refreshDemucsStatus() {
    if (!options.apiBaseUrl) return null;
    const status = await services.getDemucsStatus(options.apiBaseUrl);
    setDemucsStatus(status);
    return status;
  }

  /** `refreshMmsStatus`でmodel状態を再取得し、未準備なら重複を抑止してdownloadする。 */
  async function refreshMmsStatus() {
    if (!options.apiBaseUrl) return null;
    const status = await services.getMmsStatus(options.apiBaseUrl);
    setMmsStatus(status);
    return status;
  }

  useEffect(() => {
    if (!options.apiBaseUrl) return;
    void refreshWhisperStatus().catch((error) => options.onMessage(`Whisper status unavailable: ${String(error)}`));
    void refreshDemucsStatus().catch((error) => options.onMessage(`Demucs status unavailable: ${String(error)}`));
    void refreshMmsStatus().catch((error) => options.onMessage(`MMS status unavailable: ${String(error)}`));
  }, [options.apiBaseUrl]);

  /** `runExclusive`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  function runExclusive(ref: { current: Promise<void> | null }, operation: () => Promise<void>) {
    if (ref.current) return ref.current;
    const promise = operation().finally(() => {
      ref.current = null;
    });
    ref.current = promise;
    return promise;
  }

  /** `ensureWhisper`でmodel状態を再取得し、未準備なら重複を抑止してdownloadする。 */
  function ensureWhisper(ensureOptions: EnsureOptions = {}) {
    if (!options.apiBaseUrl) return Promise.resolve();
    const modelKey = options.whisperModel;
    return runExclusive(whisperPromiseRef, () => runModelDownload({
      taskSlot: "download-whisper",
      taskKind: "download-whisper",
      readyJobId: "already-ready",
      startingJobId: "starting",
      preparingMessage: tr("dialogs.whisperDownloadPreparing"),
      failedMessage: tr("dialogs.whisperDownloadFailed"),
      completeMessage: tr("dialogs.whisperDownloadComplete"),
      showReadyState: Boolean(ensureOptions.showReadyState),
      fetchStatus: refreshWhisperStatus,
      isReady: (status) => Boolean(status?.models.find((model) => model.key === modelKey)?.ready),
      createReadyResult: (status) => {
        const model = status?.models.find((item) => item.key === modelKey);
        const installedBytes = model?.installed_bytes ?? null;
        return {
          model: model?.key,
          model_dir: model?.model_dir,
          source: model?.source,
          installed_bytes: installedBytes,
          downloaded_bytes: installedBytes,
          total_bytes: installedBytes,
        };
      },
      startDownload: () => services.startWhisperDownload(options.apiBaseUrl, modelKey),
      waitForDownload: (job, onProgress) => services.waitForJob(options.apiBaseUrl, job.id, onProgress, 250),
      afterDownload: async () => {
        await refreshWhisperStatus();
        options.onMessage(`Whisper ${modelKey} model is ready.`);
      },
      updateTask: options.updateTask,
      openDialog: () => setWhisperDownloadOpen(true),
      onReady: () => options.onMessage(`Whisper ${modelKey} model is ready.`),
    }));
  }

  /** `ensureDemucs`でmodel状態を再取得し、未準備なら重複を抑止してdownloadする。 */
  function ensureDemucs(ensureOptions: EnsureOptions = {}) {
    if (!options.apiBaseUrl) return Promise.resolve();
    return runExclusive(demucsPromiseRef, () => runModelDownload({
      taskSlot: "download-demucs",
      taskKind: "download-demucs",
      readyJobId: "already-ready-demucs",
      startingJobId: "starting-demucs",
      preparingMessage: tr("dialogs.demucsDownloadPreparing"),
      failedMessage: tr("dialogs.demucsDownloadFailed"),
      completeMessage: tr("dialogs.demucsDownloadComplete"),
      showReadyState: Boolean(ensureOptions.showReadyState),
      fetchStatus: refreshDemucsStatus,
      isReady: (status) => Boolean(status?.ready),
      createReadyResult: (status) => ({
        model: status?.model,
        model_dir: status?.model_dir,
        source: status?.source,
        installed_bytes: status?.installed_bytes,
        downloaded_bytes: status?.installed_bytes,
        total_bytes: status?.installed_bytes,
      }),
      startDownload: () => services.startDemucsDownload(options.apiBaseUrl),
      waitForDownload: (job, onProgress) => services.waitForJob(options.apiBaseUrl, job.id, onProgress, 250),
      afterDownload: async () => {
        await refreshDemucsStatus();
      },
      updateTask: options.updateTask,
      openDialog: () => setDemucsDownloadOpen(true),
    }));
  }

  /** `ensureMms`でmodel状態を再取得し、未準備なら重複を抑止してdownloadする。 */
  function ensureMms(ensureOptions: EnsureOptions = {}) {
    if (!options.apiBaseUrl) return Promise.resolve();
    return runExclusive(mmsPromiseRef, () => runModelDownload({
      taskSlot: "download-mms",
      taskKind: "download-mms",
      readyJobId: "already-ready-mms",
      startingJobId: "starting-mms",
      preparingMessage: tr("dialogs.mmsDownloadPreparing"),
      failedMessage: tr("dialogs.mmsDownloadFailed"),
      completeMessage: tr("dialogs.mmsDownloadComplete"),
      showReadyState: Boolean(ensureOptions.showReadyState),
      fetchStatus: refreshMmsStatus,
      isReady: (status) => Boolean(status?.ready),
      createReadyResult: (status) => ({
        model: status?.model,
        model_dir: status?.model_dir,
        source: status?.source,
        installed_bytes: status?.installed_bytes,
        downloaded_bytes: status?.installed_bytes,
        total_bytes: status?.installed_bytes,
      }),
      startDownload: () => services.startMmsDownload(options.apiBaseUrl),
      waitForDownload: (job, onProgress) => services.waitForJob(options.apiBaseUrl, job.id, onProgress, 250),
      afterDownload: async () => {
        await refreshMmsStatus();
      },
      updateTask: options.updateTask,
      openDialog: () => setMmsDownloadOpen(true),
    }));
  }

  return {
    whisperStatus,
    demucsStatus,
    mmsStatus,
    whisperPreflightOpen,
    setWhisperPreflightOpen,
    whisperDownloadOpen,
    setWhisperDownloadOpen,
    demucsDownloadOpen,
    setDemucsDownloadOpen,
    mmsDownloadOpen,
    setMmsDownloadOpen,
    refreshWhisperStatus,
    ensureWhisper,
    ensureDemucs,
    ensureMms,
  };
}
