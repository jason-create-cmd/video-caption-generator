import { describe, expect, it } from "vitest";
import { getCleanupDecision } from "../src/worker/cleanup";
import type { JobRecord } from "../src/worker/types";

describe("cleanup decisions", () => {
  it("deletes completed uploads after 24 hours and keeps subtitle outputs for 30 days", () => {
    const job = makeJob({
      status: "completed",
      createdAt: "2026-05-01T00:00:00.000Z",
      completedAt: "2026-05-01T01:00:00.000Z",
      expiresAt: "2026-05-31T01:00:00.000Z"
    });

    const decision = getCleanupDecision(job, new Date("2026-05-02T02:00:00.000Z"));

    expect(decision.deleteUpload).toBe(true);
    expect(decision.deleteOutputs).toBe(false);
    expect(decision.markDeleted).toBe(false);
  });

  it("deletes failed or stuck uploads after 72 hours", () => {
    const job = makeJob({
      status: "transcribing",
      createdAt: "2026-05-01T00:00:00.000Z",
      completedAt: null,
      expiresAt: "2026-05-31T00:00:00.000Z"
    });

    const decision = getCleanupDecision(job, new Date("2026-05-04T01:00:00.000Z"));

    expect(decision.deleteUpload).toBe(true);
    expect(decision.deleteOutputs).toBe(false);
  });

  it("deletes outputs and marks job deleted after retention expires", () => {
    const job = makeJob({
      status: "completed",
      createdAt: "2026-05-01T00:00:00.000Z",
      completedAt: "2026-05-01T01:00:00.000Z",
      expiresAt: "2026-05-31T01:00:00.000Z"
    });

    const decision = getCleanupDecision(job, new Date("2026-06-01T00:00:00.000Z"));

    expect(decision.deleteUpload).toBe(true);
    expect(decision.deleteOutputs).toBe(true);
    expect(decision.markDeleted).toBe(true);
  });
});

function makeJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: "job_1",
    originalName: "demo.mp4",
    sizeBytes: 1000,
    uploadKey: "uploads/job_1/demo.mp4",
    srtKey: "outputs/job_1/subtitle.srt",
    assKey: "outputs/job_1/subtitle.ass",
    transcriptKey: "outputs/job_1/transcript.json",
    sonioxTranscriptionId: "tr_1",
    status: "uploaded",
    errorMessage: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    completedAt: null,
    expiresAt: null,
    ...overrides
  };
}
