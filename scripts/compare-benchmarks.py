import argparse
import collections
import json
import math
import pathlib
import random


def load(path):
    rows = {}
    for line in path.read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            rows[(row.get("dataset", "docbench"), row["id"])] = row
    return rows


def percentile(values, fraction):
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def compare(before, after, mode):
    field, metric = ("assessment", "recoverable") if mode == "retrieval" else ("judgment", "answerCorrect")
    common = sorted(before.keys() & after.keys())
    pairs = []
    missing = []
    for key in common:
        a, b = before[key], after[key]
        if a["question"] != b["question"]:
            raise ValueError("Question text differs between runs")
        if mode == "retrieval" and a["type"] in ["unanswerable", "una-web"]:
            continue
        if a.get(field) is None or b.get(field) is None:
            missing.append(":".join(key))
            continue
        pairs.append((key, a, b, bool(a[field][metric]), bool(b[field][metric])))
    gains = [":".join(key) for key, _, _, a, b in pairs if b and not a]
    losses = [":".join(key) for key, _, _, a, b in pairs if a and not b]
    discordant = len(gains) + len(losses)
    p = min(1.0, 2 * sum(math.comb(discordant, k) for k in range(min(len(gains), len(losses)) + 1)) / 2 ** discordant) if discordant else 1.0
    clusters = collections.defaultdict(list)
    for key, a, _, old, new in pairs:
        clusters[(key[0], a.get("benchmarkId", a.get("documentId")))].append(int(new) - int(old))
    groups = list(clusters.values())
    rng = random.Random(20261002)
    boot = []
    if groups:
        for _ in range(10000):
            selected = rng.choices(groups, k=len(groups))
            boot.append(sum(map(sum, selected)) / sum(map(len, selected)))
    latency = {}
    for label, position in [("before", 1), ("after", 2)]:
        rows = [pair[position] for pair in pairs]
        latency[label] = {}
        for name in ["retrievalMs", "totalMs"]:
            values = [row[name] for row in rows if row.get(name) is not None]
            latency[label][name] = {"p50": percentile(values, 0.5), "p95": percentile(values, 0.95)}
        latency[label]["providerRequests"] = sum(row.get("metrics", {}).get("requests", 0) for row in rows)
    return {
        "paired": len(pairs), "documentClusters": len(groups),
        "beforeCorrect": sum(pair[3] for pair in pairs), "afterCorrect": sum(pair[4] for pair in pairs),
        "delta": (len(gains) - len(losses)) / len(pairs) if pairs else None,
        "gains": gains, "losses": losses, "exactMcNemarP": p,
        "documentClusterBootstrap95": [percentile(boot, 0.025), percentile(boot, 0.975)],
        "missingJudgments": missing,
        "unpairedBefore": [":".join(key) for key in sorted(before.keys() - after.keys())],
        "unpairedAfter": [":".join(key) for key in sorted(after.keys() - before.keys())],
        "pairedLatency": latency,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("before", type=pathlib.Path)
    parser.add_argument("after", type=pathlib.Path)
    parser.add_argument("--mode", choices=["retrieval", "qa"], required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    before, after = load(args.before), load(args.after)
    result = {"before": str(args.before), "after": str(args.after), "mode": args.mode, "overall": compare(before, after, args.mode)}
    result["byDataset"] = {dataset: compare({k: v for k, v in before.items() if k[0] == dataset}, {k: v for k, v in after.items() if k[0] == dataset}, args.mode) for dataset in sorted({k[0] for k in before} | {k[0] for k in after})}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["overall"]))
