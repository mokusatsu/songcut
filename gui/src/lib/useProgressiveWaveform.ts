import { useCallback, useEffect, useRef, useState } from "react";

import { cancelOrReleaseWaveform, getWaveformUpdates, startWaveform } from "@/lib/api";
import type { JobRecord, WaveformMetadata, WaveformPoint, WaveformUpdate } from "@/types";
import { tr } from "@/i18n";

export type WaveformPhase = "idle" | "streaming" | "finalizing" | "ready" | "failed";

export type ProgressiveWaveformState = {
  phase: WaveformPhase;
  sourcePath: string;
  waveform: WaveformPoint[];
  chunks: WaveformPoint[][];
  progress: number;
  message: string;
  error: string | null;
  metadata: WaveformMetadata | null;
  generated: boolean;
};

const EMPTY_STATE: ProgressiveWaveformState = {
  phase: "idle",
  sourcePath: "",
  waveform: [],
  chunks: [],
  progress: 0,
  message: "",
  error: null,
  metadata: null,
  generated: false
};

export function useProgressiveWaveform(
  baseUrl: string,
  onJobUpdate: (job: JobRecord | null) => void,
  onCompleted: (sourcePath: string, points: WaveformPoint[], metadata: WaveformMetadata) => void
) {
  const [state, setState] = useState<ProgressiveWaveformState>(EMPTY_STATE);
  const generationRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  const baseUrlRef = useRef(baseUrl);
  const onJobUpdateRef = useRef(onJobUpdate);
  const onCompletedRef = useRef(onCompleted);
  baseUrlRef.current = baseUrl;
  onJobUpdateRef.current = onJobUpdate;
  onCompletedRef.current = onCompleted;

  const cancelActive = useCallback((clearState: boolean) => {
    generationRef.current += 1;
    const jobId = jobIdRef.current;
    jobIdRef.current = null;
    if (jobId && baseUrlRef.current) {
      void cancelOrReleaseWaveform(baseUrlRef.current, jobId).catch(() => undefined);
    }
    onJobUpdateRef.current(null);
    if (clearState) setState(EMPTY_STATE);
  }, []);

  const showCached = useCallback(
    (sourcePath: string, points: WaveformPoint[], metadata: WaveformMetadata | null = null) => {
      cancelActive(false);
      setState({
        phase: points.length ? "ready" : "idle",
        sourcePath,
        waveform: points.map((point) => ({ ...point })),
        chunks: [],
        progress: points.length ? 1 : 0,
        message: points.length ? tr("messages.waveformReady") : "",
        error: null,
        metadata,
        generated: false
      });
    },
    [cancelActive]
  );

  const start = useCallback(
    async (sourcePath: string) => {
      cancelActive(false);
      const generation = generationRef.current;
      const allPoints: WaveformPoint[] = [];
      setState({
        phase: "streaming",
        sourcePath,
        waveform: [],
        chunks: [],
        progress: 0,
        message: tr("messages.waveformPreparing"),
        error: null,
        metadata: null,
        generated: true
      });
      let started: JobRecord | null = null;
      try {
        if (!baseUrlRef.current) throw new Error("songcut API is unavailable");
        started = await startWaveform(baseUrlRef.current, sourcePath);
        if (generationRef.current !== generation) {
          await cancelOrReleaseWaveform(baseUrlRef.current, started.id).catch(() => undefined);
          return;
        }
        jobIdRef.current = started.id;
        onJobUpdateRef.current(started);
        let cursor = 0;
        for (;;) {
          const update = await getWaveformUpdates(baseUrlRef.current, started.id, cursor);
          if (generationRef.current !== generation) return;
          cursor = update.cursor;
          if (update.points.length) {
            allPoints.push(...update.points);
            const renderChunks = chunkPoints(update.points, 256);
            setState((current) =>
              current.sourcePath === sourcePath
                ? {
                    ...current,
                    chunks: [...current.chunks, ...renderChunks],
                    progress: update.progress,
                    message: update.message
                  }
                : current
            );
          } else {
            setState((current) =>
              current.sourcePath === sourcePath
                ? { ...current, progress: update.progress, message: update.message }
                : current
            );
          }
          onJobUpdateRef.current(jobFromWaveformUpdate(started, update));
          if (update.has_more) continue;
          if (update.status === "failed") throw new Error(update.error || "waveform generation failed");
          if (update.status === "cancelled") return;
          if (update.status === "completed") {
            if (!update.metadata) throw new Error("waveform metadata is missing");
            validateCompletedWaveform(allPoints, update.metadata);
            setState((current) =>
              current.sourcePath === sourcePath
                ? {
                    ...current,
                    phase: "finalizing",
                    waveform: allPoints,
                    progress: 1,
                    message: tr("messages.waveformFinalizing"),
                    metadata: update.metadata
                  }
                : current
            );
            await nextAnimationFrame();
            await new Promise((resolve) => window.setTimeout(resolve, 140));
            if (generationRef.current !== generation) return;
            setState((current) =>
              current.sourcePath === sourcePath
                ? { ...current, phase: "ready", chunks: [], message: tr("messages.waveformReady") }
                : current
            );
            onCompletedRef.current(sourcePath, allPoints, update.metadata);
            await cancelOrReleaseWaveform(baseUrlRef.current, started.id).catch(() => undefined);
            jobIdRef.current = null;
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 200));
        }
      } catch (error) {
        if (generationRef.current !== generation) return;
        const message = String(error);
        setState((current) =>
          current.sourcePath === sourcePath
            ? { ...current, phase: "failed", progress: 1, message: tr("messages.waveformUnavailable"), error: message }
            : current
        );
        if (started) {
          onJobUpdateRef.current({
            ...started,
            status: "failed",
            progress: 1,
            message: tr("messages.waveformUnavailable"),
            error: message,
            updated_at: Date.now() / 1000
          });
        }
      }
    },
    [cancelActive]
  );

  useEffect(() => () => cancelActive(false), [cancelActive]);

  return {
    ...state,
    start,
    showCached,
    clear: () => cancelActive(true),
    cancel: () => cancelActive(false)
  };
}

function chunkPoints(points: WaveformPoint[], size: number) {
  const chunks: WaveformPoint[][] = [];
  for (let index = 0; index < points.length; index += size) chunks.push(points.slice(index, index + size));
  return chunks;
}

function jobFromWaveformUpdate(started: JobRecord, update: WaveformUpdate): JobRecord {
  return {
    ...started,
    status: update.status,
    progress: update.progress,
    message: update.message,
    message_code: update.message_code,
    message_args: update.message_args,
    error: update.error,
    result: update.metadata,
    updated_at: Date.now() / 1000
  };
}

function validateCompletedWaveform(points: WaveformPoint[], metadata: WaveformMetadata) {
  if (points.length !== metadata.point_count) throw new Error("waveform point count does not match its metadata");
  if (points.length > 21_600) throw new Error("waveform exceeds the supported point limit");
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point.t) || point.t < 0 || point.t > metadata.duration + 0.05) {
      throw new Error("waveform contains an invalid timestamp");
    }
    if (index > 0 && point.t <= points[index - 1].t) throw new Error("waveform timestamps are not increasing");
  }
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}
