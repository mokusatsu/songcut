import type {
  SubModePanelActions,
  SubModePanelCapabilities,
  SubModePanelOperationView,
} from "@/lib/modePanelContract";
import type { ModeSession } from "@/lib/modeSession";
import type { LyricsSegment } from "@/lib/subtitles";
import type { SubOperationCoordinator } from "@/lib/useSubOperations";

type SubModeSession = ModeSession<LyricsSegment, string, SubOperationCoordinator>;

export type SubModePanelAdapter = {
  capabilities: SubModePanelCapabilities;
  operation: SubModePanelOperationView;
  actions: SubModePanelActions;
};

export type SubModePanelAdapterInput = {
  session: SubModeSession;
  load: SubModePanelActions["load"];
  openSettings: SubModePanelActions["openSettings"];
  prepareAnalysis: SubModePanelActions["prepareAnalysis"];
  exportSubtitles: SubModePanelActions["exportSubtitles"];
  listSystemFonts: SubModePanelActions["listSystemFonts"];
  confirmRemoveLane: SubModePanelActions["confirmRemoveLane"];
  showMessage: SubModePanelActions["showMessage"];
};

/**
 * Adapt the application-owned Sub session and platform callbacks to the
 * presentation-only panel contract. Raw controllers/coordinators stop here.
 */
export function createSubModePanelAdapter(input: SubModePanelAdapterInput): SubModePanelAdapter {
  const { controller, operations } = input.session;
  return {
    capabilities: {
      canAddSegment: controller.capabilities.canAddSegment,
      canDeleteSelectedSegment: controller.capabilities.canDeleteSelectedSegment,
    },
    operation: {
      analysisJob: operations.analysisJob,
      exportJob: operations.exportJob,
      busy: operations.busy,
    },
    actions: {
      load: input.load,
      openSettings: input.openSettings,
      prepareAnalysis: input.prepareAnalysis,
      analyzeLyrics: operations.analyzeLyrics,
      exportSubtitles: input.exportSubtitles,
      renderSubtitles: operations.renderSubtitles,
      invalidateSubtitleRender: operations.invalidateSubtitleRender,
      listSystemFonts: input.listSystemFonts,
      confirmRemoveLane: input.confirmRemoveLane,
      selectSegment: (laneId, segment) => controller.actions.select(segment, laneId),
      addSegment: controller.actions.add,
      removeSelectedSegment: controller.actions.remove,
      showMessage: input.showMessage,
    },
  };
}
