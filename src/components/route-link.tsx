import type { AnchorHTMLAttributes } from "react";
import { navigateTo } from "@/lib/navigation";

export function RouteLink({
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.download ||
          (props.target && props.target !== "_self")
        )
          return;
        const url = new URL(event.currentTarget.href);
        if (url.origin !== window.location.origin) return;
        event.preventDefault();
        navigateTo(url.href);
      }}
    />
  );
}
