import { SegmentTimingDialog } from "@/components/SegmentTimingDialog";
import { formatTimeInput } from "@/lib/segmentTiming";
import type { Segment } from "@/types";

type Props = {
  segment: Segment | null;
  mediaDuration: number;
  onClose: () => void;
  onApply: (segmentId: string, patch: Partial<Segment>, seekTime: number) => void;
};

/** Cut-only adapter for the shared timing dialog. */
/** `CutSegmentTimingDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function CutSegmentTimingDialog(props: Props) {
  return (
    <SegmentTimingDialog
      open={Boolean(props.segment)}
      mode="cut"
      segment={props.segment}
      mediaDuration={props.mediaDuration}
      onClose={props.onClose}
      onApply={(start, end) => {
        if (!props.segment) return;
        props.onApply(
          props.segment.id,
          {
            start,
            end,
            duration: end - start,
            start_timecode: formatTimeInput(start),
            end_timecode: formatTimeInput(end),
            user_edited: true,
          },
          start,
        );
      }}
    />
  );
}
