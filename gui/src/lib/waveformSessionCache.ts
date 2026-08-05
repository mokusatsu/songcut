import { WAVEFORM_BINARY_ENCODING, WAVEFORM_BINARY_MAX_POINTS } from "../../electron/waveform-codec";
import type { WaveformMetadata, WaveformPoint } from "@/types";

/** The generator used by the progressive waveform endpoint. */
export const DEFAULT_WAVEFORM_GENERATOR = "pcm-4k-mono-stream-v1";
export const DEFAULT_WAVEFORM_SAMPLE_RATE = 4000;
export const DEFAULT_WAVEFORM_CHANNELS = 1;

export type WaveformSessionCachePut = {
  fingerprint: string;
  points: readonly WaveformPoint[];
  metadata: WaveformMetadata;
  encoding?: string;
};

export type WaveformSessionCacheLookup = {
  fingerprint: string;
  duration: number;
  generator?: string;
  encoding?: string;
  sampleRate?: number;
  channels?: number;
};

export type WaveformSessionCacheEntry = {
  fingerprint: string;
  duration: number;
  points: WaveformPoint[];
  metadata: WaveformMetadata;
  encoding: string;
};

export type WaveformHydrationDocument = {
  points: readonly WaveformPoint[];
  metadata: WaveformMetadata;
  encoding?: string;
};

export type WaveformHydrationDecision = {
  source: "document" | "session-cache" | "generate";
  points: WaveformPoint[];
  metadata: WaveformMetadata | null;
};

export type WaveformSessionCache = {
  put(input: WaveformSessionCachePut): boolean;
  get(input: WaveformSessionCacheLookup): WaveformSessionCacheEntry | null;
  invalidate(fingerprint: string): void;
  clear(): void;
  size(): number;
};

type CacheOptions = {
  generator?: string;
  encoding?: string;
  sampleRate?: number;
  channels?: number;
};

/**
 * Creates an in-memory waveform cache owned by one App instance.
 *
 * Entries are keyed by source fingerprint and are deliberately copied on both
 * insertion and lookup so mutable editor state cannot leak through the cache.
 */
export function createWaveformSessionCache(options: CacheOptions = {}): WaveformSessionCache {
  const expectedGenerator = options.generator ?? DEFAULT_WAVEFORM_GENERATOR;
  const expectedEncoding = options.encoding ?? WAVEFORM_BINARY_ENCODING;
  const expectedSampleRate = options.sampleRate ?? DEFAULT_WAVEFORM_SAMPLE_RATE;
  const expectedChannels = options.channels ?? DEFAULT_WAVEFORM_CHANNELS;
  const entries = new Map<string, WaveformSessionCacheEntry>();

  return {
    put(input) {
      const fingerprint = normalizeFingerprint(input.fingerprint);
      const encoding = input.encoding ?? expectedEncoding;
      if (!fingerprint || !isValidMetadata(input.metadata, input.points) || encoding !== expectedEncoding) return false;
      if (input.metadata.generator !== expectedGenerator) return false;
      if (input.metadata.sample_rate !== expectedSampleRate || input.metadata.channels !== expectedChannels) return false;

      entries.set(fingerprint, {
        fingerprint,
        duration: input.metadata.duration,
        points: clonePoints(input.points),
        metadata: { ...input.metadata },
        encoding,
      });
      return true;
    },

    get(input) {
      const fingerprint = normalizeFingerprint(input.fingerprint);
      if (!fingerprint || !Number.isFinite(input.duration) || input.duration < 0) return null;
      const entry = entries.get(fingerprint);
      if (!entry) return null;
      const generator = input.generator ?? expectedGenerator;
      const encoding = input.encoding ?? expectedEncoding;
      const sampleRate = input.sampleRate ?? expectedSampleRate;
      const channels = input.channels ?? expectedChannels;
      if (
        !waveformDurationsMatch(entry.duration, input.duration) ||
        entry.metadata.generator !== generator ||
        entry.encoding !== encoding ||
        entry.metadata.sample_rate !== sampleRate ||
        entry.metadata.channels !== channels
      ) {
        entries.delete(fingerprint);
        return null;
      }
      return {
        ...entry,
        points: clonePoints(entry.points),
        metadata: { ...entry.metadata },
      };
    },

    invalidate(fingerprint) {
      const normalized = normalizeFingerprint(fingerprint);
      if (normalized) entries.delete(normalized);
    },

    clear() {
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}

export function waveformDurationsMatch(expected: number, actual: number) {
  return (
    Number.isFinite(expected) &&
    expected >= 0 &&
    Number.isFinite(actual) &&
    actual >= 0 &&
    Math.abs(expected - actual) <= Math.max(0.05, expected * 0.00001)
  );
}

/**
 * Applies the load order used when opening a project or switching modes:
 * document snapshot first, then the current App session cache, then generation.
 */
export function selectWaveformHydration(
  cache: WaveformSessionCache,
  input: {
    fingerprint: string;
    duration: number;
    document: WaveformHydrationDocument | null;
  },
): WaveformHydrationDecision {
  if (
    input.document &&
    isValidMetadata(input.document.metadata, input.document.points) &&
    waveformDurationsMatch(input.document.metadata.duration, input.duration)
  ) {
    cache.put({
      fingerprint: input.fingerprint,
      points: input.document.points,
      metadata: input.document.metadata,
      encoding: input.document.encoding,
    });
    return {
      source: "document",
      points: clonePoints(input.document.points),
      metadata: { ...input.document.metadata },
    };
  }

  const cached = cache.get({ fingerprint: input.fingerprint, duration: input.duration });
  if (cached) {
    return {
      source: "session-cache",
      points: cached.points,
      metadata: cached.metadata,
    };
  }
  return { source: "generate", points: [], metadata: null };
}

function normalizeFingerprint(value: string) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || null;
}

function isValidMetadata(metadata: WaveformMetadata, points: readonly WaveformPoint[]) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(points)) return false;
  if (!Number.isFinite(metadata.duration) || metadata.duration < 0) return false;
  if (!Number.isInteger(metadata.sample_rate) || metadata.sample_rate <= 0) return false;
  if (!Number.isInteger(metadata.channels) || metadata.channels <= 0) return false;
  if (
    !metadata.generator ||
    !Number.isInteger(metadata.point_count) ||
    metadata.point_count !== points.length ||
    points.length > WAVEFORM_BINARY_MAX_POINTS
  ) {
    return false;
  }
  if (!points.length) return false;
  let previousTime = -Infinity;
  for (const point of points) {
    if (
      !Number.isFinite(point.t) ||
      point.t < 0 ||
      point.t > metadata.duration + 0.05 ||
      !Number.isFinite(point.min) ||
      !Number.isFinite(point.max) ||
      !Number.isFinite(point.rms) ||
      !Number.isInteger(point.sample_count) ||
      point.sample_count < 0 ||
      point.t <= previousTime
    ) {
      return false;
    }
    previousTime = point.t;
  }
  return true;
}

function clonePoints(points: readonly WaveformPoint[]) {
  return points.map((point) => ({ ...point }));
}
