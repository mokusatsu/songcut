import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 条件付きclass名を結合し、Tailwind CSSの競合を解消したclass文字列を返す。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
