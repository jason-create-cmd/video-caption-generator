export type JobStatus = "uploaded" | "transcribing" | "completed" | "failed" | "deleted";

export type SonioxToken = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speaker?: string | number;
  language?: string;
};

export type RawSonioxToken = {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  speaker?: string | number;
  language?: string;
};

export type SubtitleSegment = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | number;
};

export type LlmProvider = "gemini" | "deepseek" | "off";

export type SubtitlePolishStatus = "disabled" | "polished" | "fallback";

export type SubtitlePolishMetadata = {
  status: SubtitlePolishStatus;
  provider: LlmProvider;
  model?: string;
  fallbackReason?: string;
  customInstruction?: boolean;
};

export type TranscriptJson = {
  text: string;
  rawText: string;
  polishedText: string;
  tokens: SonioxToken[];
  segments: SubtitleSegment[];
  polish: SubtitlePolishMetadata;
  generatedAt: string;
};

export type SubtitleArtifacts = {
  segments: SubtitleSegment[];
  srt: string;
  ass: string;
  transcriptJson: TranscriptJson;
};

export type JobDto = {
  id: string;
  originalName: string;
  sizeBytes: number;
  videoWidth: number | null;
  videoHeight: number | null;
  status: JobStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  hasSrt: boolean;
  hasAss: boolean;
  hasTranscript: boolean;
};
