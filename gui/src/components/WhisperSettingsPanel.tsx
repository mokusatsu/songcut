import { Button } from "@/components/ui/button";
import { WhisperLanguageCombobox } from "@/components/WhisperLanguageCombobox";
import type { WhisperSettings, WhisperStatus } from "@/lib/api";
import { tr } from "@/i18n";

export function WhisperSettingsPanel(props: {
  settings: WhisperSettings;
  status: WhisperStatus | null;
  busy: boolean;
  hasSegments: boolean;
  transcriptStale: boolean;
  sourceAvailable: boolean;
  onChange: (settings: WhisperSettings) => void;
  onDownload: () => void;
  onTranscribe: () => void;
}) {
  const model = props.status?.models.find((item) => item.key === props.settings.model) ?? null;
  const languages = props.status?.languages ?? [
    { code: "auto", label: "Auto detect" },
    { code: "ja", label: "Japanese" },
  ];

  return (
    <section className="whisper-settings" aria-label={tr("whisper.aria")}>
      <div className="whisper-settings-heading">
        <label>
          <input
            type="checkbox"
            checked={props.settings.enabled}
            onChange={(event) => props.onChange({ ...props.settings, enabled: event.currentTarget.checked })}
          />
          {tr("whisper.enable")}
        </label>
        <span className={`model-state ${model ? (model.ready ? "ready" : "missing") : "unknown"}`}>
          {model ? (model.ready ? (model.source === "bundled" ? tr("whisper.bundled") : tr("whisper.ready")) : tr("whisper.missing")) : tr("whisper.checking")}
        </span>
      </div>
      <div className="whisper-setting-fields">
        <label>
          {tr("whisper.model")}
          <select
            value={props.settings.model}
            onChange={(event) =>
              props.onChange({ ...props.settings, model: event.currentTarget.value as WhisperSettings["model"] })
            }
          >
            {(props.status?.models ?? fallbackModels).map((item) => (
              <option key={item.key} value={item.key}>
                {item.display_name} — {modelRatingLabel(item.speed)}/{modelRatingLabel(item.quality)}
              </option>
            ))}
          </select>
        </label>
        <div className="whisper-setting-field">
          <span>{tr("whisper.language")}</span>
          <WhisperLanguageCombobox
            value={props.settings.language}
            languages={languages}
            onChange={(language) => props.onChange({ ...props.settings, language })}
          />
        </div>
        <label>
          {tr("whisper.device")}
          <select
            value={props.settings.device}
            onChange={(event) =>
              props.onChange({ ...props.settings, device: event.currentTarget.value as WhisperSettings["device"] })
            }
          >
            {(["auto", "npu", "gpu", "cpu"] as const).map((device) => (
              <option key={device} value={device} disabled={Boolean(props.status?.devices[device]?.error)}>
                {device === "auto" ? tr("common.auto") : device.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="whisper-settings-actions">
        <Button size="sm" variant="secondary" onClick={props.onDownload} disabled={props.busy}>
          {tr("whisper.prepare")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={props.onTranscribe}
          disabled={!props.hasSegments || !props.sourceAvailable || !model?.ready || props.busy}
        >
          {props.hasSegments ? tr("whisper.retranscribe") : tr("whisper.transcribe")}
        </Button>
        {props.transcriptStale ? <span className="transcript-stale">{tr("whisper.stale")}</span> : null}
      </div>
      {model?.installed_bytes ? <small>{tr("whisper.installed", { size: formatBytes(model.installed_bytes) })}</small> : null}
    </section>
  );
}

const fallbackModels = [
  { key: "tiny", display_name: "Tiny", speed: "Fastest", quality: "Basic" },
  { key: "base", display_name: "Base", speed: "Balanced", quality: "Good" },
  { key: "small", display_name: "Small", speed: "Slower", quality: "Best" },
] as const;

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function modelRatingLabel(value: string) {
  const key = value.toLowerCase();
  return ["fastest", "basic", "balanced", "good", "slower", "best"].includes(key)
    ? tr(`whisper.${key}`)
    : value;
}
