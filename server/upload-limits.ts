import { uploadLimits } from "../shared/uploads";
import { configuredLimit } from "./rate-limits";

const optionalLimit = (name: string, fallback: number) =>
  process.env[name] === undefined ? fallback : configuredLimit(name, fallback);

const scopedLimits = (
  name: string,
  defaults: { user: number; organization: number; deployment: number },
) => ({
  user: optionalLimit(`UPLOAD_USER_${name}`, defaults.user),
  organization: Infinity,
  deployment: Infinity,
});

export function uploadAdmissionLimits() {
  return {
    active: optionalLimit("UPLOAD_CONCURRENCY", uploadLimits.active),
    activePerUser: optionalLimit(
      "UPLOAD_USER_CONCURRENCY",
      uploadLimits.activePerUser,
    ),
    activeBytes: configuredLimit(
      "UPLOAD_IN_FLIGHT_BYTES",
      uploadLimits.activeBytes,
    ),
    validation: configuredLimit("UPLOAD_VALIDATION_CONCURRENCY", 4),
    receiveMs: configuredLimit("UPLOAD_TIMEOUT_MS", uploadLimits.receiveMs),
    attemptsPerMinute: scopedLimits(
      "ATTEMPTS_PER_MINUTE",
      uploadLimits.attemptsPerMinute,
    ),
    attemptsPerHour: scopedLimits(
      "ATTEMPTS_PER_HOUR",
      uploadLimits.attemptsPerHour,
    ),
    documents: scopedLimits("DOCUMENTS", uploadLimits.documents),
    pending: scopedLimits("PENDING_DOCUMENTS", uploadLimits.pending),
    storedBytes: scopedLimits("STORED_BYTES", uploadLimits.storedBytes),
    dailyBytes: scopedLimits("DAILY_BYTES", uploadLimits.dailyBytes),
  };
}

export type UploadAdmissionLimits = ReturnType<typeof uploadAdmissionLimits>;
