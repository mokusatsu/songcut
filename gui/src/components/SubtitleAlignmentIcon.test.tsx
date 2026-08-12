import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubtitleAlignmentIcon } from "@/components/SubtitleAlignmentIcon";

describe("SubtitleAlignmentIcon", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    "fills only alignment %i in the nine-cell grid",
    (alignment) => {
      const markup = renderToStaticMarkup(
        <SubtitleAlignmentIcon alignment={alignment} />
      );

      expect(markup.match(/<rect/g)).toHaveLength(9);
      expect(markup.match(/fill="currentColor"/g)).toHaveLength(1);
      expect(markup).toMatch(
        new RegExp(`data-alignment="${alignment}"[^>]*fill="currentColor"`)
      );
    }
  );
});
