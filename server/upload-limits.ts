import { uploadLimits } from "../shared/uploads";

type ScopedLimit = { user: number; organization: number; deployment: number };
export type UploadAdmissionLimits = {
  waiting: number;
  waitMs: number;
  active: number;
  activePerUser: number;
  activeBytes: number;
  validation: number;
  receiveMs: number;
  attemptsPerMinute: ScopedLimit;
  attemptsPerHour: ScopedLimit;
  documents: ScopedLimit;
  pending: ScopedLimit;
  storedBytes: ScopedLimit;
  dailyBytes: ScopedLimit;
};

export function uploadAdmissionLimits(): UploadAdmissionLimits {
  return {
    ...uploadLimits,
    waiting: 32,
    waitMs: 10_000,
    validation: 4,
  };
}
