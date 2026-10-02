export const uploadLimits = {
  fileBytes: 30 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  mcpBytes: 2 * 1024 * 1024,
  active: 2,
  receiveMs: 30_000,
  pending: { user: 10, organization: 50, deployment: 100 },
  storedBytes: {
    user: 512 * 1024 * 1024,
    organization: 2 * 1024 ** 3,
    deployment: 5 * 1024 ** 3,
  },
  dailyBytes: {
    user: 150 * 1024 * 1024,
    organization: 1024 ** 3,
    deployment: 2 * 1024 ** 3,
  },
} as const;
