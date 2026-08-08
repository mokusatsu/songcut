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
    const cutPath = projectPathForVideo("C:\\media\\archive.mp4");
    const subPath = projectPathForVideo("C:\\media\\archive.mp4", "sub");
    expect(cutPath).toBe(path.resolve("C:\\media\\archive.mp4.songcut"));
    expect(projectPathForVideo("C:\\media\\archive.mkv")).not.toBe(projectPathForVideo("C:\\media\\archive.mp4"));
    expect(subPath).toBe(
      path.resolve("C:\\media\\archive.mp4.sub.songcut")
    );
    expect(subPath).not.toBe(cutPath);
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

  it("serializes concurrent saves that share atomic temporary files", async () => {
    const directory = await tempDirectory();
    const projectPath = path.join(directory, "video.mp4.sub.songcut");
    const revisions = Array.from({ length: 12 }, (_, index) => index + 1);

    await Promise.all(revisions.map((revision) => saveProject(projectPath, projectDocument(revision))));

    const loaded = await loadProject(projectPath);
    expect(loaded.document.revision).toBe(revisions.at(-1));
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

  it("accepts only operation kinds compatible with each mode", () => {
    for (const kind of ["analysis", "transcription", "export"] as const) {
      expect(() => parseProjectText(JSON.stringify({
        ...projectDocument(1),
        operation: { kind, status: "interrupted" as const },
      }))).not.toThrow();
    }
    for (const kind of ["lyrics-analysis", "subtitle-export"] as const) {
      expect(() => parseProjectText(JSON.stringify({
        ...subProjectDocument(1),
        operation: { kind, status: "interrupted" as const },
      }))).not.toThrow();
    }
  });

  it("rejects operation kinds from the other mode", () => {
    for (const kind of ["lyrics-analysis", "subtitle-export"] as const) {
      expect(() => parseProjectText(JSON.stringify({
        ...projectDocument(1),
        operation: { kind, status: "interrupted" as const },
      }))).toThrow(/incompatible with cut/i);
    }
    for (const kind of ["analysis", "transcription", "export"] as const) {
      expect(() => parseProjectText(JSON.stringify({
        ...subProjectDocument(1),
        operation: { kind, status: "interrupted" as const },
      }))).toThrow(/incompatible with sub/i);
    }
  });

  it("rejects mixed Cut/Sub payloads with a precise invariant error", () => {
    expect(() => parseProjectText(JSON.stringify({
      ...projectDocument(1),
      subtitle: subtitleState(),
    }))).toThrow(/Cut project must not contain subtitle/i);

    expect(() => parseProjectText(JSON.stringify({
      ...subProjectDocument(1),
      analysis_snapshot: {
        timestamp_source: "",
        backend: "",
        device_requested: "",
        device_used: "",
        model_versions: {},
        elapsed_seconds: 0,
        frame_scores: [],
        raw_segments: [],
      },
    }))).toThrow(/Sub project must not contain analysis_snapshot/i);

    expect(() => parseProjectText(JSON.stringify({
      ...subProjectDocument(1),
      segments: [segmentFixture()],
    }))).toThrow(/Sub project must not contain Cut segments/i);

    expect(() => parseProjectText(JSON.stringify({
      ...subProjectDocument(1),
      export_candidates: [{
        id: "candidate-1",
        segment_id: "segment-1",
        title: "title",
        filename_stem: "title",
        start: 0,
        end: 1,
        duration: 1,
        match_source: "manual",
        checked: true,
      }],
      segments: [segmentFixture()],
    }))).toThrow(/Sub project must not contain Cut export_candidates/i);

    const missingSubtitle = { ...subProjectDocument(1) };
    delete missingSubtitle.subtitle;
    expect(() => parseProjectText(JSON.stringify(missingSubtitle))).toThrow(/missing subtitle/i);
  });

  it("round-trips valid Cut and Sub documents through atomic storage", async () => {
    const directory = await tempDirectory();
    const cutPath = path.join(directory, "video.mp4.songcut");
    const subPath = path.join(directory, "video.mp4.sub.songcut");
    const cut = { ...projectDocument(3), mode: "cut" as const };
    const sub = subProjectDocument(4);

    await saveProject(cutPath, cut);
    await saveProject(subPath, sub);

    expect((await loadProject(cutPath)).document).toEqual(cut);
    expect((await loadProject(subPath)).document).toEqual(sub);
  });

  it("keeps schema v3 compatible while validating paired segment overrides", () => {
    const legacy = subProjectDocument(1);
    expect(() => parseProjectText(JSON.stringify(legacy))).not.toThrow();

    const custom = subProjectDocument(2);
    const lane = custom.subtitle!.lanes[0];
    lane.segments.push({
      id: "custom-segment",
      text: "Custom",
      start: 0,
      end: 1,
      confidence: 1,
      source: "manual",
      low_confidence_outlier: false,
      user_edited: true,
      style_override: { ...lane.style, font_size: 48 },
      effect_override: {
        name: "fad",
        start_duration_ms: 200,
        end_duration_ms: 300,
        params: {},
      },
    });
    expect(() => parseProjectText(JSON.stringify(custom))).not.toThrow();

    delete custom.subtitle!.lanes[0].segments[0].effect_override;
    expect(() => parseProjectText(JSON.stringify(custom))).toThrow(/both style_override and effect_override/i);
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

function subProjectDocument(revision: number): ProjectDocumentV1 {
  return {
    ...projectDocument(revision),
    mode: "sub",
    subtitle: subtitleState(),
  };
}

function subtitleState() {
  return {
    lanes: [{
      id: "lane-1",
      name: "Lyrics 1",
      style: {
        font_name: "Yu Gothic UI",
        font_size: 90,
        primary_color: "#FFFFFF",
        outline_color: "#000000",
        background_color: "#00000080",
        bold: false,
        italic: false,
        outline: 2,
        shadow: 0,
        alignment: 2,
        margin_l: 60,
        margin_r: 60,
        margin_v: 54,
      },
      segments: [],
    }],
    active_lane_id: "lane-1",
    selected_segment_id: null,
    tempo_bpm: 0,
    beat_times: [],
    rhythm_grid: [],
    beat_warning: null,
    confidence_statistics: null,
  };
}

function segmentFixture() {
  return {
    id: "segment-1",
    start: 0,
    end: 1,
    start_timecode: "00:00",
    end_timecode: "00:01",
    duration: 1,
    confidence: 1,
    source: "manual",
    flags: [],
    user_edited: true,
  };
}
