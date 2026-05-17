CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  upload_key TEXT NOT NULL,
  srt_key TEXT,
  ass_key TEXT,
  transcript_key TEXT,
  soniox_transcription_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'transcribing', 'completed', 'failed', 'deleted')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_soniox_transcription_id ON jobs(soniox_transcription_id);
