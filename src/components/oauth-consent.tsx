import { authClient, authData } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { type Me } from "@/lib/api";
import { scopeLabels, type ApiScope } from "../../shared/api-access";
import { Button } from "./coss/button";
import { Brand, Loading, useAction } from "./common";

export function OAuthResume() {
  useEffect(() => {
    location.replace(`/api/auth/oauth2/authorize${location.search}`);
  }, []);
  return <Loading fullScreen label="Connecting" />;
}

export function OAuthConsent({ me }: { me: Me }) {
  const query = location.search.slice(1);
  const [request, setRequest] = useState<{
    name: string;
    scopes: string[];
  } | null>(null);
  const action = useAction();
  useEffect(() => {
    void action.run(async () => {
      const params = new URLSearchParams(query);
      const client = authData(
        await authClient.oauth2.publicClientPrelogin({
          client_id: params.get("client_id") ?? "",
          oauth_query: query,
        }),
      );
      setRequest({
        name: client.client_name ?? "Connected application",
        scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
      });
    });
  }, [query]);
  function consent(accept: boolean) {
    void action.run(async () => {
      const result = authData(
        await authClient.oauth2.consent({ accept, oauth_query: query }),
      );
      location.assign(result.url);
    });
  }
  return (
    <div className="auth-layout">
      <section className="auth-main">
        <Brand />
        <div className="auth-form">
          <h1>Connect to Jevbox</h1>
          {!request && !action.error ? (
            <Loading />
          ) : (
            request && (
              <>
                <p>
                  <strong>{request.name}</strong> wants access as{" "}
                  {me.user.email}.
                </p>
                <ul className="my-5 space-y-2 text-sm">
                  {request.scopes.map((scope) => (
                    <li key={scope}>
                      {scope === "offline_access"
                        ? "Keep this connection active"
                        : scopeLabels[scope as ApiScope]}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  Access follows your current document permissions.
                </p>
                <div className="mt-6 flex gap-2">
                  <Button
                    variant="outline"
                    disabled={action.busy}
                    onClick={() => consent(false)}
                  >
                    Deny
                  </Button>
                  <Button loading={action.busy} onClick={() => consent(true)}>
                    Allow
                  </Button>
                </div>
              </>
            )
          )}
          {action.error && (
            <p className="error" role="alert">
              {action.error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
