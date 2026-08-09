/** JSON-safe values accepted by the public effect catalogue. */
export type SubtitleEffectParameterValue = string | number | boolean | string[];
export type SubtitleEffectName = string;
export type SubtitleEffectParameterKind =
  | "integer"
  | "number"
  | "choice"
  | "color"
  | "palette"
  | "string"
  | "boolean";

export type SubtitleEffectChoice = string;

export type SubtitleEffectParameterSchema = {
  kind: SubtitleEffectParameterKind;
  default: SubtitleEffectParameterValue;
  min: number | null;
  max: number | null;
  step: number | null;
  choices: readonly SubtitleEffectChoice[];
  choice_labels_en: Record<string, string>;
  choice_labels_ja: Record<string, string>;
  label_en: string;
  label_ja: string;
  description_en: string;
  description_ja: string;
};

export type SubtitleEffectCapabilities = {
  requires_context?: boolean;
  multiline_mode?: string;
  cost_class?: string;
  strict_input_tags?: Record<string, unknown>;
};

export type SubtitleEffectDefinition = {
  effect_id: string;
  stable_effect_id: boolean;
  name_en: string;
  name_ja: string;
  description_en: string;
  description_ja: string;
  major_category_en?: string;
  major_category_ja?: string;
  subcategory_en?: string;
  subcategory_ja?: string;
  family?: string;
  display_number?: number;
  family_local_number?: number;
  traits?: readonly string[];
  parameters: Record<string, SubtitleEffectParameterSchema>;
  capabilities?: SubtitleEffectCapabilities;
  preview_url?: string | null;
  catalog_page_url_en?: string | null;
  catalog_page_url_ja?: string | null;
};

export type SubtitleEffectCatalog = {
  package: string;
  version: string;
  schema_version: string;
  stable_id_contract: Record<string, unknown>;
  multiline_context_contract: Record<string, unknown>;
  pages?: {
    base_url?: string;
    catalog_page_url_en?: string;
    catalog_page_url_ja?: string;
  };
  effects: readonly SubtitleEffectDefinition[];
};

export type SubtitleEffectSettings = {
  name: SubtitleEffectName;
  start_duration_ms: number;
  end_duration_ms: number;
  params: Record<string, SubtitleEffectParameterValue>;
};

/** The default is only the stable no-op ID; all effect metadata comes from the catalog. */
export const DEFAULT_SUBTITLE_EFFECT: SubtitleEffectSettings = {
  name: "cut",
  start_duration_ms: 300,
  end_duration_ms: 300,
  params: {},
};

/** `subtitleEffectDefinition`で明示catalogからstable effect IDを解決する。 */
export function subtitleEffectDefinition(name: string, catalog: SubtitleEffectCatalog) {
  return catalog.effects.find((effect) => effect.effect_id === name);
}

/** `requireSubtitleEffectDefinition`でeffect IDを解決し、未知値を明示エラーにする。 */
export function requireSubtitleEffectDefinition(name: string, catalog: SubtitleEffectCatalog) {
  const definition = subtitleEffectDefinition(name, catalog);
  if (!definition) throw new Error(`Unknown subtitle effect_id: ${JSON.stringify(name)}`);
  return definition;
}

/** `defaultSubtitleEffectParams`でbackend schema由来の既定parameterを作る。 */
export function defaultSubtitleEffectParams(name: string, catalog: SubtitleEffectCatalog) {
  const definition = requireSubtitleEffectDefinition(name, catalog);
  return Object.fromEntries(
    Object.entries(definition.parameters).map(([parameterName, parameter]) => [
      parameterName,
      cloneParameterValue(parameter.default),
    ]),
  ) as Record<string, SubtitleEffectParameterValue>;
}

/** `normalizeSubtitleEffect`で明示catalogに沿って設定を検証し、未知値をエラーにする。 */
export function normalizeSubtitleEffect(
  value: unknown,
  catalog: SubtitleEffectCatalog,
): SubtitleEffectSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid subtitle effect settings.");
  }
  const candidate = value as Partial<SubtitleEffectSettings>;
  if (typeof candidate.name !== "string") throw new Error("Subtitle effect_id is required.");
  const definition = requireSubtitleEffectDefinition(candidate.name, catalog);
  const supplied = candidate.params;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw new Error(`Subtitle effect params for ${JSON.stringify(candidate.name)} must be an object.`);
  }
  const suppliedParams = supplied as Record<string, unknown>;
  const unknown = Object.keys(suppliedParams).filter((name) => !(name in definition.parameters));
  if (unknown.length) {
    throw new Error(
      `Unknown subtitle effect parameter(s) for ${JSON.stringify(candidate.name)}: ${unknown.join(", ")}`,
    );
  }
  const params = Object.fromEntries(
    Object.entries(definition.parameters).map(([name, schema]) => [
      name,
      normalizeParameterValue(suppliedParams[name], schema),
    ]),
  ) as Record<string, SubtitleEffectParameterValue>;
  return {
    name: definition.effect_id,
    start_duration_ms: nonnegativeInteger(candidate.start_duration_ms, 300),
    end_duration_ms: nonnegativeInteger(candidate.end_duration_ms, 300),
    params,
  };
}

/** `parseSubtitleEffectCatalog`で取得JSONをUI公開前に検証する。 */
export function parseSubtitleEffectCatalog(value: unknown): SubtitleEffectCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid subtitle effect catalog response.");
  }
  const candidate = value as Partial<SubtitleEffectCatalog>;
  if (
    typeof candidate.package !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.schema_version !== "string" ||
    !candidate.stable_id_contract ||
    typeof candidate.stable_id_contract !== "object" ||
    !candidate.multiline_context_contract ||
    typeof candidate.multiline_context_contract !== "object" ||
    !Array.isArray(candidate.effects)
  ) {
    throw new Error("Invalid subtitle effect catalog response.");
  }
  const effects = candidate.effects.map((raw, effectIndex) => parseEffectDefinition(raw, effectIndex));
  const ids = new Set<string>();
  for (const effect of effects) {
    if (ids.has(effect.effect_id)) throw new Error(`Duplicate subtitle effect_id: ${effect.effect_id}`);
    ids.add(effect.effect_id);
  }
  if (!effects.length) throw new Error("Subtitle effect catalog contains no effects.");
  return {
    package: candidate.package,
    version: candidate.version,
    schema_version: candidate.schema_version,
    stable_id_contract: candidate.stable_id_contract as Record<string, unknown>,
    multiline_context_contract: candidate.multiline_context_contract as Record<string, unknown>,
    pages: isRecord(candidate.pages) ? candidate.pages as SubtitleEffectCatalog["pages"] : undefined,
    effects,
  };
}

function parseEffectDefinition(value: unknown, effectIndex: number): SubtitleEffectDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid subtitle effect definition at index ${effectIndex}.`);
  }
  const candidate = value as Partial<SubtitleEffectDefinition>;
  if (
    typeof candidate.effect_id !== "string" ||
    !candidate.effect_id ||
    candidate.stable_effect_id !== true ||
    typeof candidate.name_en !== "string" ||
    typeof candidate.name_ja !== "string" ||
    typeof candidate.description_en !== "string" ||
    typeof candidate.description_ja !== "string" ||
    !candidate.parameters ||
    typeof candidate.parameters !== "object" ||
    Array.isArray(candidate.parameters)
  ) {
    throw new Error(`Invalid subtitle effect definition at index ${effectIndex}.`);
  }
  const parameters = Object.fromEntries(
    Object.entries(candidate.parameters).map(([name, parameter]) => [name, parseParameterSchema(name, parameter)]),
  );
  return {
    effect_id: candidate.effect_id,
    stable_effect_id: true,
    name_en: candidate.name_en,
    name_ja: candidate.name_ja,
    description_en: candidate.description_en,
    description_ja: candidate.description_ja,
    major_category_en: candidate.major_category_en,
    major_category_ja: candidate.major_category_ja,
    subcategory_en: candidate.subcategory_en,
    subcategory_ja: candidate.subcategory_ja,
    family: candidate.family,
    display_number: candidate.display_number,
    family_local_number: candidate.family_local_number,
    traits: candidate.traits,
    parameters,
    capabilities: candidate.capabilities,
    preview_url: candidate.preview_url,
    catalog_page_url_en: candidate.catalog_page_url_en,
    catalog_page_url_ja: candidate.catalog_page_url_ja,
  };
}

function parseParameterSchema(name: string, value: unknown): SubtitleEffectParameterSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid schema for subtitle effect parameter ${JSON.stringify(name)}.`);
  }
  const candidate = value as Partial<SubtitleEffectParameterSchema>;
  const validKinds: SubtitleEffectParameterKind[] = [
    "integer",
    "number",
    "choice",
    "color",
    "palette",
    "string",
    "boolean",
  ];
  if (
    typeof candidate.kind !== "string" ||
    !validKinds.includes(candidate.kind as SubtitleEffectParameterKind) ||
    !isParameterValue(candidate.default) ||
    !Array.isArray(candidate.choices) ||
    !candidate.choices.every((choice) => typeof choice === "string") ||
    !isStringRecord(candidate.choice_labels_en) ||
    !isStringRecord(candidate.choice_labels_ja) ||
    typeof candidate.label_en !== "string" ||
    typeof candidate.label_ja !== "string" ||
    typeof candidate.description_en !== "string" ||
    typeof candidate.description_ja !== "string"
  ) {
    throw new Error(`Invalid schema for subtitle effect parameter ${JSON.stringify(name)}.`);
  }
  const choices = candidate.choices as readonly string[];
  const expectedChoiceLabels = new Set(choices);
  const actualEnLabels = new Set(Object.keys(candidate.choice_labels_en));
  const actualJaLabels = new Set(Object.keys(candidate.choice_labels_ja));
  if (
    actualEnLabels.size !== expectedChoiceLabels.size ||
    actualJaLabels.size !== expectedChoiceLabels.size ||
    [...expectedChoiceLabels].some((choice) => !actualEnLabels.has(choice) || !actualJaLabels.has(choice))
  ) {
    throw new Error(`Choice labels for subtitle effect parameter ${JSON.stringify(name)} must match choices.`);
  }
  if (candidate.kind !== "choice" && choices.length > 0) {
    throw new Error(`Non-choice subtitle effect parameter ${JSON.stringify(name)} cannot declare choices.`);
  }
  const min = candidate.min === null || candidate.min === undefined ? null : finiteNumber(candidate.min, name, "min");
  const max = candidate.max === null || candidate.max === undefined ? null : finiteNumber(candidate.max, name, "max");
  const step = candidate.step === null || candidate.step === undefined ? null : finiteNumber(candidate.step, name, "step");
  if (min !== null && max !== null && min > max) {
    throw new Error(`Subtitle effect parameter ${JSON.stringify(name)} has an inverted range.`);
  }
  return {
    kind: candidate.kind as SubtitleEffectParameterKind,
    default: cloneParameterValue(candidate.default),
    min,
    max,
    step,
    choices: choices as readonly SubtitleEffectChoice[],
    choice_labels_en: candidate.choice_labels_en as Record<string, string>,
    choice_labels_ja: candidate.choice_labels_ja as Record<string, string>,
    label_en: candidate.label_en,
    label_ja: candidate.label_ja,
    description_en: candidate.description_en,
    description_ja: candidate.description_ja,
  };
}

function normalizeParameterValue(value: unknown, schema: SubtitleEffectParameterSchema): SubtitleEffectParameterValue {
  if (value === undefined) return cloneParameterValue(schema.default);
  switch (schema.kind) {
    case "integer": {
      const number = Number(value);
      if (!Number.isFinite(number)) return cloneParameterValue(schema.default);
      return clampParameter(Math.round(number), schema);
    }
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number)) return cloneParameterValue(schema.default);
      return clampParameter(number, schema);
    }
    case "choice": {
      const choice = schema.choices.find((item) => choiceValue(item) === value);
      return choice === undefined ? cloneParameterValue(schema.default) : cloneParameterValue(choiceValue(choice));
    }
    case "color":
    case "string":
      return typeof value === "string" ? value : cloneParameterValue(schema.default);
    case "boolean":
      return typeof value === "boolean" ? value : cloneParameterValue(schema.default);
    case "palette":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? [...value]
        : cloneParameterValue(schema.default);
  }
}

function clampParameter(value: number, schema: SubtitleEffectParameterSchema) {
  const minimum = schema.min === null ? value : schema.min;
  const maximum = schema.max === null ? value : schema.max;
  return Math.min(maximum, Math.max(minimum, value));
}

function choiceValue(choice: SubtitleEffectChoice): string {
  return choice;
}

function isParameterValue(value: unknown): value is SubtitleEffectParameterValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function cloneParameterValue(value: SubtitleEffectParameterValue): SubtitleEffectParameterValue {
  return Array.isArray(value) ? [...value] : value;
}

function finiteNumber(value: unknown, name: string, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Subtitle effect parameter ${JSON.stringify(name)} has an invalid ${field}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function nonnegativeInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}
