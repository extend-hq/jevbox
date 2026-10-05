export const THEME_TRANSITION_DURATION = 250;
export const THEME_SKY_COLORS = {
  day: { haze: "#d7e0e7", top: "#b3c4d2", bottom: "#eef0f2" },
  dusk: { haze: "#bd9aa2", top: "#687da9", bottom: "#e5b593" },
  night: { haze: "#080d17", top: "#101b2d", bottom: "#04070d" },
};
export const THEME_SUN_COLORS = { day: "#fff0d4", dusk: "#ffb879" };

type SunPosition = { x: number; y: number };
type SunSource = (progress: number) => SunPosition | null;
const listeners = new Set<() => void>();
let sunSource: SunSource | null = null;
let lastSun = { x: 0.72, y: 0.2 };
let transition: { from: number; to: number; start: number } | null = null;
let cleanup: (() => void) | null = null;

export function themeSunDirection(progress: number): [number, number, number] {
  return [-0.8, 1.4 - 3.2 * progress, 0.7];
}

export function themeSunset(progress: number) {
  return Math.sin(Math.PI * progress) ** 2;
}

export function themeProgressAt(now = performance.now()) {
  if (!transition)
    return document.documentElement.classList.contains("dark") ? 1 : 0;
  const elapsed = Math.max(
    0,
    Math.min(1, (now - transition.start) / THEME_TRANSITION_DURATION),
  );
  const eased = elapsed * elapsed * (3 - 2 * elapsed);
  return transition.from + (transition.to - transition.from) * eased;
}

export function subscribeThemeTransition(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sunPosition(progress: number) {
  const projected = sunSource?.(progress);
  if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y))
    lastSun = {
      x: Math.max(0, Math.min(1, projected.x / window.innerWidth)),
      y: Math.max(0, Math.min(1, projected.y / window.innerHeight)),
    };
  return {
    x: lastSun.x * window.innerWidth,
    y: lastSun.y * window.innerHeight,
  };
}

export function registerThemeSun(source: SunSource) {
  sunSource = source;
  return () => {
    if (sunSource !== source) return;
    sunPosition(themeProgressAt());
    sunSource = null;
  };
}

const colorProperties = [
  "backgroundColor",
  "color",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "fill",
  "stroke",
  "boxShadow",
] as const;

function colors(style: CSSStyleDeclaration) {
  return Object.fromEntries(
    colorProperties.map((property) => [property, style[property]]),
  );
}

export function finishThemeTransition() {
  cleanup?.();
  cleanup = null;
  transition = null;
  listeners.forEach((listener) => listener());
}

export function transitionTheme(dark: boolean, applyTheme: () => void) {
  const root = document.documentElement;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches || document.hidden) {
    finishThemeTransition();
    applyTheme();
    listeners.forEach((listener) => listener());
    return;
  }

  const from = themeProgressAt(
    (document.timeline.currentTime as number | null) ?? performance.now(),
  );
  const before = new Map<Element, ReturnType<typeof colors>>();
  for (const element of [
    root,
    document.body,
    ...document.body.querySelectorAll("*"),
  ]) {
    if (!element.getClientRects().length) continue;
    before.set(element, colors(getComputedStyle(element)));
  }
  cleanup?.();
  cleanup = null;
  root.setAttribute("data-theme-sampling", "");
  applyTheme();

  const animations: Animation[] = [];
  const surfaces: Element[] = [];
  const changes: { element: Element; keyframes: Keyframe[] }[] = [];
  for (const [element, previous] of before) {
    if (!element.isConnected) continue;
    const style = getComputedStyle(element);
    const next = colors(style);
    const properties = colorProperties.filter(
      (property) => previous[property] !== next[property],
    );
    if (properties.length) {
      changes.push({
        element,
        keyframes: [
          Object.fromEntries(properties.map((key) => [key, previous[key]])),
          Object.fromEntries(properties.map((key) => [key, next[key]])),
        ],
      });
    }
    if (
      style.backgroundImage === "none" &&
      [previous.backgroundColor, next.backgroundColor].some(
        (color) => color !== "rgba(0, 0, 0, 0)" && color !== "transparent",
      ) &&
      element instanceof HTMLElement &&
      !["CANVAS", "IMG", "VIDEO"].includes(element.tagName)
    ) {
      surfaces.push(element);
    }
  }

  const start = performance.now();
  transition = { from, to: dark ? 1 : 0, start };
  for (const { element, keyframes } of changes) {
    const animation = element.animate(keyframes, {
      duration: THEME_TRANSITION_DURATION,
      easing: "cubic-bezier(0.333333, 0, 0.666667, 1)",
      fill: "both",
    });
    animation.startTime = start;
    animations.push(animation);
  }
  root.removeAttribute("data-theme-sampling");

  const lightProperties = [
    "--theme-sun-x",
    "--theme-sun-y",
    "--theme-sunset-color",
    "--theme-glow-near",
    "--theme-glow-middle",
    "--theme-glow-far",
  ];
  let frame = 0;
  const onMotionChange = () => {
    if (motion.matches) finishThemeTransition();
  };
  cleanup = () => {
    cancelAnimationFrame(frame);
    animations.forEach((animation) => animation.cancel());
    surfaces.forEach((element) => element.removeAttribute("data-theme-lit"));
    root.removeAttribute("data-theme-transition");
    lightProperties.forEach((property) => root.style.removeProperty(property));
    motion.removeEventListener("change", onMotionChange);
  };
  motion.addEventListener("change", onMotionChange);
  surfaces.forEach((element) => element.setAttribute("data-theme-lit", ""));
  root.setAttribute("data-theme-transition", "");

  function paint(now: number) {
    if (!transition) return;
    const progress = themeProgressAt(now);
    const sunset = themeSunset(progress);
    const sun = sunPosition(progress);
    const dusk = Math.min(1, progress * 2);
    const twilight = Math.max(0, progress * 2 - 1);
    const warmth = `color-mix(in srgb-linear, ${THEME_SUN_COLORS.dusk}, ${THEME_SKY_COLORS.dusk.haze} ${dusk * 100}%)`;
    root.style.setProperty("--theme-sun-x", `${sun.x}px`);
    root.style.setProperty("--theme-sun-y", `${sun.y}px`);
    root.style.setProperty(
      "--theme-sunset-color",
      `color-mix(in srgb-linear, ${warmth}, ${THEME_SKY_COLORS.dusk.top} ${twilight * 100}%)`,
    );
    root.style.setProperty("--theme-glow-near", `${sunset * 58}%`);
    root.style.setProperty("--theme-glow-middle", `${sunset * 32}%`);
    root.style.setProperty("--theme-glow-far", `${sunset * 14}%`);
    if (now - transition.start >= THEME_TRANSITION_DURATION)
      finishThemeTransition();
    else frame = requestAnimationFrame(paint);
  }
  paint(transition.start);
  listeners.forEach((listener) => listener());
}
