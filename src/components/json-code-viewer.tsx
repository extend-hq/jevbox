import { useCallback, useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { File, Virtualizer } from "@pierre/diffs/react";
import { preloadHighlighter, type FileOptions } from "@pierre/diffs";
import { useTheme } from "./theme";
import { Loading } from "./common";
import { ShapeTriangle } from "./icons";
import { JSON_LANGUAGE, JSON_THEMES } from "@/lib/json-highlighting";
import {
  createJsonFoldingModel,
  createVisibleJsonDocument,
  findJsonFoldRangeStartingOnLine,
  mapVisibleJsonLineToOriginal,
} from "@/lib/json-folding";

const FOLD_DISCLOSURE_ICON = renderToStaticMarkup(<ShapeTriangle size={10} />);

export function JsonCodeViewer({ value }: { value: unknown }) {
  const { dark } = useTheme();
  const source = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const model = useMemo(() => createJsonFoldingModel(source), [source]);
  const defaults = useMemo(() => new Set<number>(), [source]);
  const [state, setState] = useState({ source, collapsed: defaults });
  const collapsed = state.source === source ? state.collapsed : defaults;
  const visible = useMemo(
    () => createVisibleJsonDocument(source, model, collapsed),
    [source, model, collapsed],
  );
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void preloadHighlighter({
      themes: Object.values(JSON_THEMES),
      langs: [JSON_LANGUAGE],
    })
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const toggle = useCallback(
    (key: number) => {
      setState((current) => {
        const next = new Set(
          current.source === source ? current.collapsed : defaults,
        );
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { source, collapsed: next };
      });
    },
    [source, defaults],
  );
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      theme: JSON_THEMES,
      themeType: dark ? "dark" : "light",
      disableFileHeader: true,
      overflow: "wrap",
      unsafeCSS: `[data-column-number] { position: relative; padding-left: 22px; }
      [data-json-fold] { position: absolute; left: 2px; top: calc((var(--diffs-line-height, 20px) - 18px) / 2); display: grid; place-items: center; box-sizing: border-box; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
      [data-json-fold] svg { display: block; width: 10px; height: 10px; transform: rotate(90deg); pointer-events: none; }
      [data-json-fold][aria-expanded="true"] svg { transform: rotate(180deg); }
      [data-json-fold]:hover, [data-json-fold]:focus-visible { background: color-mix(in srgb, currentColor 12%, transparent); }
      [data-json-fold-summary] { opacity: .65; }`,
      onPostRender(host, _instance, phase) {
        if (phase === "unmount" || !host.shadowRoot) return;
        const root = host.shadowRoot;
        root
          .querySelectorAll("[data-json-fold], [data-json-fold-summary]")
          .forEach((element) => element.remove());
        root
          .querySelectorAll<HTMLElement>(
            "[data-column-number][data-line-index]",
          )
          .forEach((gutter) => {
            const line = Number(gutter.dataset.lineIndex);
            const original = mapVisibleJsonLineToOriginal(visible, line);
            const label = gutter.querySelector("[data-line-number-content]");
            if (label) label.textContent = String(original + 1);
            const range = findJsonFoldRangeStartingOnLine(model, original);
            if (!range) return;
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.jsonFold = String(range.key);
            const expanded = !collapsed.has(range.key);
            button.innerHTML = FOLD_DISCLOSURE_ICON;
            button.setAttribute("aria-expanded", String(expanded));
            button.setAttribute(
              "aria-label",
              `${expanded ? "Collapse" : "Expand"} ${range.kind} at line ${original + 1}`,
            );
            button.onclick = (event) => {
              event.stopPropagation();
              toggle(range.key);
            };
            gutter.append(button);
            if (!expanded) {
              const row = root.querySelector<HTMLElement>(
                `[data-line][data-line-index="${line}"]`,
              );
              if (row) {
                const marker = document.createElement("span");
                marker.dataset.jsonFoldSummary = "";
                marker.textContent = " …";
                row.append(marker);
              }
            }
          });
      },
    }),
    [dark, visible, model, collapsed, toggle],
  );
  const file = useMemo(
    () => ({
      name: "parsed.json",
      lang: JSON_LANGUAGE,
      contents: visible.contents,
    }),
    [visible.contents],
  );
  return (
    <Virtualizer className="json-code-viewer" config={{ overscrollSize: 500 }}>
      {ready ? (
        <File file={file} options={options} />
      ) : failed ? (
        <pre>{source}</pre>
      ) : (
        <Loading label="Loading JSON" />
      )}
    </Virtualizer>
  );
}
