/** 行再解析の固定debounce。仕様値のため設定化しない。 */
export const LINE_REANALYSIS_DELAY_MILLISECONDS = 10_000;

export type LineReanalysisStatus =
  | "idle"
  | "waiting"
  | "running"
  | "cancelling"
  | "stale"
  | "conflict"
  | "failed";

export type LineReanalysisState<TPayload> = {
  projectEpoch: number;
  rowId: string;
  lineRevision: number;
  displayElementRevision: number;
  needsReanalysis: boolean;
  payload: TPayload;
};

export type ScheduledLineReanalysis<TPayload> = LineReanalysisState<TPayload> & {
  reanalysisEpoch: number;
};

export type LineReanalysisResult<TResult> = {
  projectEpoch: number;
  rowId: string;
  lineRevision: number;
  displayElementRevision: number;
  reanalysisEpoch: number;
  value: TResult;
};

export type LineReanalysisStartContext = {
  signal: AbortSignal;
  registerJobId: (jobId: string) => void;
};

export type LineReanalysisCallbacks<TPayload, TResult> = {
  capture: (rowId: string) => LineReanalysisState<TPayload> | null;
  start: (
    snapshot: ScheduledLineReanalysis<TPayload>,
    context: LineReanalysisStartContext,
  ) => Promise<LineReanalysisResult<TResult>>;
  cancelJob: (jobId: string) => Promise<unknown>;
  apply: (
    snapshot: ScheduledLineReanalysis<TPayload>,
    result: TResult,
  ) => "idle" | "conflict";
  onStatus?: (rowId: string, status: LineReanalysisStatus, error?: string) => void;
};

type Entry<TPayload> = {
  epoch: number;
  editing: boolean;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  abortController: AbortController | null;
  jobId: string | null;
  snapshot: ScheduledLineReanalysis<TPayload> | null;
  status: LineReanalysisStatus;
};

/**
 * 行IDごとにtimer/job/epochを分離し、同じ行だけをreplace-cancelする。
 * selectionやmode変更はこのclassへ通知しないため、別行を含む予約は維持される。
 */
export class LineReanalysisCoordinator<TPayload, TResult> {
  private readonly entries = new Map<string, Entry<TPayload>>();

  constructor(private readonly callbacks: LineReanalysisCallbacks<TPayload, TResult>) {}

  /** 本文focusまたは境界pointer-downで、同一行の旧予約・jobを破棄する。 */
  enter(rowId: string): void {
    const entry = this.entry(rowId);
    const current = this.callbacks.capture(rowId);
    entry.dirty = entry.dirty || Boolean(current?.needsReanalysis);
    entry.editing = true;
    this.cancelPrevious(rowId, entry);
  }

  /** 本文または行境界が実際に確定変更された後、最新snapshotを10秒予約する。 */
  commit(rowId: string): void {
    const entry = this.entry(rowId);
    entry.editing = false;
    entry.dirty = true;
    this.cancelPrevious(rowId, entry);
    this.schedule(rowId, entry);
  }

  /** 表示素手動制約を更新し、既存dirty行だけを最新制約で再予約する。 */
  manualConstraintChanged(rowId: string): void {
    const entry = this.entry(rowId);
    entry.editing = false;
    const current = this.callbacks.capture(rowId);
    entry.dirty = entry.dirty || Boolean(current?.needsReanalysis);
    this.cancelPrevious(rowId, entry);
    if (entry.dirty) this.schedule(rowId, entry);
    else this.setStatus(rowId, entry, "idle");
  }

  /** Escape・pointer-cancel・無変更blur。既存dirtyだけは新たに10秒予約する。 */
  exitWithoutChange(rowId: string): void {
    const entry = this.entry(rowId);
    entry.editing = false;
    const current = this.callbacks.capture(rowId);
    entry.dirty = entry.dirty || Boolean(current?.needsReanalysis);
    if (entry.dirty) this.schedule(rowId, entry);
    else this.setStatus(rowId, entry, "idle");
  }

  /** 行削除時だけ、その行の予約・jobを破棄する。 */
  remove(rowId: string): void {
    const entry = this.entries.get(rowId);
    if (entry === undefined) return;
    this.cancelPrevious(rowId, entry);
    this.entries.delete(rowId);
    this.callbacks.onStatus?.(rowId, "idle");
  }

  /** Project/音源変更またはapp終了時に全行を破棄する。 */
  cancelAll(): void {
    for (const [rowId, entry] of this.entries) this.cancelPrevious(rowId, entry);
    this.entries.clear();
  }

  /** React unmount時にstatus callbackを発生させず全resourceを破棄する。 */
  dispose(): void {
    for (const [rowId, entry] of this.entries) this.cancelPrevious(rowId, entry, true);
    this.entries.clear();
  }

  /** 現在存在しない行だけを破棄する。selection変更には使用しない。 */
  retainRows(rowIds: ReadonlySet<string>): void {
    for (const rowId of this.entries.keys()) {
      if (!rowIds.has(rowId)) this.remove(rowId);
    }
  }

  getStatus(rowId: string): LineReanalysisStatus {
    return this.entries.get(rowId)?.status ?? "idle";
  }

  private entry(rowId: string): Entry<TPayload> {
    const existing = this.entries.get(rowId);
    if (existing !== undefined) return existing;
    const created: Entry<TPayload> = {
      epoch: 0,
      editing: false,
      dirty: false,
      timer: null,
      abortController: null,
      jobId: null,
      snapshot: null,
      status: "idle",
    };
    this.entries.set(rowId, created);
    return created;
  }

  private cancelPrevious(rowId: string, entry: Entry<TPayload>, silent = false): void {
    entry.epoch += 1;
    const hadTimer = entry.timer !== null;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const hadActiveRequest = entry.abortController !== null;
    entry.abortController?.abort();
    entry.abortController = null;
    entry.snapshot = null;
    const jobId = entry.jobId;
    entry.jobId = null;
    if (jobId !== null) {
      if (silent) entry.status = "cancelling";
      else this.setStatus(rowId, entry, "cancelling");
      void this.callbacks.cancelJob(jobId).catch(() => undefined);
    } else if (hadActiveRequest) {
      if (silent) entry.status = "cancelling";
      else this.setStatus(rowId, entry, "cancelling");
    } else if (hadTimer) {
      if (silent) entry.status = "idle";
      else this.setStatus(rowId, entry, "idle");
    }
  }

  private schedule(rowId: string, entry: Entry<TPayload>): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    const current = this.callbacks.capture(rowId);
    if (current === null || !current.needsReanalysis) {
      entry.dirty = false;
      this.setStatus(rowId, entry, "idle");
      return;
    }
    const snapshot: ScheduledLineReanalysis<TPayload> = {
      ...current,
      reanalysisEpoch: entry.epoch,
    };
    entry.snapshot = snapshot;
    this.setStatus(rowId, entry, "waiting");
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.startIfCurrent(rowId, entry, snapshot);
    }, LINE_REANALYSIS_DELAY_MILLISECONDS);
  }

  private async startIfCurrent(
    rowId: string,
    entry: Entry<TPayload>,
    snapshot: ScheduledLineReanalysis<TPayload>,
  ): Promise<void> {
    if (entry.editing || entry.epoch !== snapshot.reanalysisEpoch) return;
    const current = this.callbacks.capture(rowId);
    if (current === null || !this.sameState(current, snapshot) || !current.needsReanalysis) {
      this.setStatus(rowId, entry, "stale");
      return;
    }
    const controller = new AbortController();
    entry.abortController = controller;
    this.setStatus(rowId, entry, "running");
    try {
      const result = await this.callbacks.start(snapshot, {
        signal: controller.signal,
        registerJobId: (jobId) => {
          if (entry.epoch !== snapshot.reanalysisEpoch || controller.signal.aborted) {
            void this.callbacks.cancelJob(jobId).catch(() => undefined);
            return;
          }
          entry.jobId = jobId;
        },
      });
      if (controller.signal.aborted || entry.epoch !== snapshot.reanalysisEpoch) return;
      if (!this.sameResultGuard(result, snapshot)) {
        this.setStatus(rowId, entry, "stale");
        return;
      }
      const latest = this.callbacks.capture(rowId);
      if (latest === null || !this.sameState(latest, snapshot)) {
        this.setStatus(rowId, entry, "stale");
        return;
      }
      entry.dirty = false;
      const status = this.callbacks.apply(snapshot, result.value);
      this.setStatus(rowId, entry, status);
    } catch (error) {
      if (controller.signal.aborted || entry.epoch !== snapshot.reanalysisEpoch) return;
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError") return;
      this.setStatus(
        rowId,
        entry,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (entry.epoch === snapshot.reanalysisEpoch) {
        entry.abortController = null;
        entry.jobId = null;
        entry.snapshot = null;
      }
    }
  }

  private sameState(
    current: LineReanalysisState<TPayload>,
    snapshot: ScheduledLineReanalysis<TPayload>,
  ): boolean {
    return current.projectEpoch === snapshot.projectEpoch
      && current.rowId === snapshot.rowId
      && current.lineRevision === snapshot.lineRevision
      && current.displayElementRevision === snapshot.displayElementRevision;
  }

  private sameResultGuard(
    result: LineReanalysisResult<TResult>,
    snapshot: ScheduledLineReanalysis<TPayload>,
  ): boolean {
    return result.projectEpoch === snapshot.projectEpoch
      && result.rowId === snapshot.rowId
      && result.lineRevision === snapshot.lineRevision
      && result.displayElementRevision === snapshot.displayElementRevision
      && result.reanalysisEpoch === snapshot.reanalysisEpoch;
  }

  private setStatus(
    rowId: string,
    entry: Entry<TPayload>,
    status: LineReanalysisStatus,
    error?: string,
  ): void {
    entry.status = status;
    this.callbacks.onStatus?.(rowId, status, error);
  }
}
