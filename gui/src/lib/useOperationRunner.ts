import { useRef } from "react";

import type {
  ProjectOperation,
  ProjectOperationKind,
  ProjectOperationRecord,
} from "@/lib/project";
import {
  createPendingTask,
  failTask,
  type TaskSlot,
} from "@/lib/useTaskRegistry";
import type { JobRecord } from "@/types";

/**
 * The part of an operation document that is known before a backend job starts.
 * The runner supplies the `running` status and keeps mode-specific result data
 * outside of the lifecycle itself.
 */
type OperationRecordFor<K extends ProjectOperationKind> = Extract<ProjectOperationRecord, { kind: K }>;

export type OperationDescriptorFor<K extends ProjectOperationKind> = Omit<OperationRecordFor<K>, "status">;

export type OperationDescriptor = {
  [K in ProjectOperationKind]: OperationDescriptorFor<K>;
}[ProjectOperationKind];

export type OperationRunnerCallbacks = {
  updateTask: (slot: TaskSlot, job: JobRecord | null) => void;
  setProjectOperation: (
    next:
      | ProjectOperation
      | ((current: ProjectOperation) => ProjectOperation),
  ) => void;
  markProjectChanged?: () => void;
};

type OperationLifecycleCallbacks<TResult> = {
  pendingMessage: string;
  failureMessage: string;
  start: () => Promise<JobRecord>;
  poll: (jobId: string, onProgress: (job: JobRecord) => void) => Promise<TResult>;
  /** Applies the mode-specific result. Returning an operation preserves it. */
  onSuccess?: (result: TResult) => void | ProjectOperation | Promise<void | ProjectOperation>;
  /** Receives progress jobs after they are registered in the task registry. */
  onProgress?: (job: JobRecord) => void;
  /** Keep an operation written by `onSuccess` instead of clearing by default. */
  clearOperationOnSuccess?: boolean;
};

export type OperationIdentity = {
  [K in ProjectOperationKind]: {
    slot: K;
    operation: OperationDescriptorFor<K>;
  };
}[ProjectOperationKind];

export type OperationLifecycleOptions<TResult> = OperationLifecycleCallbacks<TResult> & OperationIdentity;

export type OperationRunner = {
  run: <TResult>(options: OperationLifecycleOptions<TResult>) => Promise<TResult | undefined>;
  isRunning: (slot?: ProjectOperationKind) => boolean;
};

type RunnerState = {
  activeSlots: Set<ProjectOperationKind>;
};

function setOperationStatus(
  operation: OperationDescriptor,
  status: "running" | "interrupted",
): ProjectOperation {
  return { ...operation, status } as ProjectOperationRecord;
}

/**
 * Execute one foreground job lifecycle while leaving API calls and result
 * application with the caller. This pure runner is shared by Cut and Sub and
 * is deliberately easy to drive with fake start/poll functions in tests.
 */
/** `runOperationLifecycle`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
export async function runOperationLifecycle<TResult>(
  options: OperationLifecycleOptions<TResult>,
  callbacks: OperationRunnerCallbacks,
  state: RunnerState = { activeSlots: new Set<ProjectOperationKind>() },
): Promise<TResult | undefined> {
  // A project document records one foreground operation. Do not let another
  // slot overwrite its running/interrupted state while the first job polls.
  if (state.activeSlots.size > 0) return undefined;
  state.activeSlots.add(options.slot);

  let trackedJob = createPendingTask(options.operation.kind, options.pendingMessage);
  try {
    callbacks.updateTask(options.slot, trackedJob);
    callbacks.setProjectOperation(setOperationStatus(options.operation, "running"));
    callbacks.markProjectChanged?.();

    const started = await options.start();
    trackedJob = started;
    callbacks.updateTask(options.slot, started);

    const result = await options.poll(started.id, (nextJob) => {
      trackedJob = nextJob;
      callbacks.updateTask(options.slot, nextJob);
      options.onProgress?.(nextJob);
    });

    const requestedOperation = await options.onSuccess?.(result);
    if (requestedOperation !== undefined) {
      callbacks.setProjectOperation(requestedOperation);
      callbacks.markProjectChanged?.();
    } else if (options.clearOperationOnSuccess !== false) {
      callbacks.setProjectOperation(null);
      callbacks.markProjectChanged?.();
    }
    return result;
  } catch (error) {
    callbacks.updateTask(options.slot, failTask(trackedJob, error, options.failureMessage));
    callbacks.setProjectOperation((current) =>
      current?.kind === options.operation.kind
        ? { ...current, status: "interrupted" }
        : current ?? setOperationStatus(options.operation, "interrupted"),
    );
    callbacks.markProjectChanged?.();
    throw error;
  } finally {
    state.activeSlots.delete(options.slot);
  }
}

/** Create a runner with a shared per-slot duplicate-start guard. */
/** `createOperationRunner`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createOperationRunner(callbacks: OperationRunnerCallbacks): OperationRunner {
  const state: RunnerState = { activeSlots: new Set<ProjectOperationKind>() };
  return {
    run: (options) => runOperationLifecycle(options, callbacks, state),
    isRunning: (slot) => (slot ? state.activeSlots.has(slot) : state.activeSlots.size > 0),
  };
}

/** React adapter; callback refs keep one duplicate-start guard for the view. */
/** `useOperationRunner`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useOperationRunner(callbacks: OperationRunnerCallbacks): OperationRunner {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const runnerRef = useRef<OperationRunner | null>(null);
  if (!runnerRef.current) {
    runnerRef.current = createOperationRunner({
      updateTask: (...args) => callbacksRef.current.updateTask(...args),
      setProjectOperation: (...args) => callbacksRef.current.setProjectOperation(...args),
      markProjectChanged: () => callbacksRef.current.markProjectChanged?.(),
    });
  }
  return runnerRef.current;
}
