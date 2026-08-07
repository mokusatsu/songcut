/** Modes are an application concern, not part of the subtitle domain. */
export type AppMode = "cut" | "sub";

export const APP_MODES = ["cut", "sub"] as const satisfies readonly AppMode[];

/** `isAppMode`の入力が要求された条件やschemaを満たすか検証する。 */
export function isAppMode(value: unknown): value is AppMode {
  return value === "cut" || value === "sub";
}
