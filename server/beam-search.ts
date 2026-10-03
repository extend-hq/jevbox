import { createJev, retrievalLimits } from "./jev";

export type RouteNode<T> = {
  id: string;
  describe: () => Promise<string | undefined>;
  children: RouteNode<T>[];
  loadChildren?: () => Promise<RouteNode<T>[]>;
  scope?: string;
  value?: T;
};
export type Route<T> = {
  node: RouteNode<T>;
  path: RouteNode<T>[];
  logProbability: number;
  decisions: number;
  probability: number;
  score: number;
};

export function extendRoute<T>(
  route: Route<T>,
  node: RouteNode<T>,
  probability: number,
  decision: boolean,
): Route<T> {
  const logProbability =
    route.logProbability + (decision ? Math.log(probability) : 0);
  const decisions = route.decisions + Number(decision);
  return {
    node,
    path: [...route.path, node],
    logProbability,
    decisions,
    probability,
    score: decisions ? Math.exp(logProbability / decisions) : 1,
  };
}

export function createTraversal<T>(
  roots: RouteNode<T>[],
  jev: Pick<ReturnType<typeof createJev>, "choose">,
  query: string,
  hasEvidence: (node: RouteNode<T>) => boolean = () => false,
  recoverRoutes = false,
) {
  const root: RouteNode<T> = {
    id: "library",
    describe: async () => "Library",
    children: roots,
  };
  let beam: Route<T>[] = [
    {
      node: root,
      path: [],
      logProbability: 0,
      decisions: 0,
      probability: 1,
      score: 1,
    },
  ];
  const deferred: Route<T>[] = [];
  const visited = new Set<string>();
  const expandedNodes = new Set<string>();
  const evidenceVisits = new Map<string, number>();
  let expansions = 0;
  const rank = (a: Route<T>, b: Route<T>) => {
    const rounds = (route: Route<T>) =>
      Math.floor(
        (evidenceVisits.get(route.node.scope ?? "") ?? 0) /
          retrievalLimits.sectionsPerDocument,
      );
    return rounds(a) - rounds(b) || b.score - a.score;
  };

  return {
    get limited() {
      return expansions >= retrievalLimits.expansions;
    },
    get exhausted() {
      return (
        expansions >= retrievalLimits.expansions ||
        (!beam.length && !deferred.length)
      );
    },
    async walk() {
      const found: Route<T>[] = [];
      beam = [...beam, ...deferred.splice(0)].sort(rank);
      deferred.push(...beam.splice(retrievalLimits.beamWidth));
      while (beam.length && expansions < retrievalLimits.expansions) {
        const authorized: Route<T>[] = [];
        let newEvidence = false;
        for (const route of beam) {
          if ((await route.node.describe()) === undefined) continue;
          authorized.push(route);
          if (!visited.has(route.node.id)) {
            visited.add(route.node.id);
            found.push(route);
            if (hasEvidence(route.node)) {
              newEvidence = true;
              if (route.node.scope)
                evidenceVisits.set(
                  route.node.scope,
                  (evidenceVisits.get(route.node.scope) ?? 0) + 1,
                );
            }
          }
        }
        beam = authorized;
        if (newEvidence) return found;
        const prepared: {
          route: Route<T>;
          choices: { id: string; text: string; node: RouteNode<T> }[];
        }[] = [];
        for (const route of beam) {
          if ((await route.node.describe()) === undefined) continue;
          expandedNodes.add(route.node.id);
          const children = route.node.loadChildren
            ? await route.node.loadChildren()
            : route.node.children;
          if (!children.length) continue;
          if (++expansions > retrievalLimits.expansions) break;
          const choices = (
            await Promise.all(
              children.map(async (node) => {
                const text = await node.describe();
                return text === undefined ? [] : [{ id: node.id, text, node }];
              }),
            )
          ).flat();
          if (choices.length) prepared.push({ route, choices });
        }
        if (!prepared.length) break;
        const distributions = new Map<string, Record<string, number>>();
        let pending: typeof prepared = [];
        let characters = 0;
        const dispatch = async () => {
          const menus = [];
          for (const menu of pending) {
            const choices = (
              await Promise.all(
                menu.choices.map(async (choice) => {
                  const text = await choice.node.describe();
                  return text === undefined ? [] : [{ ...choice, text }];
                }),
              )
            ).flat();
            menu.choices = choices;
            if (choices.length > 1)
              menus.push({ id: menu.route.node.id, choices });
          }
          for (const [id, distribution] of await jev.choose(query, menus))
            distributions.set(id, distribution);
          pending = [];
          characters = 0;
        };
        for (const menu of prepared) {
          const size = JSON.stringify(
            menu.choices.map(({ id, text }) => ({ id, text })),
          ).length;
          if (
            pending.length &&
            characters + size > retrievalLimits.routingCharacters
          )
            await dispatch();
          pending.push(menu);
          characters += size;
        }
        if (pending.length) await dispatch();
        const expanded: Route<T>[] = [];
        for (const { route, choices } of prepared) {
          const decision = choices.length > 1;
          const distribution = distributions.get(route.node.id);
          const descriptions = await Promise.all(
            choices.map((choice) => choice.node.describe()),
          );
          for (const [index, choice] of choices.entries()) {
            const probability = decision ? distribution![choice.id] : 1;
            const rejected =
              probability <= 0 ||
              (decision && probability <= distribution!.none);
            if (rejected && !recoverRoutes) continue;
            if (descriptions[index] === undefined) continue;
            const next = extendRoute(
              route,
              choice.node,
              Math.max(probability, 0.000001),
              decision,
            );
            if (rejected) {
              deferred.push(next);
            } else {
              expanded.push(next);
            }
          }
        }
        const ranked = [...expanded, ...deferred.splice(0)].sort(rank);
        beam = ranked.slice(0, retrievalLimits.beamWidth);
        deferred.push(
          ...ranked
            .slice(retrievalLimits.beamWidth)
            .filter((route) => !expandedNodes.has(route.node.id)),
        );
        deferred.splice(retrievalLimits.expansions);
        if (found.some((route) => hasEvidence(route.node))) return found;
      }
      beam = [];
      return found;
    },
  };
}
