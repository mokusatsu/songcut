import { describe, expect, it, vi } from "vitest";

import { runModelDownload } from "@/lib/useModelPreparation";
import type { JobRecord } from "@/types";

function job(id: string, status: JobRecord["status"] = "running"): JobRecord {
  return {
    id,
    kind: "download-model",
    status,
    progress: status === "completed" ? 1 : 0,
    message: status,
    created_at: 1,
    updated_at: 1,
  };
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    taskSlot: "download-demucs" as const,
    taskKind: "download-demucs",
    readyJobId: "already-ready-demucs",
    startingJobId: "starting-demucs",
    preparingMessage: "準備中",
    failedMessage: "失敗",
    completeMessage: "完了",
    showReadyState: false,
    fetchStatus: vi.fn(async () => ({ ready: false })),
    isReady: (status: { ready: boolean }) => status.ready,
    createReadyResult: () => ({ model: "test" }),
    startDownload: vi.fn(async () => job("started")),
    waitForDownload: vi.fn(async (_job: JobRecord, onProgress: (next: JobRecord) => void) => {
      const completed = job("started", "completed");
      onProgress(completed);
      return completed;
    }),
    afterDownload: vi.fn(async () => undefined),
    updateTask: vi.fn(),
    openDialog: vi.fn(),
    ...overrides,
  };
}

describe("model download lifecycle", () => {
  it("準備済みモデルは要求された場合だけ完了状態を表示する", async () => {
    const state = config({
      showReadyState: true,
      fetchStatus: vi.fn(async () => ({ ready: true })),
    });

    await runModelDownload(state);

    expect(state.startDownload).not.toHaveBeenCalled();
    expect(state.openDialog).toHaveBeenCalledOnce();
    expect(state.updateTask).toHaveBeenCalledWith(
      "download-demucs",
      expect.objectContaining({ status: "completed", progress: 1 }),
    );
  });

  it("未準備モデルの開始、進捗、完了後refreshを順に実行する", async () => {
    const state = config();

    await runModelDownload(state);

    expect(state.openDialog).toHaveBeenCalledOnce();
    expect(state.startDownload).toHaveBeenCalledOnce();
    expect(state.waitForDownload).toHaveBeenCalledOnce();
    expect(state.afterDownload).toHaveBeenCalledOnce();
    expect(state.updateTask).toHaveBeenLastCalledWith(
      "download-demucs",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("download失敗をtaskへ反映して呼び出し元へ再送出する", async () => {
    const state = config({
      startDownload: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    });

    await expect(runModelDownload(state)).rejects.toThrow("network unavailable");

    expect(state.updateTask).toHaveBeenLastCalledWith(
      "download-demucs",
      expect.objectContaining({ status: "failed", error: "Error: network unavailable" }),
    );
  });
});
