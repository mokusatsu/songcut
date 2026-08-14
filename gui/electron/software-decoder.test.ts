import { describe, expect, it } from "vitest";
import {
  SOFTWARE_DECODER_RELAUNCH_FLAG,
  SOFTWARE_DECODER_RESTART_EXIT_CODE,
  SOFTWARE_DECODER_RESTART_REQUEST_ENV,
  SOFTWARE_DECODER_RESUME_ARG_PREFIX,
  buildSoftwareDecoderRelaunchArgs,
  createSoftwareDecoderResumeSessionReader,
  decodeSoftwareDecoderResumeSession,
  decoderModeForArgs,
  encodeSoftwareDecoderResumeSession,
  hasSoftwareDecoderFlag,
} from "./software-decoder.js";

describe("software decoder startup contract", () => {
  it("recognizes only the explicit one-shot startup flag", () => {
    expect(hasSoftwareDecoderFlag(["songcut.exe", SOFTWARE_DECODER_RELAUNCH_FLAG])).toBe(true);
    expect(hasSoftwareDecoderFlag(["songcut.exe", "--songcut-software-decoder=true"])).toBe(false);
    expect(decoderModeForArgs(["songcut.exe", SOFTWARE_DECODER_RELAUNCH_FLAG])).toBe("software");
    expect(decoderModeForArgs(["songcut.exe"])).toBe("hardware");
  });

  it("uses a dedicated launcher restart protocol", () => {
    expect(SOFTWARE_DECODER_RESTART_EXIT_CODE).toBe(75);
    expect(SOFTWARE_DECODER_RESTART_REQUEST_ENV).toBe("SONGCUT_LAUNCHER_RESTART_REQUEST");
  });

  it("preserves existing app arguments and emits one session flag", () => {
    const args = [
      ".",
      "--user-data-dir=C:\\tmp\\songcut",
      SOFTWARE_DECODER_RELAUNCH_FLAG,
      "--open-file=clip.mkv",
      SOFTWARE_DECODER_RELAUNCH_FLAG,
    ];

    expect(buildSoftwareDecoderRelaunchArgs(args)).toEqual([
      ".",
      "--user-data-dir=C:\\tmp\\songcut",
      "--open-file=clip.mkv",
      SOFTWARE_DECODER_RELAUNCH_FLAG,
    ]);
    expect(buildSoftwareDecoderRelaunchArgs(args).filter((arg) => arg === SOFTWARE_DECODER_RELAUNCH_FLAG)).toHaveLength(1);
  });

  it("round-trips a Unicode resume session without exposing paths in the flag", () => {
    const session = { projectPath: "C:\\作業\\songcut.scut", videoPath: "D:\\動画\\clip.mkv" };
    const payload = encodeSoftwareDecoderResumeSession(session);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain("作業");
    expect(decodeSoftwareDecoderResumeSession([
      SOFTWARE_DECODER_RELAUNCH_FLAG,
      `${SOFTWARE_DECODER_RESUME_ARG_PREFIX}${payload}`,
    ])).toEqual(session);
  });

  it("drops old resume arguments and rejects absent or malformed sessions", () => {
    const oldPayload = `${SOFTWARE_DECODER_RESUME_ARG_PREFIX}eyJ2aWRlb1BhdGgiOiJvbGQifQ`;
    const args = buildSoftwareDecoderRelaunchArgs(
      [".", oldPayload, SOFTWARE_DECODER_RELAUNCH_FLAG, `${SOFTWARE_DECODER_RESUME_ARG_PREFIX}broken`],
      { videoPath: "new.mkv" },
    );
    expect(args.filter((arg) => arg.startsWith(SOFTWARE_DECODER_RESUME_ARG_PREFIX))).toHaveLength(1);
    expect(decodeSoftwareDecoderResumeSession(["songcut.exe"])).toBeNull();
    expect(decodeSoftwareDecoderResumeSession(["songcut.exe", `${SOFTWARE_DECODER_RESUME_ARG_PREFIX}broken`])).toBeNull();
    const payload = encodeSoftwareDecoderResumeSession({ videoPath: "stale.mkv" });
    expect(decodeSoftwareDecoderResumeSession([
      "songcut.exe",
      `${SOFTWARE_DECODER_RESUME_ARG_PREFIX}${payload}`,
    ])).toBeNull();
  });

  it("consumes a valid resume session only once", () => {
    const args = buildSoftwareDecoderRelaunchArgs(["."], { projectPath: "songcut.scut" });
    const readSession = createSoftwareDecoderResumeSessionReader(args);
    expect(readSession()).toEqual({ projectPath: "songcut.scut" });
    expect(readSession()).toBeNull();
  });
});
