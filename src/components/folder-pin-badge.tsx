import { PinTackFilled } from "./icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { cn } from "@/lib/utils";

export const FOLDER_PIN_TOOLTIP =
  "Pinned folders are locked and new documents will not be filed into them";

export function FolderPinBadge({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        tabIndex={0}
        aria-label="Pinned folder"
        className={cn(
          "inline-flex shrink-0 items-center justify-center",
          className,
        )}
        style={{ display: "inline-flex", width: size, height: size }}
      >
        <PinTackFilled size={size} />
      </TooltipTrigger>
      <TooltipPopup className="w-72 max-w-[calc(100vw-2rem)] text-left text-wrap">
        <span className="block whitespace-normal">{FOLDER_PIN_TOOLTIP}</span>
      </TooltipPopup>
    </Tooltip>
  );
}
