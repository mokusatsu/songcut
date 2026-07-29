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
  | "download-whisper"
  | "download-demucs";

export type TaskRegistryState = Partial<Record<TaskSlot, JobRecord>>;

const DISPLAY_PRIORITY: Record<TaskSlot, number> = {
  export: 600,
  "subtitle-export": 600,
  transcription: 500,
  analysis: 400,
  "lyrics-analysis": 400,
  "download-whisper": 300,
  "download-demucs": 300,
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
]);

export function isTaskRunning(job: JobRecord | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

export function selectActiveTask(tasks: TaskRegistryState): JobRecord | null {
  const entries = (Object.entries(tasks) as [TaskSlot, JobRecord][]).filter(([, job]) => job);
  const running = entries
    .filter(([, job]) => isTaskRunning(job))
    .sort(([left], [right]) => DISPLAY_PRIORITY[right] - DISPLAY_PRIORITY[left]);
  if (running[0]) return running[0][1];
  const terminal = entries.sort(([left], [right]) => DISPLAY_PRIORITY[right] - DISPLAY_PRIORITY[left]);
  return terminal[0]?.[1] ?? null;
}

export function selectBlockingTask(tasks: TaskRegistryState): JobRecord | null {
  const entries = Object.entries(tasks) as [TaskSlot, JobRecord][];
  return (
    entries
      .filter(([slot, job]) => BLOCKS_QUIT.has(slot) && isTaskRunning(job))
      .sort(([left], [right]) => DISPLAY_PRIORITY[right] - DISPLAY_PRIORITY[left])[0]?.[1] ?? null
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
  const runningTasks = useMemo(
    () => (Object.values(tasks) as JobRecord[]).filter((job) => isTaskRunning(job)),
    [tasks]
  );

  return { tasks, updateTask, clearTasks, activeTask, blockingTask, runningTasks };
}
