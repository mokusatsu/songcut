import { describe, expect, it } from "vitest";
import {
  SETTINGS_CONTROL_SCOPES,
  SETTINGS_DIALOG_SCOPE_BY_TAB,
  settingsScopesForTab,
} from "@/components/SettingsDialog";

describe("SettingsDialog scope contract", () => {
  it("keeps common, mode and project controls assigned to their owner", () => {
    expect(SETTINGS_CONTROL_SCOPES.scratchPreviewMilliseconds).toBe("app");
    expect(SETTINGS_CONTROL_SCOPES.waveformDisplayModeCut).toBe("mode");
    expect(SETTINGS_CONTROL_SCOPES.waveformDisplayModeSub).toBe("mode");
    expect(SETTINGS_CONTROL_SCOPES.analysisDevice).toBe("project");
    expect(SETTINGS_CONTROL_SCOPES.whisperSettings).toBe("project");
    expect(SETTINGS_CONTROL_SCOPES.filenameTemplate).toBe("project");
  });

  it("exposes tab scope groups without requiring a DOM renderer", () => {
    expect(settingsScopesForTab("common")).toEqual(["app"]);
    expect(settingsScopesForTab("cut")).toEqual(["mode", "project"]);
    expect(settingsScopesForTab("sub")).toEqual(["mode", "project"]);
    expect(settingsScopesForTab("ai-models")).toEqual(["project"]);
    expect(SETTINGS_DIALOG_SCOPE_BY_TAB).toHaveProperty("cut");
  });
});
