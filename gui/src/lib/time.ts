/** `formatTime`の値を現在のlocaleと表示規則に沿った文字列へ整形する。 */
export function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** `clamp`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
