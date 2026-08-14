import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  SubSegmentStyleInspector,
  subtitleSelectionStyleMode,
} from "@/components/SubSegmentStyleInspector";
import type { SubtitleEffectCatalog } from "@/lib/subtitleEffects";
import { createLyricsLane, type LyricsSegment } from "@/lib/subtitles";

const catalog = {
  package: "ass-lyric-effects",
  version: "3.0.0",
  schema_version: "1.0",
  stable_id_contract: {},
  multiline_context_contract: {},
  effects: [
    {
      effect_id: "cut",
      stable_effect_id: true,
      name_en: "Cut",
      name_ja: "カット",
      description_en: "",
      description_ja: "",
      parameters: {},
    },
  ],
} as SubtitleEffectCatalog;

function segment(id: string): LyricsSegment {
  return {
    id,
    text: id,
    start: 0,
    end: 1,
    confidence: 1,
    low_confidence_outlier: false,
    user_edited: false,
    source: "lyrics",
  };
}

describe("SubSegmentStyleInspector", () => {
  it("hides every detailed setting while the selection inherits its timeline style", () => {
    const lane = createLyricsLane(2, "Timeline 1");
    const inherited = segment("line-1");
    lane.segments = [inherited];

    const html = renderToStaticMarkup(
      <SubSegmentStyleInspector
        lanes={[lane]}
        selections={[{ laneId: lane.id, segment: inherited }]}
        primary={{ laneId: lane.id, segment: inherited }}
        catalog={catalog}
        fonts={null}
        fontListError={null}
        onCommit={vi.fn()}
      />,
    );

    expect(html).toContain("checked=\"\"");
    expect(html).not.toContain("subtitle-style-layout");
    expect(html).not.toContain("subtitle-effect-type-control");
    expect(html).not.toContain("segment-style-editor-frame");
  });

  it("distinguishes uniform and mixed modes for batch editing", () => {
    expect(subtitleSelectionStyleMode(["inherit", "inherit"])).toBe("inherit");
    expect(subtitleSelectionStyleMode(["custom", "custom"])).toBe("custom");
    expect(subtitleSelectionStyleMode(["inherit", "custom"])).toBe("mixed");
  });
});
