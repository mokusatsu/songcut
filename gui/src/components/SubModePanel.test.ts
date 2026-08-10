import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const subPanelSource = source("./SubModePanel.tsx");
const styleSource = source("../styles.css");
const radixSelectSource = source("./ui/radix-select.tsx");
const subModeE2eSource = source("../../../packaging/e2e_sub_mode.js");

describe("SCUT-039 subtitle effect settings contract", () => {
  it("keeps type description, duration, and parameters in separate rows", () => {
    const typeRow = subPanelSource.indexOf('className="subtitle-effect-type-row"');
    const durationRow = subPanelSource.indexOf('className="subtitle-effect-duration-row"');
    const parameterGrid = subPanelSource.indexOf('className="subtitle-effect-parameter-grid"');

    expect(typeRow).toBeGreaterThanOrEqual(0);
    expect(durationRow).toBeGreaterThan(typeRow);
    expect(parameterGrid).toBeGreaterThan(durationRow);
    expect(subPanelSource).not.toContain("parameterDescription(");
    expect(styleSource).toContain(".subtitle-effect-type-row");
    expect(styleSource).toContain(".subtitle-effect-duration-row");
    expect(styleSource).toContain(".subtitle-effect-parameter-grid");
  });

  it("uses the grouped Radix selector while preserving catalog URLs as button links", () => {
    expect(subPanelSource).toContain("<RadixSelectGroup");
    expect(subPanelSource).toContain("<RadixSelectItem");
    expect(subPanelSource).toContain("onValueChange={(name) => patchEffect");
    expect(subPanelSource).toContain('className="button button-secondary button-sm subtitle-effect-link"');
    expect(subPanelSource).toContain("effectDefinition.preview_url");
    expect(subPanelSource).toContain("effectDefinition.catalog_page_url_en");
    expect(subPanelSource).toContain("effectDefinition.catalog_page_url_ja");
    expect(subPanelSource).toContain('className="subtitle-effect-link-actions"');
    expect(subPanelSource).toContain("data-effect-id={item.effect_id}");
    expect(radixSelectSource).toContain("SelectPrimitive.Viewport");
    expect(radixSelectSource).toContain("SelectPrimitive.ScrollUpButton");
    expect(radixSelectSource).toContain("SelectPrimitive.ScrollDownButton");
    expect(styleSource).toMatch(/\.radix-select-content\s*\{[\s\S]*?z-index: 60;/);
    expect(subModeE2eSource).toContain(".radix-select-trigger");
    expect(subModeE2eSource).toContain('[data-effect-id="fad"]');
    expect(subModeE2eSource).toContain('[data-effect-id="glow"]');
    expect(
      subModeE2eSource.match(/item\.dispatchEvent\(new PointerEvent\("pointerup"/g) ?? [],
    ).toHaveLength(2);
    expect(subModeE2eSource).not.toContain(".subtitle-effect-section select");
  });

  it("keeps the editable color value alongside the picker without fixed overflow", () => {
    expect(subPanelSource).toContain('type="color"');
    expect(subPanelSource).toContain('type="text"');
    expect(subPanelSource).toContain('aria-label={tr("sub.bold")}');
    expect(subPanelSource).toContain('aria-label={tr("sub.italic")}');
    expect(styleSource).toContain(".color-control .input[type=\"text\"]");
    expect(styleSource).toContain("width: 88px;");
    expect(styleSource).toContain("height: auto;");
  });

  it("collapses every effect row to one column on narrow dialogs", () => {
    expect(styleSource).toMatch(
      /\.subtitle-effect-type-row,[\s\S]*\.subtitle-effect-duration-row,[\s\S]*\.subtitle-effect-parameter-grid\s*\{\s*grid-template-columns: 1fr;/,
    );
    expect(styleSource).toMatch(
      /\.subtitle-effect-link-actions\s*\{\s*display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it("centers the preview and keeps link buttons in one centered row", () => {
    expect(styleSource).toMatch(
      /\.subtitle-effect-links\s*\{[\s\S]*justify-items: center;/,
    );
    expect(styleSource).toMatch(
      /\.subtitle-effect-link-actions\s*\{[\s\S]*justify-content: center;[\s\S]*flex-wrap: wrap;/,
    );
  });

  it("keeps the subtitle style dialog on an always-visible shadcn vertical scrollbar", () => {
    expect(subPanelSource).toContain('className="subtitle-style-scroll"');
    expect(subPanelSource).toContain('viewportClassName="subtitle-style-scroll-viewport"');
    expect(subPanelSource).toContain('scrollbars={["vertical"]}');
    expect(subPanelSource).toContain('type="always"');
  });
});
