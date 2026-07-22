import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BoundaryRefinementSummary, BoundarySegmentDiagnostic, Segment } from "@/types";
import { currentUiLanguage, tr } from "@/i18n";

export function BoundaryRefinementDialog(props: {
  open: boolean;
  segment: Segment | null;
  diagnostic: BoundarySegmentDiagnostic | null;
  summary: BoundaryRefinementSummary | null;
  onClose: () => void;
}) {
  const ja = currentUiLanguage() === "ja";
  const diagnostic = props.diagnostic;
  return (
    <Dialog open={props.open} title={ja ? "境界補正の詳細" : "Boundary refinement details"} onClose={props.onClose}>
      {diagnostic && props.segment ? (
        <ScrollArea className="boundary-diagnostic-scroll">
          <div className="boundary-diagnostic-content">
            <p className="settings-field-help">
              {ja ? "粗い値 → 自動補正値 → 現在値を区別して表示します。" : "Coarse, automatically refined, and current values are shown separately."}
            </p>
            <table className="boundary-diagnostic-overview">
              <thead><tr><th>{ja ? "境界" : "Boundary"}</th><th>{ja ? "粗い値" : "Coarse"}</th><th>{ja ? "自動値" : "Automatic"}</th><th>{ja ? "現在値" : "Current"}</th></tr></thead>
              <tbody>
                <tr><th>{ja ? "開始" : "Start"}</th><td>{time(diagnostic.coarse_start)}</td><td>{time(diagnostic.automatic_start)}</td><td>{time(props.segment.start)}</td></tr>
                <tr><th>{ja ? "終了" : "End"}</th><td>{time(diagnostic.coarse_end)}</td><td>{time(diagnostic.automatic_end)}</td><td>{time(props.segment.end)}</td></tr>
              </tbody>
            </table>
            <div className="boundary-diagnostic-sides">
              {(["start", "end"] as const).map((side) => {
                const item = diagnostic[side];
                return (
                  <section key={side}>
                    <h3>{side === "start" ? (ja ? "開始" : "Start") : (ja ? "終了" : "End")}</h3>
                    <dl>
                      <Row label={ja ? "探索範囲" : "Search range"} value={`${time(item.search_start)} – ${time(item.search_end)}`} />
                      <Row label="Otsu" value={db(item.otsu_threshold_db)} />
                      <Row label={ja ? "クラスタ中央値" : "Cluster medians"} value={`${db(item.low_cluster_median_db)} / ${db(item.high_cluster_median_db)}`} />
                      <Row label={ja ? "遷移候補" : "Candidates"} value={item.transition_candidates.length ? item.transition_candidates.map(time).join(", ") : "—"} />
                      <Row label={ja ? "選択候補" : "Selected"} value={nullableTime(item.selected_candidate)} />
                      <Row label={ja ? "コントラスト点" : "Contrast point"} value={`${nullableTime(item.contrast_point)} (${db(item.contrast_db)})`} />
                      <Row label="roll" value={`${item.roll_seconds.toFixed(2)} s`} />
                      <Row label={ja ? "移動量" : "Delta"} value={`${item.delta_seconds.toFixed(3)} s`} />
                      <Row label={ja ? "結果" : "Result"} value={`${item.success ? (ja ? "成功" : "success") : (ja ? "維持" : "kept")} — ${item.reason ?? "—"}`} />
                    </dl>
                  </section>
                );
              })}
            </div>
            {props.summary ? (
              <section>
                <h3>{ja ? "解析時設定" : "Analysis settings"}</h3>
                <pre className="boundary-diagnostic-settings">{JSON.stringify(props.summary.settings, null, 2)}</pre>
              </section>
            ) : null}
          </div>
        </ScrollArea>
      ) : <p>{ja ? "この区間には境界補正診断がありません。" : "No boundary refinement diagnostic is available for this segment."}</p>}
      <div className="dialog-actions"><span /><Button onClick={props.onClose}>{tr("common.close")}</Button></div>
    </Dialog>
  );
}

function Row(props: { label: string; value: string }) {
  return <><dt>{props.label}</dt><dd>{props.value}</dd></>;
}

function time(value: number) { return `${value.toFixed(3)} s`; }
function nullableTime(value: number | null) { return value === null ? "—" : time(value); }
function db(value: number | null) { return value === null ? "—" : `${value.toFixed(2)} dB`; }
