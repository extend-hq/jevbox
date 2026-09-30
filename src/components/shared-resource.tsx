import { useEffect, useState } from "react";
import { api, type Resource } from "@/lib/api";
import { navigateTo, paths, type AppRoute } from "@/lib/navigation";
import { DocumentView } from "./document";
import { RouteLink } from "./route-link";
import { Folder, ChevronRight } from "./icons";
import { Loading } from "./common";
import { ResourceThumbnail } from "./resource-thumbnail";

type SharedResource = Resource & { rootId: string; children: Resource[] };

export function SharedResourceView({ route }: { route: AppRoute }) {
  const token = route.shareToken!;
  const [resource, setResource] = useState<SharedResource | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setResource(null);
    setError("");
    const load = async () => {
      try {
        const value = await api<SharedResource>(
          `/shared/${token}${route.sharedResourceId ? `/resources/${route.sharedResourceId}` : ""}`,
        );
        if (active) {
          setResource(value);
          setError("");
        }
      } catch (error) {
        if (active) {
          setResource(null);
          setError((error as Error).message);
        }
      }
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, route.sharedResourceId]);
  return (
    <div className="shared-resource-page">
      <header className="topbar">
        <nav className="app-breadcrumbs" aria-label="Breadcrumb">
          <RouteLink href={paths.shared(token)}>Shared</RouteLink>
          {resource && (
            <>
              <ChevronRight size={12} />
              <span aria-current="page">{resource.name}</span>
            </>
          )}
        </nav>
        <span className="muted">View only</span>
      </header>
      {error ? (
        <div className="empty-inline" role="alert">
          <h1>Link unavailable</h1>
          <p>{error}</p>
        </div>
      ) : !resource ? (
        <Loading />
      ) : resource.kind === "document" ? (
        <DocumentView
          key={resource.id}
          documentId={resource.id}
          initialResource={resource}
          sharedToken={token}
          initialNode={route.node}
          initialTab={route.tab}
          onNavigate={(node, tab) =>
            navigateTo(paths.shared(token, resource.id, node, tab))
          }
          onBack={() =>
            navigateTo(
              resource.parent_id
                ? paths.shared(token, resource.parent_id)
                : "/library",
            )
          }
          onShare={() => {}}
          onChange={() => {}}
        />
      ) : (
        <section className="shared-folder">
          <h1>{resource.name}</h1>
          {resource.description && (
            <p className="muted">{resource.description}</p>
          )}
          {resource.parent_id && (
            <RouteLink href={paths.shared(token, resource.parent_id)}>
              Back to parent folder
            </RouteLink>
          )}
          <div className="shared-folder-items">
            {resource.children.map((child) => (
              <RouteLink key={child.id} href={paths.shared(token, child.id)}>
                {child.kind === "folder" ? (
                  <Folder size={22} />
                ) : (
                  <ResourceThumbnail
                    name={child.name}
                    mime={child.mime}
                    src={`/api/shared/${token}/resources/${child.id}/content`}
                    className="size-6 shrink-0"
                    square
                    inline
                  />
                )}
                <span>{child.name}</span>
                <ChevronRight size={14} />
              </RouteLink>
            ))}
          </div>
          {!resource.children.length && (
            <p className="muted">No shared contents in this folder.</p>
          )}
        </section>
      )}
    </div>
  );
}
