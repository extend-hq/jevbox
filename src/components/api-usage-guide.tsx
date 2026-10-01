import { Button } from "./coss/button";
import { Badge } from "./coss/badge";
import { Code, Copy } from "./icons";

function RequestCode({
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

function Parameters({ rows }: { rows: { name: string; detail: string }[] }) {
  return (
    <div className="api-docs-table-scroll">
      <table className="api-docs-table">
        <thead>
          <tr>
            <th scope="col">Parameter</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                <code>{row.name}</code>
              </th>
              <td>{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApiUsageGuide({
  origin,
  onCopy,
}: {
  origin: string;
  onCopy: (value: string) => void;
}) {
  const url = `${origin}/api/v1`;
  const authorization = '-H "Authorization: Bearer $JEVBOX_API_KEY"';
  const searchBody = JSON.stringify(
    { organizationId: "<ORGANIZATION_ID>", query: "<YOUR_QUESTION>", limit: 5 },
    null,
    2,
  );
  return (
    <section
      className="settings-section api-docs"
      aria-label="API documentation"
    >
      <h2>API documentation</h2>
      <p className="muted">
        Read your organizations, search documents, and fetch source text with
        your current permissions.
      </p>
      <div className="api-endpoint">
        <span>
          <Code size={18} />
          API
        </span>
        <code>{url}</code>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Copy API URL"
          onClick={() => onCopy(url)}
        >
          <Copy size={14} />
        </Button>
      </div>
      <article className="api-docs-section">
        <h3>Authenticate</h3>
        <p>
          Create a key above and send it in the{" "}
          <code>Authorization: Bearer</code> header on every request. Set it as
          an environment variable for the commands below.
        </p>
        <RequestCode
          label="Set your API key"
          text="export JEVBOX_API_KEY='<YOUR_API_KEY>'"
          onCopy={onCopy}
        />
      </article>
      <article className="api-docs-section">
        <h3>1. Find your organization</h3>
        <div className="api-docs-route">
          <Badge variant="success">GET</Badge>
          <code>/organizations</code>
        </div>
        <p>
          Returns an <code>organizations</code> array with each accessible
          organization’s <code>id</code> and <code>name</code>. Use its ID in
          search and document requests.
        </p>
        <RequestCode
          label="List organizations · cURL"
          text={`curl --fail-with-body "${url}/organizations" \\\n  ${authorization}`}
          onCopy={onCopy}
        />
      </article>
      <article className="api-docs-section">
        <h3>2. Search documents</h3>
        <div className="api-docs-route">
          <Badge variant="warning">POST</Badge>
          <code>/search</code>
        </div>
        <p>
          Send a JSON body with your organization ID and question. Replace the
          placeholders with your own values.
        </p>
        <RequestCode
          label="Search documents · cURL"
          text={`curl --fail-with-body "${url}/search" \\\n  ${authorization} \\\n  -H "Content-Type: application/json" \\\n  --data '${searchBody}'`}
          onCopy={onCopy}
        />
        <Parameters
          rows={[
            {
              name: "organizationId",
              detail: "Required. Organization UUID returned by /organizations.",
            },
            {
              name: "query",
              detail:
                "Required. A question or search query, up to 2,000 characters.",
            },
            {
              name: "limit",
              detail: "Optional. Between 1 and 12 results; defaults to 12.",
            },
            {
              name: "documentIds",
              detail:
                "Optional. An array of up to 50 document UUIDs to narrow the search.",
            },
            {
              name: "folderId",
              detail:
                "Optional. A folder UUID to search its descendants. Combined with documentIds, searches their intersection.",
            },
          ]}
        />
        <p>
          Returns a <code>results</code> array. Each match includes an{" "}
          <code>id</code>, <code>documentId</code>, <code>nodeId</code>, source{" "}
          <code>content</code>, <code>title</code>, <code>page</code>,{" "}
          <code>endPage</code>, <code>blockIds</code>, and a document{" "}
          <code>url</code>. Use the result ID to fetch that passage. Results can
          be empty.
        </p>
      </article>
      <article className="api-docs-section">
        <h3>3. Fetch a document or passage</h3>
        <div className="api-docs-route">
          <Badge variant="success">GET</Badge>
          <code>/documents/:id</code>
        </div>
        <p>
          Use a document UUID for the full document or a search result ID for
          its source passage.
        </p>
        <RequestCode
          label="Fetch source text · cURL"
          text={`curl --fail-with-body --get "${url}/documents/<DOCUMENT_OR_RESULT_ID>" \\\n  ${authorization} \\\n  --data-urlencode "organizationId=<ORGANIZATION_ID>" \\\n  --data-urlencode "offset=0" \\\n  --data-urlencode "limit=12000"`}
          onCopy={onCopy}
        />
        <Parameters
          rows={[
            {
              name: "organizationId",
              detail: "Required. The document’s organization UUID.",
            },
            {
              name: "nodeId",
              detail: "Optional. Selects a section by its ID.",
            },
            {
              name: "offset",
              detail: "Optional. Starting character offset; defaults to 0.",
            },
            {
              name: "limit",
              detail:
                "Optional. Between 1 and 24,000 characters; defaults to 12,000.",
            },
          ]}
        />
        <p>
          Returns <code>text</code>, a section <code>tree</code>, page and block
          references, and a <code>url</code>. For more text, request the
          returned <code>nextOffset</code> as your next <code>offset</code>. A{" "}
          <code>null</code> nextOffset means you’ve reached the end.
        </p>
      </article>
      <article className="api-docs-section">
        <h3>Limits and errors</h3>
        <p>
          Search allows 20 requests per minute per key and 100 per organization.
          Search uses the organization’s configured TypeSafe connection and
          indexed documents.
        </p>
        <div className="api-docs-table-scroll">
          <table className="api-docs-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["400", "Invalid request parameters."],
                ["401", "The API key is missing, expired, or revoked."],
                ["403", "An OAuth token lacks the required scope."],
                [
                  "404",
                  "The organization, document, folder, or section is unavailable to you.",
                ],
                ["409", "The document has not been indexed yet."],
                ["429", "The request limit has been reached. Retry later."],
                ["503", "The authorization service is unavailable."],
              ].map(([status, meaning]) => (
                <tr key={status}>
                  <th scope="row">
                    <code>{status}</code>
                  </th>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
