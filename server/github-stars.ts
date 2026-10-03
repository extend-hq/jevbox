export function createGitHubStars(
  fetcher: typeof fetch = fetch,
  clock = Date.now,
) {
  let stars: number | null = null;
  let refreshAfter = 0;
  let pending: Promise<number | null> | undefined;
  return () => {
    if (clock() < refreshAfter) return Promise.resolve(stars);
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetcher(
          "https://api.github.com/repos/extend-hq/jevbox",
          {
            headers: { Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!response.ok) throw new Error("Repository unavailable");
        const data = await response.json();
        if (
          !Number.isSafeInteger(data?.stargazers_count) ||
          data.stargazers_count < 0
        )
          throw new Error("Invalid star count");
        stars = data.stargazers_count;
        refreshAfter = clock() + 86_400_000;
      } catch {
        refreshAfter = clock() + 900_000;
      }
      return stars;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
