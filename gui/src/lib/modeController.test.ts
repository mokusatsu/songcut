import { describe, expect, it, vi } from "vitest";
import { createModeController, type ModeControllerCapabilities } from "./modeController";

function capabilities(overrides: Partial<ModeControllerCapabilities> = {}): ModeControllerCapabilities {
  return {
    hasSegments: true,
    hasSelectedSegment: true,
    hasMultipleSegments: true,
    canAddSegment: true,
    canDeleteSelectedSegment: true,
    canSelectPreviousSegment: true,
    canSelectNextSegment: true,
    canJumpBoundary: true,
    canPlayBoundary: true,
    canNudgeBoundary: true,
    ...overrides,
  };
}

describe("mode controller", () => {
  it("maps Cut callbacks without changing the domain selection type", () => {
    const calls = {
      select: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      adjacent: vi.fn(),
      jump: vi.fn(),
      play: vi.fn(),
      nudge: vi.fn(),
    };
    const controller = createModeController<{ id: string }>({
      mode: "cut",
      capabilities: capabilities(),
      actions: {
        select: calls.select,
        add: calls.add,
        remove: calls.remove,
        selectAdjacent: calls.adjacent,
        jumpBoundary: calls.jump,
        playBoundary: calls.play,
        nudge: calls.nudge,
      },
    });

    controller.actions.select({ id: "cut-1" });
    controller.actions.add();
    controller.actions.remove();
    controller.actions.selectAdjacent(-1);
    controller.actions.jumpBoundary(1);
    controller.actions.playBoundary("start");
    controller.actions.nudge(1);

    expect(calls.select).toHaveBeenCalledWith({ id: "cut-1" });
    expect(calls.add).toHaveBeenCalledOnce();
    expect(calls.remove).toHaveBeenCalledOnce();
    expect(calls.adjacent).toHaveBeenCalledWith(-1);
    expect(calls.jump).toHaveBeenCalledWith(1);
    expect(calls.play).toHaveBeenCalledWith("start");
    expect(calls.nudge).toHaveBeenCalledWith(1);
  });

  it("maps Sub selection context while keeping rhythm nudge as an adapter action", () => {
    const select = vi.fn();
    const nudge = vi.fn();
    const controller = createModeController<{ id: string }, string>({
      mode: "sub",
      capabilities: capabilities({ canNudgeBoundary: true }),
      actions: { select, nudge },
    });

    controller.actions.select({ id: "lyrics-1" }, "lyrics-lane");
    controller.actions.nudge(-1);

    expect(select).toHaveBeenCalledWith({ id: "lyrics-1" }, "lyrics-lane");
    expect(nudge).toHaveBeenCalledWith(-1);
  });

  it("turns disabled actions into no-ops and respects direction-specific navigation", () => {
    const calls = {
      select: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      adjacent: vi.fn(),
      jump: vi.fn(),
      play: vi.fn(),
      nudge: vi.fn(),
    };
    const controller = createModeController<string>({
      mode: "sub",
      capabilities: capabilities({
        hasSegments: false,
        hasSelectedSegment: false,
        canAddSegment: false,
        canDeleteSelectedSegment: false,
        canSelectPreviousSegment: false,
        canSelectNextSegment: true,
        canJumpBoundary: false,
        canPlayBoundary: false,
        canNudgeBoundary: false,
      }),
      actions: {
        select: calls.select,
        add: calls.add,
        remove: calls.remove,
        selectAdjacent: calls.adjacent,
        jumpBoundary: calls.jump,
        playBoundary: calls.play,
        nudge: calls.nudge,
      },
    });

    controller.actions.select("missing");
    controller.actions.add();
    controller.actions.remove();
    controller.actions.selectAdjacent(-1);
    controller.actions.selectAdjacent(1);
    controller.actions.jumpBoundary(-1);
    controller.actions.playBoundary("end");
    controller.actions.nudge(1);

    expect(calls.select).not.toHaveBeenCalled();
    expect(calls.add).not.toHaveBeenCalled();
    expect(calls.remove).not.toHaveBeenCalled();
    expect(calls.adjacent).toHaveBeenCalledTimes(1);
    expect(calls.adjacent).toHaveBeenCalledWith(1);
    expect(calls.jump).not.toHaveBeenCalled();
    expect(calls.play).not.toHaveBeenCalled();
    expect(calls.nudge).not.toHaveBeenCalled();
  });
});
