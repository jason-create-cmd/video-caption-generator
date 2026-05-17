import { buildSubtitleArtifacts, buildSubtitleSegments, normalizeSonioxTokens } from "../shared/subtitles";
import type { RawSonioxToken } from "../shared/types";
import { polishSubtitleSegments } from "./subtitle-polisher";
import type { Env, JobRecord } from "./types";

const SONIOX_API_BASE = "https://api.soniox.com/v1";

export type CreateTranscriptionOptions = {
  audioUrl: string;
  enableSpeakerDiarization: boolean;
  contextText: string;
};

export type BuildArtifactOptions = {
  videoWidth?: number | null;
  videoHeight?: number | null;
  subtitlePrompt?: string | null;
};

export async function createSonioxTranscription(env: Env, options: CreateTranscriptionOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: "stt-async-v4",
    audio_url: options.audioUrl,
    language_hints: ["zh", "en"],
    enable_language_identification: true,
    enable_speaker_diarization: options.enableSpeakerDiarization,
    webhook_url: `${env.PUBLIC_BASE_URL.replace(/\/+$/g, "")}/api/soniox/webhook`,
    webhook_auth_header_name: "Authorization",
    webhook_auth_header_value: `Bearer ${env.WEBHOOK_SECRET}`
  };

  if (options.contextText.trim().length > 0) {
    body.context = options.contextText.trim();
  }

  const response = await fetch(`${SONIOX_API_BASE}/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SONIOX_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Soniox create failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new Error("Soniox create response did not include id");
  }
  return payload.id;
}

export async function fetchSonioxTranscript(env: Env, transcriptionId: string): Promise<RawSonioxToken[]> {
  const response = await fetch(`${SONIOX_API_BASE}/transcriptions/${transcriptionId}/transcript`, {
    headers: { Authorization: `Bearer ${env.SONIOX_API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`Soniox transcript failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { tokens?: RawSonioxToken[] };
  if (!Array.isArray(payload.tokens)) {
    throw new Error("Soniox transcript response did not include tokens");
  }
  return payload.tokens;
}

export async function buildArtifactsFromSoniox(env: Env, job: JobRecord, options: BuildArtifactOptions = {}) {
  if (!job.sonioxTranscriptionId) {
    throw new Error("Job has no Soniox transcription id");
  }

  const rawTokens = await fetchSonioxTranscript(env, job.sonioxTranscriptionId);
  const tokens = normalizeSonioxTokens(rawTokens);
  if (tokens.length === 0) {
    throw new Error("Soniox transcript did not include timed tokens");
  }

  const videoWidth = options.videoWidth ?? job.videoWidth ?? undefined;
  const videoHeight = options.videoHeight ?? job.videoHeight ?? undefined;
  const baseOptions = { baseName: job.originalName, videoWidth, videoHeight };
  const draftSegments = buildSubtitleSegments(tokens, baseOptions);
  const polish = await polishSubtitleSegments(env, draftSegments, {}, {
    customInstruction: options.subtitlePrompt ?? job.subtitlePrompt ?? null
  });
  const artifactOptions = { ...baseOptions, segments: polish.segments, polish: polish.metadata };

  return buildSubtitleArtifacts(tokens, artifactOptions);
}
