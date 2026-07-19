import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WhisperSettingsPanel } from "@/components/WhisperSettingsPanel";
import type { AnalysisDevice, WhisperSettings, WhisperStatus } from "@/lib/api";
import type { WaveformDisplayMode } from "@/types";

const inferenceDevices = ["auto", "npu", "gpu", "cpu"] as const;

export function SettingsDialog(props: {
  open: boolean;
  apiReady: boolean;
  scratchPreviewMillisecondsInput: string;
  scratchAudioProxyEnabled: boolean;
  waveformDisplayMode: WaveformDisplayMode;
  analysisDevice: AnalysisDevice;
  whisperSettings: WhisperSettings;
  whisperStatus: WhisperStatus | null;
  whisperBusy: boolean;
  hasSegments: boolean;
  transcriptStale: boolean;
  sourceAvailable: boolean;
  onClose: () => void;
  onScratchPreviewMillisecondsInput: (value: string) => void;
  onScratchAudioProxyEnabled: (enabled: boolean) => void;
  onWaveformDisplayMode: (mode: WaveformDisplayMode) => void;
  onAnalysisDevice: (device: AnalysisDevice) => void;
  onWhisperSettings: (settings: WhisperSettings) => void;
  onPrepareWhisperModel: () => void;
  onTranscribe: () => void;
  onFfmpegCheck: () => void;
}) {
  return (
    <Dialog open={props.open} title="Settings" onClose={props.onClose}>
      <div className="settings-dialog-content">
        <section className="settings-section" aria-labelledby="playback-settings-heading">
          <h3 id="playback-settings-heading">Playback and analysis</h3>
          <div className="settings-grid">
            <label className="settings-field" htmlFor="scratch-preview-milliseconds">
              <span>Scratch preview duration</span>
              <span className="settings-inline-control">
                <Input
                  id="scratch-preview-milliseconds"
                  type="number"
                  min={1}
                  max={5000}
                  step="1"
                  inputMode="numeric"
                  value={props.scratchPreviewMillisecondsInput}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => props.onScratchPreviewMillisecondsInput(event.currentTarget.value)}
                />
                <span className="settings-unit">ms</span>
              </span>
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={props.scratchAudioProxyEnabled}
                onChange={(event) => props.onScratchAudioProxyEnabled(event.currentTarget.checked)}
              />
              Use scratch audio proxy
            </label>
            <label className="settings-field">
              <span>Waveform display</span>
              <select
                value={props.waveformDisplayMode}
                onChange={(event) => props.onWaveformDisplayMode(event.currentTarget.value as WaveformDisplayMode)}
              >
                <option value="rms">RMS</option>
                <option value="peak">Peak Envelope</option>
                <option value="peak-rms">Peak + RMS</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Singing analysis device</span>
              <select
                value={props.analysisDevice}
                onChange={(event) => props.onAnalysisDevice(event.currentTarget.value as AnalysisDevice)}
              >
                {inferenceDevices.map((device) => (
                  <option key={device} value={device}>
                    {device === "auto" ? "Auto" : device.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="whisper-settings-heading">
          <h3 id="whisper-settings-heading">Whisper transcription</h3>
          <WhisperSettingsPanel
            settings={props.whisperSettings}
            status={props.whisperStatus}
            busy={props.whisperBusy}
            hasSegments={props.hasSegments}
            transcriptStale={props.transcriptStale}
            sourceAvailable={props.sourceAvailable}
            onChange={props.onWhisperSettings}
            onDownload={props.onPrepareWhisperModel}
            onTranscribe={props.onTranscribe}
          />
        </section>

        <section className="settings-section settings-tools" aria-labelledby="tools-settings-heading">
          <div>
            <h3 id="tools-settings-heading">Tools</h3>
            <p>Check the ffmpeg and ffprobe executables used by analysis and export.</p>
          </div>
          <Button variant="secondary" onClick={props.onFfmpegCheck} disabled={!props.apiReady}>
            ffmpeg Check
          </Button>
        </section>
      </div>
      <div className="dialog-actions settings-dialog-actions">
        <span>Changes are applied immediately and project settings are autosaved.</span>
        <Button onClick={props.onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
