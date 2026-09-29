const OUTLINE =
  "M21.4472 5.72361L12.6708 1.33541C12.2485 1.12426 11.7515 1.12426 11.3292 1.33541L2.55279 5.72361C2.214 5.893 2 6.23926 2 6.61803V17.382C2 17.7607 2.214 18.107 2.55279 18.2764L11.3292 22.6646C11.7515 22.8757 12.2485 22.8757 12.6708 22.6646L21.4472 18.2764C21.786 18.107 22 17.7607 22 17.382V6.61803C22 6.23926 21.786 5.893 21.4472 5.72361Z";

// Same geometry and strokes as JevboxIcon so the resting frame is the logo;
// the lid seam is split in two so both halves draw outward from the center vertex.
export function BoxLoader({
  label = "Loading",
  size = 40,
}: {
  label?: string;
  size?: number;
}) {
  return (
    <span className="box-loader" role="status" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <g fill="none" stroke="currentColor">
          <path
            className="box-loader-face"
            d="M12 11L22 6V18L12 23V11Z"
            fill="currentColor"
            fillOpacity=".3"
            stroke="none"
          />
          <path className="box-loader-track" d={OUTLINE} />
          <path
            className="box-loader-line box-loader-seam"
            d="M12 10.8229C12.2298 10.8229 12.4597 10.7702 12.6708 10.6646L22 6"
            pathLength={1}
          />
          <path
            className="box-loader-line box-loader-seam"
            d="M12 10.8229C11.7702 10.8229 11.5403 10.7702 11.3292 10.6646L2 6"
            pathLength={1}
          />
          <path className="box-loader-line box-loader-seam" d="M12 11V23" pathLength={1} />
          <path
            className="box-loader-line box-loader-flap"
            d="M7.29834 3.32349L17.2983 8.32349"
            pathLength={1}
          />
          <path
            className="box-loader-line box-loader-tick"
            d="M5.75 11.875L7 12.5L8.25 13.125"
            strokeLinecap="round"
            pathLength={1}
          />
          <path className="box-loader-outline" d={OUTLINE} pathLength={1} />
        </g>
      </svg>
    </span>
  );
}
