import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSubtitleEffectCatalog } from "@/lib/api";
import {
  parseSubtitleEffectCatalog,
  type SubtitleEffectCatalog,
} from "@/lib/subtitleEffects";

export type SubtitleEffectCatalogState =
  | { status: "loading"; catalog: null; error: null }
  | { status: "ready"; catalog: SubtitleEffectCatalog; error: null }
  | { status: "error"; catalog: null; error: string };

const initialState: SubtitleEffectCatalogState = {
  status: "loading",
  catalog: null,
  error: null,
};

const SubtitleEffectCatalogContext = createContext<SubtitleEffectCatalogState>(initialState);

/** `useSubtitleEffectCatalog`のAPI base URLごとのcatalog取得状態を管理する。 */
export function useSubtitleEffectCatalog(apiBaseUrl: string): SubtitleEffectCatalogState {
  const [state, setState] = useState<SubtitleEffectCatalogState>(initialState);
  useEffect(() => {
    if (!apiBaseUrl) {
      setState(initialState);
      return;
    }
    let cancelled = false;
    setState({ status: "loading", catalog: null, error: null });
    getSubtitleEffectCatalog(apiBaseUrl)
      .then((value) => {
        if (cancelled) return;
        try {
          setState({ status: "ready", catalog: parseSubtitleEffectCatalog(value), error: null });
        } catch (error) {
          setState({ status: "error", catalog: null, error: String(error) });
        }
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", catalog: null, error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);
  return state;
}

/** `SubtitleEffectCatalogProvider`でCut/Subと子dialogへcatalogを共有する。 */
export function SubtitleEffectCatalogProvider(props: {
  state: SubtitleEffectCatalogState;
  children: ReactNode;
}) {
  const value = useMemo(() => props.state, [props.state]);
  return (
    <SubtitleEffectCatalogContext.Provider value={value}>
      {props.children}
    </SubtitleEffectCatalogContext.Provider>
  );
}

/** `useSubtitleEffectCatalogContext`で共有catalog取得状態を読み取る。 */
export function useSubtitleEffectCatalogContext() {
  return useContext(SubtitleEffectCatalogContext);
}
