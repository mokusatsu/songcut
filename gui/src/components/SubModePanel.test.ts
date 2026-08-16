import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const subPanelSource = source("./SubModePanel.tsx");
const segmentAddDialogSource = source("./SegmentAddDialog.tsx");
const subtitleStyleSource = source("./SubtitleStyleEditor.tsx");
const subTimelineSource = source("./SubTimelineEditor.tsx");
const appSource = source("../App.tsx");
const styleSource = source("../styles.css");
const radixSelectSource = source("./ui/radix-select.tsx");
const subModeE2eSource = source("../../../packaging/e2e_sub_mode.js");

describe("SCUT-039 subtitle effect settings contract", () => {
  it("keeps type description, duration, and parameters in separate rows", () => {
    const typeRow = subtitleStyleSource.indexOf('className="subtitle-effect-type-row"');
    const durationRow = subtitleStyleSource.indexOf('className="subtitle-effect-duration-row"');
    const parameterGrid = subtitleStyleSource.indexOf('className="subtitle-effect-parameter-grid"');

    expect(typeRow).toBeGreaterThanOrEqual(0);
    expect(durationRow).toBeGreaterThan(typeRow);
    expect(parameterGrid).toBeGreaterThan(durationRow);
    expect(subtitleStyleSource).not.toContain("parameterDescription(");
    expect(styleSource).toContain(".subtitle-effect-type-row");
    expect(styleSource).toContain(".subtitle-effect-duration-row");
    expect(styleSource).toContain(".subtitle-effect-parameter-grid");
  });

  it("uses the grouped Radix selector while preserving catalog URLs as button links", () => {
    expect(subtitleStyleSource).toContain("<RadixSelectGroup");
    expect(subtitleStyleSource).toContain("<RadixSelectItem");
    expect(subtitleStyleSource).toContain("onValueChange={(name) => patchEffect");
    expect(subtitleStyleSource).toContain('className="button button-secondary button-sm subtitle-effect-link"');
    expect(subtitleStyleSource).toContain("effectDefinition.preview_url");
    expect(subtitleStyleSource).toContain("effectDefinition.catalog_page_url_en");
    expect(subtitleStyleSource).toContain("effectDefinition.catalog_page_url_ja");
    expect(subtitleStyleSource).toContain('className="subtitle-effect-link-actions"');
    expect(subtitleStyleSource).toContain("data-effect-id={item.effect_id}");
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
    expect(subtitleStyleSource).toContain('type="color"');
    expect(subtitleStyleSource).toContain('type="text"');
    expect(subtitleStyleSource).toContain('aria-label={tr("sub.bold")}');
    expect(subtitleStyleSource).toContain('aria-label={tr("sub.italic")}');
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

  it("removes the segment timing dialog and double-click launch route", () => {
    expect(subPanelSource).not.toContain("SegmentTimingDialog");
    expect(subPanelSource).not.toContain("onEditTiming");
    expect(subTimelineSource).not.toContain("onEditTiming");
  });

  it("routes the Sub segment action through the explicit add dialog", () => {
    expect(subPanelSource).toContain("props.actions.addSegment");
    expect(appSource).toContain('import { SegmentAddDialog }');
    expect(appSource).toContain("add: openSubtitleSegmentAddDialog");
    expect(appSource).toContain("<SegmentAddDialog");
    expect(appSource).toContain("selectedSegment={selectedSubtitleItems.length === 1");
    expect(appSource).not.toContain("add: addNewSubtitleSegment");
    expect(appSource).not.toContain("addFourBeatSegment");
    expect(segmentAddDialogSource).toContain("segmentAddPositionOptions");
    expect(segmentAddDialogSource).toContain('onConfirm({');
  });

  it("uses the shared font-size tokens throughout the segment add dialog", () => {
    expect(styleSource).toMatch(
      /\.segment-add-dialog\s*\{[\s\S]*?font-size: var\(--font-size-control\);/,
    );
    expect(styleSource).toMatch(
      /\.segment-add-field > span\s*\{[\s\S]*?font-size: inherit;/,
    );
    expect(styleSource).toMatch(
      /\.segment-add-field \.select\s*\{[\s\S]*?font-size: inherit;/,
    );
    expect(styleSource).toMatch(
      /\.segment-add-dialog \.dialog-message,[\s\S]*?\.segment-add-error\s*\{[\s\S]*?font-size: var\(--font-size-meta\);/,
    );
  });

  it("lays out Saved Styles as two full-width operation rows", () => {
    expect(subtitleStyleSource.match(/className="subtitle-style-preset-row"/g) ?? []).toHaveLength(2);
    expect(styleSource).toMatch(
      /\.subtitle-style-presets\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(styleSource).toMatch(
      /\.subtitle-style-preset-row\s*\{[\s\S]*?width: 100%;/,
    );
  });

  it("places Export Sub immediately after the built-in subtitle export action", () => {
    const builtInExport = subPanelSource.indexOf("exportAction={{");
    const fileExport = subPanelSource.indexOf("<FileOutput");

    expect(subPanelSource).toContain("SubtitleFileExportDialog");
    expect(subPanelSource).toContain("exportSubtitleFile:");
    expect(builtInExport).toBeGreaterThanOrEqual(0);
    expect(fileExport).toBeGreaterThan(builtInExport);
  });
});
