import type { AppMode } from "@/lib/modes";
import {
  createModeController,
  type ModeController,
  type ModeControllerActions,
  type ModeControllerCapabilities,
} from "@/lib/modeController";
import {
  createModePanelViewModel,
  type ModeMediaViewModel,
  type ModePanelViewModel,
  type ModeTransportViewModel,
} from "@/lib/modeViewModel";

/**
 * Symmetric composition boundary for Cut and Sub.
 *
 * Operations remain mode-specific (their endpoint, state adapter, and result
 * type are intentionally not widened here), while controller and common panel
 * media/transport values are exposed at the same level for both modes.
 */
export type ModeSession<TSelection, TSelectionContext, TOperations> = {
  mode: AppMode;
  controller: ModeController<TSelection, TSelectionContext>;
  operations: TOperations;
  view: ModePanelViewModel;
};

export type ModeSessionConfig<TSelection, TSelectionContext, TOperations> = {
  mode: AppMode;
  capabilities: ModeControllerCapabilities;
  actions: Partial<ModeControllerActions<TSelection, TSelectionContext>>;
  operations: TOperations;
  media: ModeMediaViewModel;
  transport: ModeTransportViewModel;
};

/**
 * Build one mode session from the render's current callbacks and state.
 * `createModeController` supplies the shared capability guards; this factory
 * only adds the mode operation coordinator and the common panel view model.
 */
export function createModeSession<TSelection, TSelectionContext = undefined, TOperations = undefined>(
  config: ModeSessionConfig<TSelection, TSelectionContext, TOperations>,
): ModeSession<TSelection, TSelectionContext, TOperations> {
  return {
    mode: config.mode,
    controller: createModeController<TSelection, TSelectionContext>({
      mode: config.mode,
      capabilities: config.capabilities,
      actions: config.actions,
    }),
    operations: config.operations,
    view: createModePanelViewModel(config.media, config.transport),
  };
}
