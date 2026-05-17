import type { JobStatus } from "../shared/types";

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  SONIOX_API_KEY: string;
  LLM_PROVIDER?: "gemini" | "deepseek" | "off" | string;
  LLM_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  WEBHOOK_SECRET: string;
  PUBLIC_BASE_URL: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
};

export type JobRecord = {
  id: string;
  originalName: string;
  sizeBytes: number;
  videoWidth?: number | null;
  videoHeight?: number | null;
  subtitlePrompt?: string | null;
  uploadKey: string;
  srtKey: string | null;
  assKey: string | null;
  transcriptKey: string | null;
  sonioxTranscriptionId: string | null;
  status: JobStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

export type UploadPresignRequest = {
  fileName: string;
  fileSize: number;
  contentType: string;
};

export type CreateJobRequest = {
  jobId: string;
  videoWidth?: number | null;
  videoHeight?: number | null;
  subtitlePrompt?: string;
  enableSpeakerDiarization?: boolean;
  contextText?: string;
};
