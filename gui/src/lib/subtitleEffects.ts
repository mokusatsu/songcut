export const SUBTITLE_EFFECTS = [
  { name: "cut", label: "なし（カット）", params: [] },
  { name: "fad", label: "通常フェード", params: [] },
  { name: "fade", label: "多段階フェード", params: [] },
  { name: "alpha", label: "透明度アニメーション", params: [] },
  { name: "zoom", label: "ズーム", params: [numberParam("min_scale", "最小倍率（%）", 0, 0, 99)] },
  { name: "pop", label: "ポップ", params: [numberParam("overshoot", "最大倍率（%）", 122, 101, 200)] },
  {
    name: "bounce",
    label: "バウンス",
    params: [
      numberParam("peak", "ピーク倍率（%）", 128, 105, 220),
      numberParam("valley", "谷倍率（%）", 88, 40, 99),
      numberParam("rebound", "反発倍率（%）", 108, 101, 160),
    ],
  },
  { name: "slide", label: "スライド", params: [directionParam()] },
  { name: "wipe", label: "ワイプ", params: [directionParam()] },
  { name: "blur", label: "ブラー", params: [numberParam("radius", "ブラー半径", 14, 0.1, 100, 0.1)] },
  {
    name: "rotate",
    label: "回転",
    params: [
      selectParam("direction", "方向", "clockwise", [
        ["clockwise", "時計回り"],
        ["counterclockwise", "反時計回り"],
      ]),
      numberParam("degrees", "回転角度", 120, 1, 1440),
    ],
  },
  {
    name: "flip",
    label: "3Dフリップ",
    params: [
      axisParam(),
      numberParam("degrees", "回転角度", 90, 1, 720),
    ],
  },
  { name: "spacing", label: "文字間隔", params: [numberParam("spacing", "文字間隔", 42, 0.1, 300, 0.1)] },
  {
    name: "stretch",
    label: "ストレッチ",
    params: [axisParam(), numberParam("min_scale", "最小倍率（%）", 0, 0, 99)],
  },
  { name: "outline", label: "輪郭", params: [numberParam("border", "輪郭幅", 4, 0.1, 30, 0.1)] },
  {
    name: "glow",
    label: "グロー",
    params: [
      numberParam("radius", "発光半径", 16, 0.1, 100, 0.1),
      numberParam("border", "発光幅", 16, 0.1, 100, 0.1),
      { kind: "color", name: "color", label: "発光色", defaultValue: "#42D7FF" },
    ],
  },
  {
    name: "flicker",
    label: "フリッカー",
    params: [
      numberParam("interval_ms", "点滅間隔（ms）", 90, 20, 1000),
      numberParam("seed", "乱数シード", 1701, 0, 2147483647),
    ],
  },
  {
    name: "typewriter",
    label: "タイプライター",
    params: [horizontalDirectionParam()],
  },
  {
    name: "karaoke",
    label: "カラオケ・スイープ",
    params: [horizontalDirectionParam()],
  },
  {
    name: "scanline",
    label: "スキャンライン",
    params: [
      directionParam(),
      numberParam("steps", "分割数", 24, 2, 200),
      numberParam("softness_ms", "柔らかさ（ms）", 70, 0, 1000),
    ],
  },
  {
    name: "distort",
    label: "ディストーション",
    params: [
      horizontalDirectionParam(),
      numberParam("amount", "歪み量", 1.25, 0.05, 5, 0.05),
    ],
  },
  {
    name: "glitch",
    label: "グリッチ",
    params: [
      numberParam("slices", "スライス数", 28, 3, 300),
      numberParam("intensity", "強度", 28, 1, 300),
      numberParam("seed", "乱数シード", 2207, 0, 2147483647),
    ],
  },
  {
    name: "dissolve",
    label: "ディゾルブ",
    params: [
      numberParam("columns", "列数", 12, 2, 50),
      numberParam("rows", "行数", 5, 2, 30),
      numberParam("seed", "乱数シード", 2311, 0, 2147483647),
      numberParam("blur", "ブラー", 4, 0, 30, 0.1),
    ],
  },
] satisfies readonly SubtitleEffectDefinition[];

export type SubtitleEffectName = (typeof SUBTITLE_EFFECTS)[number]["name"];
export type SubtitleEffectParameterValue = string | number;
export type SubtitleEffectSettings = {
  name: SubtitleEffectName;
  start_duration_ms: number;
  end_duration_ms: number;
  params: Record<string, SubtitleEffectParameterValue>;
};

export type SubtitleEffectParameter =
  | {
      kind: "number";
      name: string;
      label: string;
      defaultValue: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      kind: "select";
      name: string;
      label: string;
      defaultValue: string;
      options: readonly (readonly [string, string])[];
    }
  | {
      kind: "color";
      name: string;
      label: string;
      defaultValue: string;
    };

type SubtitleEffectDefinition = {
  name: string;
  label: string;
  params: readonly SubtitleEffectParameter[];
};

export const DEFAULT_SUBTITLE_EFFECT: SubtitleEffectSettings = {
  name: "cut",
  start_duration_ms: 300,
  end_duration_ms: 300,
  params: {},
};

/** `subtitleEffectDefinition`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
export function subtitleEffectDefinition(name: string) {
  return SUBTITLE_EFFECTS.find((effect) => effect.name === name) ?? SUBTITLE_EFFECTS[0];
}

/** `defaultSubtitleEffectParams`で定義済みschemaに沿った初期parameterを生成する。 */
export function defaultSubtitleEffectParams(name: string) {
  return Object.fromEntries(
    subtitleEffectDefinition(name).params.map((parameter) => [parameter.name, parameter.defaultValue])
  );
}

/** `normalizeSubtitleEffect`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeSubtitleEffect(value: unknown): SubtitleEffectSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SUBTITLE_EFFECT, params: {} };
  const candidate = value as Partial<SubtitleEffectSettings>;
  const definition = subtitleEffectDefinition(String(candidate.name ?? "cut"));
  const supplied = candidate.params && typeof candidate.params === "object" ? candidate.params : {};
  const params = Object.fromEntries(
    definition.params.map((parameter) => {
      const current = supplied[parameter.name];
      return [
        parameter.name,
        typeof current === "string" || typeof current === "number"
          ? current
          : parameter.defaultValue,
      ];
    })
  );
  return {
    name: definition.name as SubtitleEffectName,
    start_duration_ms: nonnegativeInteger(candidate.start_duration_ms, 300),
    end_duration_ms: nonnegativeInteger(candidate.end_duration_ms, 300),
    params,
  };
}

function nonnegativeInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function numberParam(
  name: string,
  label: string,
  defaultValue: number,
  min: number,
  max: number,
  step = 1
): SubtitleEffectParameter {
  return { kind: "number", name, label, defaultValue, min, max, step };
}

function selectParam(
  name: string,
  label: string,
  defaultValue: string,
  options: readonly (readonly [string, string])[]
): SubtitleEffectParameter {
  return { kind: "select", name, label, defaultValue, options };
}

function horizontalDirectionParam() {
  return selectParam("direction", "方向", "left_to_right", [
    ["left_to_right", "左から右"],
    ["right_to_left", "右から左"],
  ]);
}

function directionParam() {
  return selectParam("direction", "方向", "left_to_right", [
    ["left_to_right", "左から右"],
    ["right_to_left", "右から左"],
    ["top_to_bottom", "上から下"],
    ["bottom_to_top", "下から上"],
  ]);
}

function axisParam() {
  return selectParam("direction", "方向", "horizontal", [
    ["horizontal", "水平"],
    ["vertical", "垂直"],
  ]);
}
