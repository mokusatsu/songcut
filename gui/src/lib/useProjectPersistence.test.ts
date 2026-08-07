import { describe, expect, it } from "vitest";
import type { ProjectDocumentV1 } from "@/lib/project";
import { projectAutoSaveKey } from "@/lib/useProjectPersistence";

describe("project persistence autosave key", () => {
  it("does not change for playback cursor updates in Cut or Sub", () => {
    for (const mode of ["cut", "sub"] as const) {
      const first = projectDocument(mode, 1, 12.5);
      const moved = projectDocument(mode, 1, 48.25);

      expect(projectAutoSaveKey(`video.${mode}.songcut`, moved)).toBe(
        projectAutoSaveKey(`video.${mode}.songcut`, first)
      );
    }
  });

  it("changes for an explicit project edit revision", () => {
    for (const mode of ["cut", "sub"] as const) {
      const before = projectDocument(mode, 3, 12.5);
      const edited = projectDocument(mode, 4, 12.5);

      expect(projectAutoSaveKey(`video.${mode}.songcut`, edited)).not.toBe(
        projectAutoSaveKey(`video.${mode}.songcut`, before)
      );
    }
  });
});

function projectDocument(mode: "cut" | "sub", revision: number, currentTime: number) {
  return {
    project_id: `project-${mode}`,
    revision,
    view_state: {
      selected_segment_id: null,
      current_time: currentTime,
      zoom_index: 0,
    },
  } as ProjectDocumentV1;
}
