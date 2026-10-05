import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { transitionTheme } from "@/lib/theme-transition";
const ThemeContext = createContext({ dark: false, toggle: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    const preference = localStorage.getItem("jevbox-theme");
    return preference
      ? preference === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <ThemeContext.Provider
      value={{
        dark,
        toggle: () => {
          const next = !dark;
          localStorage.setItem("jevbox-theme", next ? "dark" : "light");
          transitionTheme(next, () => flushSync(() => setDark(next)));
        },
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
