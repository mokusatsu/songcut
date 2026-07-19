import type { Segment } from "@/types";

export type BoundaryEdge = "start" | "end";

export type BoundaryTarget = {
  segmentId: string;
  edge: BoundaryEdge;
};

export function nearestBoundaryTarget(
  segments: readonly Segment[],
  time: number,
  preferredSegmentId?: string | null,
): BoundaryTarget | null {
  const preferred = preferredSegmentId
    ? segments.find((segment) => segment.id === preferredSegmentId)
    : undefined;
  const candidates = preferred ? [preferred] : segments;
  let nearest: (BoundaryTarget & { distance: number }) | null = null;

  for (const segment of candidates) {
    for (const edge of ["start", "end"] as const) {
      const distance = Math.abs(segment[edge] - time);
      if (!nearest || distance < nearest.distance) {
        nearest = { segmentId: segment.id, edge, distance };
      }
    }
  }

  return nearest ? { segmentId: nearest.segmentId, edge: nearest.edge } : null;
}
