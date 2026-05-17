import type { JobDto } from "../shared/types";
import type { JobRecord } from "./types";

type JobRow = {
  id: string;
  original_name: string;
  size_bytes: number;
  video_width: number | null;
  video_height: number | null;
  subtitle_prompt: string | null;
  upload_key: string;
  srt_key: string | null;
  ass_key: string | null;
  transcript_key: string | null;
  soniox_transcription_id: string | null;
  status: JobRecord["status"];
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
};

export async function insertUploadedJob(db: D1Database, job: JobRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, original_name, size_bytes, video_width, video_height, subtitle_prompt, upload_key, srt_key, ass_key, transcript_key,
        soniox_transcription_id, status, error_message, created_at, completed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      job.id,
      job.originalName,
      job.sizeBytes,
      job.videoWidth ?? null,
      job.videoHeight ?? null,
      job.subtitlePrompt ?? null,
      job.uploadKey,
      job.srtKey,
      job.assKey,
      job.transcriptKey,
      job.sonioxTranscriptionId,
      job.status,
      job.errorMessage,
      job.createdAt,
      job.completedAt,
      job.expiresAt
    )
    .run();
}

export async function updateVideoDimensions(
  db: D1Database,
  id: string,
  dimensions: { videoWidth: number | null; videoHeight: number | null }
): Promise<void> {
  await db
    .prepare("UPDATE jobs SET video_width = ?, video_height = ? WHERE id = ?")
    .bind(dimensions.videoWidth, dimensions.videoHeight, id)
    .run();
}

export async function updateJobSubtitleOptions(
  db: D1Database,
  id: string,
  options: { videoWidth: number | null; videoHeight: number | null; subtitlePrompt: string | null }
): Promise<void> {
  await db
    .prepare("UPDATE jobs SET video_width = ?, video_height = ?, subtitle_prompt = ? WHERE id = ?")
    .bind(options.videoWidth, options.videoHeight, options.subtitlePrompt, id)
    .run();
}

export async function getJob(db: D1Database, id: string): Promise<JobRecord | null> {
  const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  return row ? toJob(row) : null;
}

export async function getJobBySonioxId(db: D1Database, sonioxId: string): Promise<JobRecord | null> {
  const row = await db
    .prepare("SELECT * FROM jobs WHERE soniox_transcription_id = ?")
    .bind(sonioxId)
    .first<JobRow>();
  return row ? toJob(row) : null;
}

export async function listJobs(db: D1Database, limit = 50): Promise<JobRecord[]> {
  const result = await db
    .prepare("SELECT * FROM jobs WHERE status != 'deleted' ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<JobRow>();
  return result.results.map(toJob);
}

export async function listCleanupCandidates(db: D1Database): Promise<JobRecord[]> {
  const result = await db
    .prepare("SELECT * FROM jobs WHERE status != 'deleted' ORDER BY created_at ASC LIMIT 100")
    .all<JobRow>();
  return result.results.map(toJob);
}

export async function markTranscribing(db: D1Database, id: string, sonioxTranscriptionId: string): Promise<void> {
  await db
    .prepare("UPDATE jobs SET status = 'transcribing', soniox_transcription_id = ?, error_message = NULL WHERE id = ?")
    .bind(sonioxTranscriptionId, id)
    .run();
}

export async function markCompleted(
  db: D1Database,
  id: string,
  keys: { srtKey: string; assKey: string; transcriptKey: string },
  now: Date
): Promise<void> {
  const completedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `UPDATE jobs
       SET status = 'completed', srt_key = ?, ass_key = ?, transcript_key = ?,
           completed_at = ?, expires_at = ?, error_message = NULL
       WHERE id = ?`
    )
    .bind(keys.srtKey, keys.assKey, keys.transcriptKey, completedAt, expiresAt, id)
    .run();
}

export async function markFailed(db: D1Database, id: string, message: string): Promise<void> {
  await db.prepare("UPDATE jobs SET status = 'failed', error_message = ? WHERE id = ?").bind(message, id).run();
}

export async function markDeleted(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE jobs SET status = 'deleted' WHERE id = ?").bind(id).run();
}

export function toJobDto(job: JobRecord): JobDto {
  return {
    id: job.id,
    originalName: job.originalName,
    sizeBytes: job.sizeBytes,
    videoWidth: job.videoWidth ?? null,
    videoHeight: job.videoHeight ?? null,
    status: job.status,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    hasSrt: Boolean(job.srtKey),
    hasAss: Boolean(job.assKey),
    hasTranscript: Boolean(job.transcriptKey)
  };
}

function toJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    originalName: row.original_name,
    sizeBytes: row.size_bytes,
    videoWidth: row.video_width,
    videoHeight: row.video_height,
    subtitlePrompt: row.subtitle_prompt,
    uploadKey: row.upload_key,
    srtKey: row.srt_key,
    assKey: row.ass_key,
    transcriptKey: row.transcript_key,
    sonioxTranscriptionId: row.soniox_transcription_id,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at
  };
}
