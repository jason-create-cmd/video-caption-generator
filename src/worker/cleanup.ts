import type { JobRecord } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const COMPLETED_UPLOAD_RETENTION_MS = 24 * HOUR_MS;
const STUCK_UPLOAD_RETENTION_MS = 72 * HOUR_MS;

export type CleanupDecision = {
  deleteUpload: boolean;
  deleteOutputs: boolean;
  markDeleted: boolean;
};

export function getCleanupDecision(job: JobRecord, now: Date): CleanupDecision {
  const nowMs = now.getTime();
  const createdMs = Date.parse(job.createdAt);
  const completedMs = job.completedAt ? Date.parse(job.completedAt) : null;
  const expiresMs = job.expiresAt ? Date.parse(job.expiresAt) : null;

  const outputExpired = expiresMs !== null && nowMs >= expiresMs;
  const completedUploadExpired =
    job.status === "completed" && completedMs !== null && nowMs - completedMs >= COMPLETED_UPLOAD_RETENTION_MS;
  const stuckUploadExpired =
    (job.status === "uploaded" || job.status === "transcribing" || job.status === "failed") &&
    nowMs - createdMs >= STUCK_UPLOAD_RETENTION_MS;

  return {
    deleteUpload: completedUploadExpired || stuckUploadExpired || outputExpired,
    deleteOutputs: outputExpired,
    markDeleted: outputExpired
  };
}
