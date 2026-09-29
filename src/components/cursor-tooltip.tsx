import { useMemo, useState, type ReactElement } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

export function CursorTooltip({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const anchor = useMemo(
    () =>
      point
        ? { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) }
        : undefined,
    [point],
  );
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        delay={450}
        onPointerMove={(event) =>
          setPoint({ x: event.clientX, y: event.clientY })
        }
        onFocus={() => setPoint(null)}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={12}
        className="pointer-events-none max-w-72"
      >
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}
