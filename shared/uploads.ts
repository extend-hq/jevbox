const fileBytes = 250 * 1000 * 1000;

export const uploadLimits = {
  fileBytes,
  mcpRequestBytes: 4 * Math.ceil(fileBytes / 3) + 64 * 1024,
  active: 64,
  activePerUser: 4,
  activeBytes: 512 * 1024 * 1024,
  receiveMs: 120_000,
  attemptsPerMinute: { user: 120, organization: 1200, deployment: 10_000 },
  attemptsPerHour: { user: 2000, organization: 20_000, deployment: 100_000 },
  documents: { user: 10_000, organization: 100_000, deployment: 1_000_000 },
  pending: { user: 500, organization: 5000, deployment: 50_000 },
  storedBytes: {
    user: 10 * 1024 ** 3,
    organization: 100 * 1024 ** 3,
    deployment: 10 * 1024 ** 4,
  },
  dailyBytes: {
    user: 2 * 1024 ** 3,
    organization: 20 * 1024 ** 3,
    deployment: 1024 ** 4,
  },
} as const;
