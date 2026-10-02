import type { IndexNode } from "@/lib/api";
import { blockStyle } from "./block-type-badge";
import { sectionBlockType } from "../../shared/section-block-type";
import { OutlineTree } from "./outline-tree";

export function DocumentIndexTree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: IndexNode[];
  selected: string;
  onSelect: (node: IndexNode) => void;
}) {
  return (
    <OutlineTree
      nodes={nodes}
      selected={selected}
      label="Document index"
      className="index-tree"
      rowClassName={(node) =>
        `index-node ${selected === node.id ? "selected" : ""}`
      }
      rowStyle={(depth) => ({ paddingLeft: 10 + depth * 14 })}
      accessibleLabel={(node) => `${node.title}, page ${node.page}`}
      onSelect={onSelect}
      renderIcon={(node) => {
        const { icon: Icon, tone } = blockStyle(sectionBlockType(node));
        return <Icon size={13} className="index-node-icon" data-tone={tone} />;
      }}
      renderMeta={(node) => <small aria-hidden="true">{node.page}</small>}
    />
  );
}
