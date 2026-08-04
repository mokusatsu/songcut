import { useCallback, useMemo, useState } from "react";

import type { JobRecord } from "@/types";

export type TaskSlot =
  | "waveform"
  | "scratch-proxy"
  | "analysis"
  | "lyrics-analysis"
  | "transcription"
  | "export"
  | "subtitle-export"
  | "subtitle-render"
  | "download-whisper"
  | "download-demucs"
  | "download-mms";

export type TaskRegistryState = Partial<Record<TaskSlot, JobRecord>>;
export type TaskRegistryEntry = { slot: TaskSlot; job: JobRecord };

const DISPLAY_PRIORITY: Record<TaskSlot, number> = {
  export: 600,
  "subtitle-export": 600,
  transcription: 500,
  analysis: 400,
  "lyrics-analysis": 400,
  "download-whisper": 300,
  "download-demucs": 300,
  "download-mms": 300,
  "subtitle-render": 250,
  waveform: 200,
  "scratch-proxy": 100
};

const BLOCKS_QUIT = new Set<TaskSlot>([
  "analysis",
  "lyrics-analysis",
  "transcription",
  "export",
  "subtitle-export",
  "download-whisper",
  "download-demucs",
  "download-mms",
]);
const BACKGROUND_TASKS = new Set<TaskSlot>(["waveform", "scratch-proxy", "subtitle-render"]);

export function isTaskRunning(job: JobRecord | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

export function createPendingTask(kind: string, message: string): JobRecord {
  const now = Date.now() / 1000;
  return {
    id: `starting-${kind}`,
    kind,
    status: "queued",
    progress: 0,
    message,
    created_at: now,
    updated_at: now,
  };
}

export function failTask(job: JobRecord, error: unknown, message: string): JobRecord {
  if (job.status === "failed" || job.status === "cancelled") return job;
  return {
    ...job,
    status: "failed",
    message,
    error: String(error),
    updated_at: Date.now() / 1000,
  };
}

function taskEntries(tasks: TaskRegistryState): TaskRegistryEntry[] {
  return (Object.entries(tasks) as [TaskSlot, JobRecord][])
    .filter((entry): entry is [TaskSlot, JobRecord] => Boolean(entry[1]))
    .map(([slot, job]) => ({ slot, job }));
}

function byRunningPriority(left: TaskRegistryEntry, right: TaskRegistryEntry) {
  return (
    DISPLAY_PRIORITY[right.slot] - DISPLAY_PRIORITY[left.slot] ||
    right.job.updated_at - left.job.updated_at
  );
}

function byMostRecentlyUpdated(left: TaskRegistryEntry, right: TaskRegistryEntry) {
  return right.job.updated_at - left.job.updated_at;
}

export function selectRunningTaskEntries(tasks: TaskRegistryState): TaskRegistryEntry[] {
  return taskEntries(tasks)
    .filter(({ job }) => isTaskRunning(job))
    .sort(byRunningPriority);
}

export function selectFailedTaskEntries(tasks: TaskRegistryState): TaskRegistryEntry[] {
  return taskEntries(tasks)
    .filter(({ job }) => job.status === "failed" || job.status === "cancelled")
    .sort(byMostRecentlyUpdated);
}

export function selectLatestTerminalTask(tasks: TaskRegistryState): JobRecord | null {
  const terminal = taskEntries(tasks).filter(({ job }) => !isTaskRunning(job));
  const foreground = terminal.filter(({ slot }) => !BACKGROUND_TASKS.has(slot));
  return (foreground.length ? foreground : terminal).sort(byMostRecentlyUpdated)[0]?.job ?? null;
}

export function selectActiveTask(tasks: TaskRegistryState): JobRecord | null {
  return selectRunningTaskEntries(tasks)[0]?.job ?? selectLatestTerminalTask(tasks);
}

export function selectBlockingTask(tasks: TaskRegistryState): JobRecord | null {
  return (
    taskEntries(tasks)
      .filter(({ slot, job }) => BLOCKS_QUIT.has(slot) && isTaskRunning(job))
      .sort(byRunningPriority)[0]?.job ?? null
  );
}

export function useTaskRegistry() {
  const [tasks, setTasks] = useState<TaskRegistryState>({});
  const updateTask = useCallback((slot: TaskSlot, job: JobRecord | null) => {
    setTasks((current) => {
      if (job === null) {
        if (!(slot in current)) return current;
        const next = { ...current };
        delete next[slot];
        return next;
      }
      if (current[slot] === job) return current;
      return { ...current, [slot]: job };
    });
  }, []);
  const clearTasks = useCallback((slots?: readonly TaskSlot[]) => {
    if (!slots) {
      setTasks({});
      return;
    }
    setTasks((current) => {
      const next = { ...current };
      for (const slot of slots) delete next[slot];
      return next;
    });
  }, []);
  const activeTask = useMemo(() => selectActiveTask(tasks), [tasks]);
  const blockingTask = useMemo(() => selectBlockingTask(tasks), [tasks]);
  const runningTaskEntries = useMemo(() => selectRunningTaskEntries(tasks), [tasks]);
  const failedTaskEntries = useMemo(() => selectFailedTaskEntries(tasks), [tasks]);
  const latestTerminalTask = useMemo(() => selectLatestTerminalTask(tasks), [tasks]);
  const runningTasks = useMemo(() => runningTaskEntries.map(({ job }) => job), [runningTaskEntries]);

  return {
    tasks,
    updateTask,
    clearTasks,
    activeTask,
    blockingTask,
    runningTasks,
    runningTaskEntries,
    failedTaskEntries,
    latestTerminalTask,
  };
}
