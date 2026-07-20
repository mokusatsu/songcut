import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRecovery,
  fingerprintSource,
  loadProject,
  loadRecovery,
  projectPathForVideo,
  saveProject,
  saveRecovery,
  sourceIdentityMatches,
} from "./project-store.js";
import { parseProjectText, type ProjectDocumentV1, type RecoverySnapshot } from "./project-schema.js";
import { WAVEFORM_BINARY_ENCODING, encodeWaveformPoints } from "./waveform-codec.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("songcut project storage", () => {
  it("uses the complete video filename for the sidecar", () => {
    expect(projectPathForVideo("C:\\media\\archive.mp4")).toBe(path.resolve("C:\\media\\archive.mp4.songcut"));
    expect(projectPathForVideo("C:\\media\\archive.mkv")).not.toBe(projectPathForVideo("C:\\media\\archive.mp4"));
  });

  it("round-trips a project through an atomic save", async () => {
    const directory = await tempDirectory();
    const projectPath = path.join(directory, "video.mp4.songcut");
    const document = projectDocument(3);
    const points = [{ t: 0.5, min: -0.5, max: 0.5, rms: 0.25, sample_count: 4_000 }];
    document.waveform_snapshot = {
      schema_version: 2,
      generator: "pcm-4k-mono-stream-v1",
      source_fingerprint: document.source.fingerprint.value,
      duration_seconds: document.source.duration_seconds,
      sample_rate: 4_000,
      channels: 1,
      completed_at: document.updated_at,
      encoding: WAVEFORM_BINARY_ENCODING,
      point_count: points.length,
      data_base64: encodeWaveformPoints(points),
    };

    await saveProject(projectPath, document);
    const loaded = await loadProject(projectPath);

    expect(loaded.document).toEqual(document);
    expect(loaded.recoveredFrom).toBe("target");
  });

  it("chooses a newer valid temporary file after an interrupted replacement", async () => {
    const directory = await tempDirectory();
    const projectPath = path.join(directory, "video.mp4.songcut");
    await saveProject(projectPath, projectDocument(1));
    await writeFile(`${projectPath}.tmp`, `${JSON.stringify(projectDocument(2), null, 2)}\n`, "utf8");

    const loaded = await loadProject(projectPath);

    expect(loaded.document.revision).toBe(2);
    expect(loaded.recoveredFrom).toBe("temporary");
  });

  it("loads the backup when the target is missing", async () => {
    const directory = await tempDirectory();
    const projectPath = path.join(directory, "video.mp4.songcut");
    await saveProject(projectPath, projectDocument(4));
    await rename(projectPath, `${projectPath}.bak`);

    const loaded = await loadProject(projectPath);

    expect(loaded.document.revision).toBe(4);
    expect(loaded.recoveredFrom).toBe("backup");
  });

  it("keeps and clears the active recovery snapshot", async () => {
    const directory = await tempDirectory();
    const snapshot: RecoverySnapshot = {
      format: "songcut-recovery",
      schema_version: 1,
      session_id: "session-1",
      project_path: path.join(directory, "video.mp4.songcut"),
      saved_at: new Date().toISOString(),
      document: projectDocument(5),
    };

    await saveRecovery(directory, snapshot);
    expect(await loadRecovery(directory)).toEqual(snapshot);
    await clearRecovery(directory);
    expect(await loadRecovery(directory)).toBeNull();
  });

  it("fingerprints moved content without relying on its path", async () => {
    const directory = await tempDirectory();
    const first = path.join(directory, "first.mp4");
    const second = path.join(directory, "renamed.mp4");
    await writeFile(first, Buffer.from("same media bytes"));
    await writeFile(second, Buffer.from("same media bytes"));
    const firstIdentity = await fingerprintSource(first);
    const secondIdentity = await fingerprintSource(second);
    const document = projectDocument(1);
    document.source.size_bytes = firstIdentity.size_bytes;
    document.source.fingerprint = firstIdentity.fingerprint;

    expect(sourceIdentityMatches(document, secondIdentity)).toBe(true);
    await writeFile(second, Buffer.from("different media bytes"));
    expect(sourceIdentityMatches(document, await fingerprintSource(second))).toBe(false);
  });

  it("refuses a newer schema without coercing it", () => {
    const value = { ...projectDocument(1), schema_version: 4 };
    expect(() => parseProjectText(JSON.stringify(value))).toThrow(/newer version/i);
  });

  it("rejects older schemas instead of migrating them", () => {
    const value = { ...projectDocument(1), schema_version: 2 };
    expect(() => parseProjectText(JSON.stringify(value))).toThrow(/unsupported.*schema/i);
  });

  it("does not use an older backup when the target has a newer schema", async () => {
    const directory = await tempDirectory();
    const projectPath = path.join(directory, "future.mp4.songcut");
    await writeFile(projectPath, JSON.stringify({ ...projectDocument(2), schema_version: 4 }), "utf8");
    await writeFile(`${projectPath}.bak`, JSON.stringify(projectDocument(1)), "utf8");

    await expect(loadProject(projectPath)).rejects.toThrow(/newer version/i);
  });
});

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "songcut-project-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function projectDocument(revision: number): ProjectDocumentV1 {
  const now = new Date().toISOString();
  return {
    format: "songcut-project",
    schema_version: 3,
    project_id: "project-1",
    revision,
    created_at: now,
    updated_at: now,
    source: {
      absolute_path: "C:\\media\\video.mp4",
      relative_path: "video.mp4",
      filename: "video.mp4",
      size_bytes: 123,
      mtime_ms: 456,
      duration_seconds: 10,
      fingerprint: { algorithm: "sha256-head-tail-1m-v1", value: "0".repeat(64) },
    },
    guide_text: "",
    settings: {
      analysis_device: "auto",
      whisper: { enabled: false, model: "small", language: "ja", device: "auto" },
      export: { filename_template: "{index}_{title}" },
    },
    waveform_snapshot: null,
    analysis_snapshot: null,
    segments: [],
    export_candidates: [],
    view_state: { selected_segment_id: null, current_time: 0, zoom_index: 0 },
    operation: null,
  };
}
