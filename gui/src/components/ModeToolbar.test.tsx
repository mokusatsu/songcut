import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ModeToolbar } from "@/components/ModeToolbar";
import type { ModeTransportViewModel } from "@/lib/modeViewModel";

const styleSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const noop = () => undefined;

const transport: ModeTransportViewModel = {
  saveStatus: "Saved",
  boundaryPreview: {
    disabled: false,
    value: "5",
    onChange: noop,
    onBlur: noop,
    onStart: noop,
    onEnd: noop,
  },
  boundaryNudge: {
    kind: "seconds",
    disabled: false,
    value: "0.2",
    onChange: noop,
    onBlur: noop,
    onLeft: noop,
    onRight: noop,
  },
  playback: {
    onStart: noop,
    onPrevious: noop,
    onPlay: noop,
    onPause: noop,
    onNext: noop,
  },
  zoom: {
    value: 1,
    onIn: noop,
    onOut: noop,
    onReset: noop,
  },
};

describe("ModeToolbar compact workspace header", () => {
  it("places the shared information trigger with commands and keeps transport compact", () => {
    const markup = renderToStaticMarkup(
      <ModeToolbar
        className="sub-toolbar"
        transport={transport}
        information={<button data-project-information="true">Information</button>}
        load={{ onClick: noop }}
        analyze={{ onClick: noop }}
        exportAction={{ onClick: noop, icon: <span>export-icon</span> }}
        settings={{ onClick: noop }}
      />,
    );

    expect(markup).toContain('class="mode-workspace-header sub-toolbar"');
    expect(markup).toContain('class="mode-workspace-controls"');
    expect(markup).toContain('class="toolbar mode-toolbar-actions"');
    expect(markup).toContain('class="mode-transport-toolbar"');
    expect(markup).toContain('data-project-information="true"');
    expect(markup).not.toContain("mode-workspace-status");
    expect(markup).toContain('class="project-save-status"');
    expect(markup).not.toContain("guide-row");
  });

  it("keeps all common action buttons on one compact icon row at narrow workspace widths", () => {
    expect(styleSource).toMatch(
      /@media \(max-width: 1250px\) \{[\s\S]*?\.mode-toolbar-actions \{\s*flex-wrap: nowrap;/,
    );
    expect(styleSource).toMatch(
      /\.mode-toolbar-actions > \.button \{[\s\S]*?flex: 0 0 38px;[\s\S]*?font-size: 0;/,
    );
  });
});
