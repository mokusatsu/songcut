import { describe, expect, it } from "vitest";
import {
  resolveJobProgressDialogState,
  resolveJobProgressDialogActionLabel,
  resolveJobProgressMessage,
  shouldRenderJobProgressError,
} from "@/components/JobProgressDialog";
import type { JobRecord } from "@/types";

function job(status: JobRecord["status"], progress = 0.4, message = "working") {
  return {
    id: "test-job",
    kind: "test",
    status,
    progress,
    message,
    error: null,
    created_at: 0,
    updated_at: 0,
  } satisfies JobRecord;
}

describe("resolveJobProgressDialogState", () => {
  it.each([
    ["queued", true, false],
    ["running", true, false],
    ["completed", false, true],
    ["failed", false, true],
    ["cancelled", false, true],
  ] as const)("resolves %s as active=%s terminal=%s", (status, active, terminal) => {
    const state = resolveJobProgressDialogState(job(status), undefined, "always");
    expect(state.status).toBe(status);
    expect(state.active).toBe(active);
    expect(state.terminal).toBe(terminal);
    expect(state.showCloseAction).toBe(true);
  });

  it("clamps progress and applies an explicit override", () => {
    expect(resolveJobProgressDialogState(job("running", 2)).progress).toBe(1);
    expect(resolveJobProgressDialogState(job("running", -1)).progress).toBe(0);
    const overridden = resolveJobProgressDialogState(job("running", 0.2), 0.76);
    expect(overridden.progress).toBe(0.76);
    expect(overridden.percent).toBe(76);
  });

  it("uses a supplied status list for close-action visibility", () => {
    const statuses = ["completed", "failed"] as const;
    expect(resolveJobProgressDialogState(job("running"), undefined, statuses).showCloseAction).toBe(false);
    expect(resolveJobProgressDialogState(job("completed"), undefined, statuses).showCloseAction).toBe(true);
    expect(resolveJobProgressDialogState(job("cancelled"), undefined, statuses).showCloseAction).toBe(false);
  });

  it("allows a policy to preserve a status-specific action label", () => {
    const state = resolveJobProgressDialogState(job("cancelled"));
    expect(resolveJobProgressDialogActionLabel(state, {
      statuses: "always",
      activeLabel: "Hide",
      terminalLabel: "Close",
      label: (current) => current.status === "completed" || current.status === "failed" ? "Close" : "Hide",
    })).toBe("Hide");
  });
});

describe("JobProgressDialog pure rendering helpers", () => {
  it("falls back to the pending message when a job has no message", () => {
    const state = resolveJobProgressDialogState(null);
    expect(resolveJobProgressMessage(null, "Preparing…", state)).toBe("Preparing…");
    expect(resolveJobProgressMessage(job("running", 0, "Status"), "Preparing…", state)).toBe("Status");
    const runningState = resolveJobProgressDialogState(job("running"));
    expect(resolveJobProgressMessage(job("running"), "Preparing…", runningState, (current) => current.status)).toBe("running");
  });

  it("controls error rendering independently from the job record", () => {
    const failed = { ...job("failed"), error: "failed" } satisfies JobRecord;
    expect(shouldRenderJobProgressError(failed, undefined)).toBe(true);
    expect(shouldRenderJobProgressError(failed, false)).toBe(false);
    expect(shouldRenderJobProgressError(job("failed"), "override error")).toBe(true);
  });
});
