import { useEffect, useState } from "react";
import { authClient, authData } from "@/lib/auth-client";
import { Badge } from "./coss/badge";
import { Button } from "./coss/button";
import { Input } from "./coss/input";
import { Loading } from "./common";

type UsersPage = {
  users: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
  }[];
  total: number;
};

const pageSize = 50;

export function AdminUsersView() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState({ search: "", offset: 0 });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<UsersPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    void authClient.admin
      .listUsers({
        query: {
          limit: pageSize,
          offset: query.offset,
          sortBy: "createdAt",
          sortDirection: "desc",
          searchField: "email",
          searchOperator: "contains",
          ...(query.search ? { searchValue: query.search } : {}),
        },
        fetchOptions: { signal: controller.signal },
      })
      .then((response) => {
        if (!controller.signal.aborted) setResult(authData(response));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Unable to load users.",
          );
      });
    return () => controller.abort();
  }, [query, revision]);

  return (
    <div className="settings-page">
      <header className="settings-heading">
        <h1>All users</h1>
        <p>Everyone who has signed up for Jevbox, across all organizations.</p>
      </header>
      <section className="settings-section" aria-label="User directory">
        <form
          className="admin-users-search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery({ search: draft.trim().toLowerCase(), offset: 0 });
          }}
        >
          <Input
            type="search"
            aria-label="Search users by email"
            placeholder="Search by email"
            maxLength={254}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {error ? (
          <div className="empty-inline">
            <p role="alert">{error}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : !result ? (
          <Loading inline />
        ) : (
          <>
            <p className="muted admin-users-count" role="status">
              {result.total.toLocaleString()} {query.search ? "matching " : ""}
              {result.total === 1 ? "user" : "users"}
            </p>
            {result.users.length ? (
              <ul className="admin-users-list" aria-label="Registered users">
                {result.users.map((user) => (
                  <li className="admin-user-row" key={user.id}>
                    <div className="person-identity">
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                    </div>
                    <div className="admin-user-details">
                      <Badge
                        variant={user.emailVerified ? "success" : "secondary"}
                      >
                        {user.emailVerified ? "Verified" : "Unverified"}
                      </Badge>
                      <time dateTime={new Date(user.createdAt).toISOString()}>
                        Signed up{" "}
                        {new Date(user.createdAt).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">
                <p>
                  {query.search
                    ? "No users match this email."
                    : "No users to show."}
                </p>
              </div>
            )}
            <nav className="admin-users-pagination" aria-label="User pages">
              <span className="muted">
                {result.users.length
                  ? `${query.offset + 1}–${query.offset + result.users.length} of ${result.total}`
                  : `0 of ${result.total}`}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={query.offset === 0}
                onClick={() =>
                  setQuery((current) => ({
                    ...current,
                    offset: Math.max(0, current.offset - pageSize),
                  }))
                }
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={query.offset + pageSize >= result.total}
                onClick={() =>
                  setQuery((current) => ({
                    ...current,
                    offset: current.offset + pageSize,
                  }))
                }
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}
