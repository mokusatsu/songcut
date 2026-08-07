/** The smallest shared shape used by timeline operations. */
export type TimedEntity = {
  start: number;
  end: number;
};

/** A range intentionally has the same structural shape as a timed entity. */
export type TimeRange = TimedEntity;

export const TIME_RANGE_EPSILON = 1e-6;

/** `timeRangeDuration`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
export function timeRangeDuration(range: TimedEntity): number {
  return range.end - range.start;
}

export const rangeDuration = timeRangeDuration;

/** `isValidTimeRange`の入力が要求された条件やschemaを満たすか検証する。 */
export function isValidTimeRange(range: TimedEntity, minimumDuration = 0): boolean {
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    timeRangeDuration(range) >= Math.max(0, minimumDuration)
  );
}

/** `rangesOverlap`の二つの入力が同一対象または重複範囲を表すか判定する。 */
export function rangesOverlap(
  left: TimedEntity,
  right: TimedEntity,
  epsilon = TIME_RANGE_EPSILON,
): boolean {
  return left.start < right.end - epsilon && right.start < left.end - epsilon;
}

/** `boundaryTime`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
export function boundaryTime(range: TimedEntity, edge: "start" | "end"): number {
  return edge === "start" ? range.start : range.end;
}

/** `withBoundary`で指定された変更を不変更新として状態へ反映する。 */
export function withBoundary(
  range: TimedEntity,
  edge: "start" | "end",
  value: number,
): TimeRange {
  return edge === "start"
    ? { start: value, end: range.end }
    : { start: range.start, end: value };
}

/** `clampTime`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function clampTime(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}
