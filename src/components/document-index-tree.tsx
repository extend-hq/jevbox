import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { IndexNode } from "@/lib/api";
import { FileText, ShapeTriangle } from "./icons";

export function DocumentIndexTree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: IndexNode[];
  selected: string;
  onSelect: (node: IndexNode) => void;
}) {
  const entries = useMemo(() => {
    const result = new Map<string, { node: IndexNode; parent?: string }>();
    const visit = (items: IndexNode[], parent?: string) => {
      for (const node of items) {
        result.set(node.id, { node, parent });
        visit(node.children, node.id);
      }
    };
    visit(nodes);
    return result;
  }, [nodes]);
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const [focused, setFocused] = useState(selected || nodes[0]?.id);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const search = useRef({ text: "", time: 0 });
  const selectedPath: string[] = [];
  let ancestor = entries.get(selected)?.parent;
  while (ancestor) {
    selectedPath.push(ancestor);
    ancestor = entries.get(ancestor)?.parent;
  }
  const pathKey = JSON.stringify(selectedPath);
  useEffect(() => {
    if (!selected) return;
    setCollapsed((current) => {
      const next = new Set(current);
      for (const id of JSON.parse(pathKey) as string[]) next.delete(id);
      return next;
    });
    setFocused(selected);
  }, [selected, pathKey]);
  const visible: IndexNode[] = [];
  const visitVisible = (items: IndexNode[]) => {
    for (const node of items) {
      visible.push(node);
      if (!collapsed.has(node.id)) visitVisible(node.children);
    }
  };
  visitVisible(nodes);
  let tabStop: string | undefined = focused;
  const visibleIds = new Set(visible.map((node) => node.id));
  while (tabStop && !visibleIds.has(tabStop))
    tabStop = entries.get(tabStop)?.parent;
  tabStop ??= visible[0]?.id;
  const focus = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    const element = refs.current.get(id);
    element?.focus({ preventScroll: true });
    element?.firstElementChild?.scrollIntoView?.({ block: "nearest" });
  };
  const expand = (id: string, open: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  const keyDown = (event: KeyboardEvent<HTMLDivElement>, node: IndexNode) => {
    if (
      event.target !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const index = visible.findIndex((item) => item.id === node.id);
    const parent = entries.get(node.id)?.parent;
    switch (event.key) {
      case "ArrowDown":
        focus(visible[Math.min(index + 1, visible.length - 1)]?.id);
        break;
      case "ArrowUp":
        focus(visible[Math.max(index - 1, 0)]?.id);
        break;
      case "Home":
        focus(visible[0]?.id);
        break;
      case "End":
        focus(visible.at(-1)?.id);
        break;
      case "ArrowRight":
        if (node.children.length) {
          if (collapsed.has(node.id)) expand(node.id, true);
          else focus(node.children[0]?.id);
        }
        break;
      case "ArrowLeft":
        if (node.children.length && !collapsed.has(node.id))
          expand(node.id, false);
        else focus(parent);
        break;
      case "Enter":
      case " ":
        onSelect(node);
        break;
      case "*":
        setCollapsed((current) => {
          const next = new Set(current);
          for (const [id, entry] of entries)
            if (entry.parent === parent) next.delete(id);
          return next;
        });
        break;
      default: {
        if (event.key.length !== 1) return;
        const now = Date.now();
        const text =
          (now - search.current.time < 700 ? search.current.text : "") +
          event.key.toLocaleLowerCase();
        search.current = { text, time: now };
        const prefix = [...text].every((letter) => letter === text[0])
          ? text[0]
          : text;
        const match = [
          ...visible.slice(index + 1),
          ...visible.slice(0, index + 1),
        ].find((item) => item.title.toLocaleLowerCase().startsWith(prefix));
        if (match) focus(match.id);
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const renderNodes = (items: IndexNode[], depth: number) =>
    items.map((node, index) => {
      const branch = node.children.length > 0;
      const open = !collapsed.has(node.id);
      return (
        <div
          key={node.id}
          role="treeitem"
          className="index-tree-item"
          aria-label={`${node.title}, page ${node.page}`}
          aria-level={depth + 1}
          aria-setsize={items.length}
          aria-posinset={index + 1}
          aria-selected={selected === node.id}
          aria-expanded={branch ? open : undefined}
          tabIndex={tabStop === node.id ? 0 : -1}
          ref={(element) => {
            if (element) refs.current.set(node.id, element);
            else refs.current.delete(node.id);
          }}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocused(node.id);
          }}
          onKeyDown={(event) => keyDown(event, node)}
        >
          <div
            className={`index-node ${selected === node.id ? "selected" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => {
              focus(node.id);
              onSelect(node);
            }}
          >
            <span
              className="node-glyph"
              aria-hidden="true"
              onClick={
                branch
                  ? (event) => {
                      event.stopPropagation();
                      focus(node.id);
                      expand(node.id, !open);
                    }
                  : undefined
              }
            >
              {branch ? (
                <ShapeTriangle
                  size={10}
                  className="disclosure-triangle"
                  data-open={open || undefined}
                />
              ) : (
                <FileText size={13} />
              )}
            </span>
            <span>{node.title}</span>
            <small aria-hidden="true">{node.page}</small>
          </div>
          {branch && open && (
            <div role="group">{renderNodes(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  return (
    <div role="tree" aria-label="Document index" className="index-tree">
      {renderNodes(nodes, 0)}
    </div>
  );
}
