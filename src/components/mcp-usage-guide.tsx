import { DocumentationCode, DocumentationTable } from "./api-docs";
import { RouteLink } from "./route-link";
import { paths } from "../lib/navigation";

export function McpUsageGuide({ onCopy }: { onCopy: (value: string) => void }) {
  return (
    <section className="settings-section api-docs" aria-label="MCP tools">
      <h2>Tools and uploads</h2>
      <p className="muted">
        Search your library, read source passages, and upload Private documents
        with your current permissions.
      </p>
      <article className="api-docs-section">
        <h3>Available tools</h3>
        <DocumentationTable
          nameLabel="Tool"
          detailLabel="What it does"
          rows={[
            { name: "list_organizations", detail: "List your workspaces." },
            { name: "search", detail: "Find accessible source passages." },
            { name: "fetch", detail: "Read documents and sections." },
            {
              name: "answer",
              detail: "Start a cited answer and save a private chat.",
            },
            { name: "get_run", detail: "Read saved progress and results." },
            { name: "list_runs", detail: "Recover recent requests." },
            { name: "cancel_run", detail: "Stop a running request." },
            {
              name: "upload_document",
              detail: "Add a new Private document with documents:write access.",
            },
          ]}
        />
      </article>
      <article className="api-docs-section">
        <h3>Saved searches and answers</h3>
        <p>
          Accepted searches and answers keep running when you disconnect or
          close your client. Use <code>get_run</code> to check progress and
          results, <code>list_runs</code> to recover recent requests, and{" "}
          <code>cancel_run</code> to stop work.
        </p>
        <p>
          Answers also appear in Chats. Run handles are available for 24 hours;
          saved chats remain available.
        </p>
      </article>
      <article className="api-docs-section">
        <h3>Upload a document</h3>
        <p>
          Call <code>upload_document</code> with the file bytes encoded as
          standard padded Base64. Local paths and URLs are not accepted as file
          content. Ask your client to upload only files you authorize it to
          send.
        </p>
        <DocumentationCode
          label="upload_document arguments"
          text={JSON.stringify(
            {
              organizationId: "<ORGANIZATION_ID>",
              filename: "note.txt",
              contentBase64: "SGVsbG8K",
            },
            null,
            2,
          )}
          onCopy={onCopy}
        />
        <DocumentationTable
          rows={[
            {
              name: "organizationId",
              detail: "Required. Workspace ID returned by list_organizations.",
            },
            {
              name: "filename",
              detail: "Required. Original filename, including its extension.",
            },
            {
              name: "contentBase64",
              detail:
                "Required. Standard padded Base64 containing the file bytes.",
            },
            { name: "parentId", detail: "Optional. ID of a writable folder." },
          ]}
        />
        <p>
          The result includes the document ID, URL, and processing status.
          Indexing runs in the background. Uploads start Private and cannot
          change sharing or edit existing documents. Repeated uploads create
          separate documents.
        </p>
      </article>
      <article className="api-docs-section">
        <h3>Upload access</h3>
        <p>
          Your key or OAuth grant needs <code>documents:write</code> access.
          Read-only grants do not expose <code>upload_document</code>. Reconnect
          and consent to upload access, or create a new API key. Existing grants
          and older keys keep their current permissions.
        </p>
      </article>
      <article className="api-docs-section">
        <h3>Upload limits</h3>
        <p>
          API, MCP, and browser uploads share a generous per-user attempt
          safeguard across keys. There are no organization or deployment quotas.
        </p>
        <DocumentationTable
          nameLabel="Limit"
          detailLabel="Allowance"
          codeNames={false}
          rows={[
            { name: "Inline MCP file size", detail: "250 MB decoded" },
            { name: "Multipart API file size", detail: "250 MB" },
            {
              name: "Upload attempts",
              detail: "10,000 per minute · 100,000 per hour",
            },
            { name: "Uploaded bytes", detail: "Unlimited" },
            { name: "Stored bytes", detail: "Unlimited" },
            {
              name: "Processing queue",
              detail: "Unlimited",
            },
            { name: "Document count", detail: "Unlimited" },
          ]}
        />
        <p>
          To upload file bytes directly, use the multipart endpoint documented
          under{" "}
          <RouteLink
            href={paths.settings("api-keys")}
            className="underline underline-offset-2"
          >
            API keys
          </RouteLink>
          .
        </p>
      </article>
      <article className="api-docs-section">
        <h3>Errors and retries</h3>
        <p>
          Files larger than 250 MB are rejected. Parsing failures appear in the
          document’s processing status. MCP reports tool failures with{" "}
          <code>isError</code>. Wait before retrying a quota error.
        </p>
      </article>
    </section>
  );
}
