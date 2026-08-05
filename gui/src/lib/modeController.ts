import type { AppMode } from "@/lib/modes";

export type ModeDirection = -1 | 1;
export type BoundaryEdge = "start" | "end";

/**
 * Capabilities shared by the editor command surface.  Mode-specific domain
 * state stays in the owning panel; this is only the availability snapshot
 * needed by menu, keyboard, and transport actions.
 */
export type ModeControllerCapabilities = {
  hasSegments: boolean;
  hasSelectedSegment: boolean;
  hasMultipleSegments: boolean;
  canAddSegment: boolean;
  canDeleteSelectedSegment: boolean;
  canSelectPreviousSegment: boolean;
  canSelectNextSegment: boolean;
  canJumpBoundary: boolean;
  canPlayBoundary: boolean;
  canNudgeBoundary: boolean;
};

export type ModeControllerActions<TSelection, TSelectionContext = undefined> = {
  select: (selection: TSelection, context?: TSelectionContext) => void;
  add: () => void;
  remove: () => void;
  selectAdjacent: (direction: ModeDirection) => void;
  jumpBoundary: (direction: ModeDirection) => void;
  playBoundary: (edge: BoundaryEdge) => void;
  nudge: (direction: ModeDirection) => void;
};

export type ModeController<TSelection, TSelectionContext = undefined> = {
  mode: AppMode;
  capabilities: ModeControllerCapabilities;
  actions: ModeControllerActions<TSelection, TSelectionContext>;
};

type ModeControllerConfig<TSelection, TSelectionContext> = {
  mode: AppMode;
  capabilities: ModeControllerCapabilities;
  actions: Partial<ModeControllerActions<TSelection, TSelectionContext>>;
};

const noop = () => undefined;

function enabledAction<Args extends unknown[]>(enabled: boolean, action?: (...args: Args) => void) {
  return (...args: Args) => {
    if (enabled && action) action(...args);
  };
}
/**
 * Build a mode adapter from the current render's callbacks and capabilities.
 * Disabled actions intentionally become no-ops so menu/keyboard and panel
 * callers can share the same action surface without duplicating guards.
 */
export function createModeController<TSelection, TSelectionContext = undefined>(
  config: ModeControllerConfig<TSelection, TSelectionContext>,
): ModeController<TSelection, TSelectionContext> {
  const { capabilities } = config;
  const configured = config.actions;
  const selectAdjacent = (direction: ModeDirection) => {
    const enabled = direction < 0 ? capabilities.canSelectPreviousSegment : capabilities.canSelectNextSegment;
    if (enabled) configured.selectAdjacent?.(direction);
  };

  return {
    mode: config.mode,
    capabilities,
    actions: {
      select: enabledAction(capabilities.hasSegments, configured.select),
      add: enabledAction(capabilities.canAddSegment, configured.add ?? noop),
      remove: enabledAction(capabilities.canDeleteSelectedSegment, configured.remove ?? noop),
      selectAdjacent,
      jumpBoundary: enabledAction(capabilities.canJumpBoundary, configured.jumpBoundary ?? noop),
      playBoundary: enabledAction(capabilities.canPlayBoundary, configured.playBoundary ?? noop),
      nudge: enabledAction(capabilities.canNudgeBoundary, configured.nudge ?? noop),
    },
  };
}
