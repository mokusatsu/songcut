const ALIGNMENTS = [7, 8, 9, 4, 5, 6, 1, 2, 3] as const;

/** ASSの1〜9配置を、選択セルだけ塗りつぶした単色3×3 SVGで表す。 */
export function SubtitleAlignmentIcon(props: { alignment: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 20 20"
    >
      {ALIGNMENTS.map((alignment, index) => (
        <rect
          key={alignment}
          data-alignment={alignment}
          x={1 + (index % 3) * 6}
          y={1 + Math.floor(index / 3) * 6}
          width="5"
          height="5"
          rx="0.75"
          fill={props.alignment === alignment ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
