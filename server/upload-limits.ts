import { uploadLimits } from "../shared/uploads";
import { configuredLimit } from "./rate-limits";

const scopedLimits = (
  name: string,
  defaults: { user: number; organization: number; deployment: number },
) => ({
  user: configuredLimit(`UPLOAD_USER_${name}`, defaults.user),
  organization: configuredLimit(
    `UPLOAD_ORGANIZATION_${name}`,
    defaults.organization,
  ),
  deployment: configuredLimit(`UPLOAD_DEPLOYMENT_${name}`, defaults.deployment),
});

export function uploadAdmissionLimits() {
  return {
    active: configuredLimit("UPLOAD_CONCURRENCY", uploadLimits.active),
    activePerUser: configuredLimit(
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
