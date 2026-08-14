import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ProjectInformationDetails,
  ProjectInformationTrigger,
  type ProjectInformationProps,
} from "@/components/ProjectInformation";
import { initializeRendererI18n } from "@/i18n";
import type { JobRecord, VideoInfo } from "@/types";

const videoInfo: VideoInfo = {
  path: "C:\\media\\song.mp4",
  name: "song.mp4",
  format_name: "mov,mp4",
  duration: 252,
  bit_rate: 0,
  video: { codec: "h264", width: 1920, height: 1080 },
  audio: { codec: "aac" },
  timestamp_comment_candidates: [],
  info_json_warning: null,
  smart_render_estimate: null,
};

beforeAll(async () => {
  await initializeRendererI18n("en");
});

const baseProps: ProjectInformationProps = {
  mode: "cut",
  runningTasks: [],
  failedTasks: [],
  latestTerminalTask: null,
  message: "Project loaded.",
  videoInfo,
  scratchProxyState: "ready",
  waveformPhase: "ready",
  waveformProgress: 1,
  onDismiss: () => undefined,
  onWaveformRetry: null,
};

function job(status: JobRecord["status"]): JobRecord {
  return {
    id: `job-${status}`,
    kind: "waveform",
    status,
    progress: status === "completed" ? 1 : 0.5,
    message: status === "failed" ? "Waveform failed." : "Generating waveform.",
    error: status === "failed" ? "ffmpeg failed" : undefined,
    created_at: 1,
    updated_at: 2,
  };
}

describe("ProjectInformation", () => {
  it("keeps completed preparation details off the persistent trigger", () => {
    const markup = renderToStaticMarkup(<ProjectInformationTrigger runningCount={0} failedCount={0} onClick={() => undefined} />);

    expect(markup).toContain(">Information<");
    expect(markup).not.toContain("Waveform: Ready");
    expect(markup).not.toContain("Scratch audio: AAC proxy");
    expect(markup).not.toContain("project-information-badge");
  });

  it("shows only running or failed counts on the persistent trigger", () => {
    const runningMarkup = renderToStaticMarkup(
      <ProjectInformationTrigger runningCount={1} failedCount={0} onClick={() => undefined} />,
    );
    const failedMarkup = renderToStaticMarkup(
      <ProjectInformationTrigger runningCount={0} failedCount={1} onClick={() => undefined} />,
    );

    expect(runningMarkup).toContain('class="project-information-badge running"');
    expect(failedMarkup).toContain('class="project-information-badge failed"');
  });

  it("renders common preparation details for Cut without Sub-only items", () => {
    const markup = renderToStaticMarkup(
      <ProjectInformationDetails {...baseProps} latestTerminalTask={job("completed")} />,
    );

    expect(markup).toContain('data-status-mode="cut"');
    expect(markup).toContain(">Mode<");
    expect(markup).toContain(">Cut<");
    expect(markup).toContain(">Media<");
    expect(markup).toContain(">Scratch audio<");
    expect(markup).toContain(">Waveform<");
    expect(markup).not.toContain(">Effects<");
    expect(markup).toContain("Waveform: Ready");
    expect(markup).toContain("Scratch audio: AAC proxy");
    expect(markup).toContain('data-latest-task="true"');
  });

  it("groups Sub-only metadata in the Sub details", () => {
    const markup = renderToStaticMarkup(
      <ProjectInformationDetails
        {...baseProps}
        mode="sub"
        modeMeta={[
          { key: "effects", label: "Effects", value: "Ready" },
          { key: "bpm", label: "BPM", value: "120.0" },
          { key: "confidence", label: "Confidence", value: "mean 0.95" },
        ]}
      />,
    );

    expect(markup).toContain('data-status-mode="sub"');
    expect(markup).toContain(">Sub<");
    expect(markup).toContain(">Effects<");
    expect(markup).toContain(">BPM<");
    expect(markup).toContain(">Confidence<");
  });

  it("keeps retry and failure dismissal controls inside the details", () => {
    const markup = renderToStaticMarkup(
      <ProjectInformationDetails
        {...baseProps}
        failedTasks={[{ slot: "waveform", job: job("failed") }]}
        waveformPhase="failed"
        onWaveformRetry={() => undefined}
      />,
    );

    expect(markup).toContain(">Retry<");
    expect(markup).toContain("ffmpeg failed");
    expect(markup).toContain(">Close<");
  });
});
