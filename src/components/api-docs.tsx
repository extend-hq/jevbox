import { Button } from "./coss/button";
import { Copy } from "./icons";

export function DocumentationCode({
  label,
  text,
  onCopy,
}: {
  label: string;
  text: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="api-docs-code">
      <div className="api-docs-code-heading">
        <span>{label}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Copy ${label}`}
          onClick={() => onCopy(text)}
        >
          <Copy size={13} />
          Copy
        </Button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function DocumentationTable({
  rows,
  nameLabel = "Parameter",
  detailLabel = "Details",
  codeNames = true,
}: {
  rows: { name: string; detail: string }[];
  nameLabel?: string;
  detailLabel?: string;
  codeNames?: boolean;
}) {
  return (
    <div className="api-docs-table-scroll">
      <table className="api-docs-table">
        <thead>
          <tr>
            <th scope="col">{nameLabel}</th>
            <th scope="col">{detailLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                {codeNames ? <code>{row.name}</code> : row.name}
              </th>
              <td>{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
