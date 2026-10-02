const fileBytes = 250 * 1000 * 1000;

export const uploadLimits = {
  fileBytes,
  mcpRequestBytes: 4 * Math.ceil(fileBytes / 3) + 64 * 1024,
  active: Number.POSITIVE_INFINITY,
  activePerUser: Number.POSITIVE_INFINITY,
  activeBytes: 512 * 1024 * 1024,
  receiveMs: 120_000,
  attemptsPerMinute: {
    user: 10_000,
    organization: Infinity,
    deployment: Infinity,
  },
  attemptsPerHour: {
    user: 100_000,
    organization: Infinity,
    deployment: Infinity,
  },
  documents: { user: Infinity, organization: Infinity, deployment: Infinity },
  pending: { user: Infinity, organization: Infinity, deployment: Infinity },
  storedBytes: { user: Infinity, organization: Infinity, deployment: Infinity },
  dailyBytes: { user: Infinity, organization: Infinity, deployment: Infinity },
} as const;
