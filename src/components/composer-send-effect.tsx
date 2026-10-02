import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { MetalFx, PRESETS, setSharedPresetMode } from "metal-fx";
import { useTheme } from "./theme";

export function ComposerSendEffect({
  children,
  modelRef,
  disabled,
}: {
  children: ReactNode;
  modelRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  const { dark } = useTheme();
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reflections = useMemo(
    () => [{ ref: modelRef, strength: 0.55 }],
    [modelRef],
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (typeof WebGL2RenderingContext === "undefined") return;
    setSharedPresetMode({
      ...PRESETS.silver.modes[dark ? "dark" : "light"],
      colorTint: dark ? "#559effa8" : "#386fdc80",
      speed: 0.16,
      shiftBlue: 0.18,
      distortion: 0.28,
    });
    return () => setSharedPresetMode(null);
  }, [dark]);
  if (typeof WebGL2RenderingContext === "undefined") return children;
  return (
    <MetalFx
      className="composer-send-metal"
      variant="circle"
      preset="silver"
      theme={dark ? "dark" : "light"}
      strength={disabled ? 0.35 : 0.95}
      glowGain={0.65}
      ringCssPx={1.6}
      innerShadow
      paused={reducedMotion || disabled}
      normalizeHostStyles={false}
      reflectionTargets={reflections}
    >
      {children}
    </MetalFx>
  );
}
