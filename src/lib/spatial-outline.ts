export function outlineConnectorRoutes(
  rows: readonly { depth: number; parent: number }[],
  layout: {
    railY: number;
    rowTop: number;
    rowHeight: number;
    rowsPerColumn: number;
    columnWidth: number;
    indent: number;
    cardWidth: number;
    gap: number;
  },
) {
  if (!rows.length) return [];
  const {
    railY,
    rowTop,
    rowHeight,
    rowsPerColumn,
    columnWidth,
    indent,
    cardWidth,
    gap,
  } = layout;
  const spine = 0.12;
  const columnOf = (index: number) => Math.floor(index / rowsPerColumn);
  const place = (index: number) => ({
    x: columnOf(index) * columnWidth + 0.3 + rows[index].depth * indent,
    y: rowTop - (index % rowsPerColumn) * rowHeight,
  });
  const lastRootColumn = rows.reduce(
    (last, row, index) =>
      row.parent < 0 ? Math.max(last, columnOf(index)) : last,
    0,
  );
  const routes: [number, number][][] = [
    [
      [-gap, railY],
      [lastRootColumn * columnWidth + spine, railY],
    ],
  ];
  rows.forEach((row, index) => {
    const { x, y } = place(index);
    const column = columnOf(index);
    if (row.parent < 0) {
      const fromX = column * columnWidth + spine;
      routes.push([
        [fromX, railY],
        [fromX, y],
        [x + 0.02, y],
      ]);
      return;
    }
    const parent = place(row.parent);
    const parentColumn = columnOf(row.parent);
    if (parentColumn === column) {
      const fromX = parent.x + 0.1;
      routes.push([
        [fromX, parent.y],
        [fromX, y],
        [x + 0.02, y],
      ]);
      return;
    }
    const parentRight = parent.x + cardWidth - rows[row.parent].depth * indent;
    const fromGutter = (parentColumn + 1) * columnWidth - 0.2;
    const toGutter = column * columnWidth - 0.2;
    const bridgeY = railY + 0.12 * (row.depth + 1);
    const route: [number, number][] = [
      [parentRight - 0.02, parent.y],
      [fromGutter, parent.y],
    ];
    if (fromGutter !== toGutter)
      route.push([fromGutter, bridgeY], [toGutter, bridgeY]);
    route.push([toGutter, y], [x + 0.02, y]);
    routes.push(route);
  });
  return routes;
}

export function roundedOutlineSegments(
  points: readonly (readonly [number, number])[],
  radius = 0.07,
) {
  const sampled: [number, number][] = [];
  if (!points.length) return [];
  sampled.push([...points[0]]);
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const inLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const outLength = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (
      !r ||
      Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) <
        0.000001
    ) {
      sampled.push([...b]);
      continue;
    }
    const entry = [
      b[0] - ((b[0] - a[0]) * r) / inLength,
      b[1] - ((b[1] - a[1]) * r) / inLength,
    ];
    const exit = [
      b[0] + ((c[0] - b[0]) * r) / outLength,
      b[1] + ((c[1] - b[1]) * r) / outLength,
    ];
    sampled.push([entry[0], entry[1]]);
    for (let step = 1; step <= 8; step++) {
      const t = step / 8,
        s = 1 - t;
      sampled.push([
        s * s * entry[0] + 2 * s * t * b[0] + t * t * exit[0],
        s * s * entry[1] + 2 * s * t * b[1] + t * t * exit[1],
      ]);
    }
  }
  if (points.length > 1) sampled.push([...points.at(-1)!]);
  const segments: number[] = [];
  for (let i = 1; i < sampled.length; i++)
    if (
      sampled[i - 1][0] !== sampled[i][0] ||
      sampled[i - 1][1] !== sampled[i][1]
    )
      segments.push(...sampled[i - 1], -0.01, ...sampled[i], -0.01);
  return segments;
}

export function outlineFlowGeometry(
  rows: readonly { depth: number; parent: number }[],
  layout: Parameters<typeof outlineConnectorRoutes>[1],
) {
  const routes = outlineConnectorRoutes(rows, layout);
  const positions: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const rowDistances: number[] = [];
  const coverage = new Map<string, [number, number][]>();
  const curves = new Set<string>();
  const addSegment = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    start: number,
    end: number,
  ) => {
    const horizontal = Math.abs(by - ay) < 0.000001;
    const vertical = Math.abs(bx - ax) < 0.000001;
    if (!horizontal && !vertical) {
      const a = `${ax.toFixed(6)},${ay.toFixed(6)}`;
      const b = `${bx.toFixed(6)},${by.toFixed(6)}`;
      const key = [a, b].sort().join(":");
      if (curves.has(key)) return;
      curves.add(key);
      positions.push(ax, ay, -0.01, bx, by, -0.01);
      starts.push(start);
      ends.push(end);
      return;
    }
    const from = horizontal ? ax : ay;
    const to = horizontal ? bx : by;
    const min = Math.min(from, to),
      max = Math.max(from, to);
    const key = `${horizontal ? "h" : "v"}:${(horizontal ? ay : ax).toFixed(6)}`;
    const covered = coverage.get(key) ?? [];
    let portions: [number, number][] = [[min, max]];
    for (const [low, high] of covered)
      portions = portions.flatMap(([a, b]) => {
        if (high <= a || low >= b) return [[a, b]];
        const remaining: [number, number][] = [];
        if (low > a) remaining.push([a, low]);
        if (high < b) remaining.push([high, b]);
        return remaining;
      });
    if (to < from) portions.reverse();
    for (const [low, high] of portions) {
      if (high - low < 0.000001) continue;
      const a = to < from ? high : low;
      const b = to < from ? low : high;
      positions.push(
        horizontal ? a : ax,
        horizontal ? ay : a,
        -0.01,
        horizontal ? b : bx,
        horizontal ? by : b,
        -0.01,
      );
      starts.push(start + Math.abs(a - from));
      ends.push(start + Math.abs(b - from));
    }
    const merged: [number, number][] = [];
    for (const interval of [...covered, [min, max] as [number, number]].sort(
      (a, b) => a[0] - b[0],
    )) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1] + 0.000001)
        last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    coverage.set(key, merged);
  };
  const append = (
    route: readonly (readonly [number, number])[],
    start: number,
  ) => {
    const segments = roundedOutlineSegments(route);
    let distance = start;
    for (let i = 0; i < segments.length; i += 6) {
      const end =
        distance +
        Math.hypot(
          segments[i + 3] - segments[i],
          segments[i + 4] - segments[i + 1],
        );
      addSegment(
        segments[i],
        segments[i + 1],
        segments[i + 3],
        segments[i + 4],
        distance,
        end,
      );
      distance = end;
    }
    return distance;
  };
  if (routes.length) append(routes[0], 0);
  rows.forEach((row, index) => {
    const column = Math.floor(index / layout.rowsPerColumn);
    const parentColumn = Math.floor(row.parent / layout.rowsPerColumn);
    const start =
      row.parent < 0
        ? layout.gap + column * layout.columnWidth + 0.12
        : rowDistances[row.parent] +
          (parentColumn === column
            ? 0.08
            : layout.cardWidth - rows[row.parent].depth * layout.indent - 0.04);
    rowDistances.push(append(routes[index + 1], start));
  });
  return { positions, starts, ends, rowDistances };
}
