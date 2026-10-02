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
    () => [{ ref: modelRef, strength: 1.1 }],
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
      ...PRESETS.chromatic.modes[dark ? "dark" : "light"],
      colorTint: dark ? "#78b3ff80" : "#4a8ce580",
      speed: 1,
      shiftRed: 0.75,
      shiftBlue: 0.8,
    });
    return () => setSharedPresetMode(null);
  }, [dark]);
  if (typeof WebGL2RenderingContext === "undefined") return children;
  return (
    <MetalFx
      className="composer-send-metal"
      variant="circle"
      preset="chromatic"
      theme={dark ? "dark" : "light"}
      strength={disabled ? 0.78 : 1}
      glowGain={1}
      ringCssPx={1}
      scale={0.8}
      paused={reducedMotion}
      reflectionTargets={reflections}
    >
      {children}
    </MetalFx>
  );
}
