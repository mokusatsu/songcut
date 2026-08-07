import { normalizeWaveformDisplayMode, type CutWaveformAmplitudeProfile } from "@/lib/waveform";
import type { AppMode } from "@/lib/modes";
import type { WaveformDisplayMode } from "@/types";

export type WaveformDisplayModes = Record<AppMode, WaveformDisplayMode>;

export const DEFAULT_WAVEFORM_DISPLAY_MODES: WaveformDisplayModes = {
  cut: "rms",
  sub: "symmetric-peak",
};

export const LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY = "songcut:waveform-display-mode";
export const WAVEFORM_DISPLAY_MODE_STORAGE_KEYS: Record<AppMode, string> = {
  cut: "songcut:waveform-display-mode:cut",
  sub: "songcut:waveform-display-mode:sub",
};
export const DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE: CutWaveformAmplitudeProfile = "singing-mc-contrast";
export const CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY = "songcut:waveform-amplitude-profile:cut";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

/** `readWaveformDisplayModes`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function readWaveformDisplayModes(storage: StorageReader): WaveformDisplayModes {
  const storedCut = storage.getItem(WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut);
  const cutSource = storedCut ?? storage.getItem(LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY);
  return {
    cut: normalizeWaveformDisplayMode(cutSource, DEFAULT_WAVEFORM_DISPLAY_MODES.cut),
    sub: normalizeWaveformDisplayMode(
      storage.getItem(WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.sub),
      DEFAULT_WAVEFORM_DISPLAY_MODES.sub
    ),
  };
}

/** `writeWaveformDisplayMode`の値を検証済みの形式で永続先へ保存する。 */
export function writeWaveformDisplayMode(
  storage: StorageWriter,
  mode: AppMode,
  displayMode: WaveformDisplayMode
) {
  storage.setItem(WAVEFORM_DISPLAY_MODE_STORAGE_KEYS[mode], displayMode);
}

/** `normalizeCutWaveformAmplitudeProfile`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeCutWaveformAmplitudeProfile(value: unknown): CutWaveformAmplitudeProfile {
  return value === "adaptive" || value === "singing-mc-contrast"
    ? value
    : DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE;
}

/** `readCutWaveformAmplitudeProfile`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function readCutWaveformAmplitudeProfile(storage: StorageReader): CutWaveformAmplitudeProfile {
  return normalizeCutWaveformAmplitudeProfile(storage.getItem(CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY));
}

/** `writeCutWaveformAmplitudeProfile`の値を検証済みの形式で永続先へ保存する。 */
export function writeCutWaveformAmplitudeProfile(
  storage: StorageWriter,
  profile: CutWaveformAmplitudeProfile
) {
  storage.setItem(CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY, profile);
}
