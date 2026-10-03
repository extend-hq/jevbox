const fileBytes = 250 * 1000 * 1000;
const gib = 1024 ** 3;

export const uploadLimits = {
  fileBytes,
  batchFiles: 100,
  mcpRequestBytes: 4 * Math.ceil(fileBytes / 3) + 64 * 1024,
  active: 4,
  activePerUser: 2,
  activeBytes: 128 * 1024 * 1024,
  receiveMs: 120_000,
  attemptsPerMinute: { user: 240, organization: 600, deployment: 1200 },
  attemptsPerHour: { user: 300, organization: 1200, deployment: 5000 },
  documents: { user: 1000, organization: 5000, deployment: 25000 },
  pending: { user: 200, organization: 500, deployment: 2000 },
  storedBytes: {
    user: 15 * gib,
    organization: 10 * 1000 ** 3,
    deployment: 500 * gib,
  },
  dailyBytes: {
    user: 15 * gib,
    organization: 100 * gib,
    deployment: 250 * gib,
  },
} as const;
