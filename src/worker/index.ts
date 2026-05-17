import { getCleanupDecision } from "./cleanup";
import {
  getJob,
  getJobBySonioxId,
  insertUploadedJob,
  listCleanupCandidates,
  listJobs,
  markCompleted,
  markDeleted,
  markFailed,
  markTranscribing,
  toJobDto,
  updateJobSubtitleOptions
} from "./db";
import { clearSessionCookie, createSessionCookie, verifySessionCookie } from "./session";
import { buildArtifactsFromSoniox, createSonioxTranscription } from "./soniox";
import { createReadUrl, createUploadUrl, deleteObjects, getTextObject, putTextObject } from "./r2";
import type { CreateJobRequest, Env, JobRecord, UploadPresignRequest } from "./types";

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runCleanup(env);
  }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

  try {
    if (url.pathname === "/api/session" && request.method === "POST") return login(request, env);
    if (url.pathname === "/api/session" && request.method === "DELETE") return logout();
    if (url.pathname === "/api/soniox/webhook" && request.method === "POST") return sonioxWebhook(request, env);

    const authenticated = await verifySessionCookie(request.headers.get("Cookie"), env.SESSION_SECRET);
    if (!authenticated) return json({ error: "Unauthorized" }, 401);

    if (url.pathname === "/api/me" && request.method === "GET") return json({ authenticated: true });
    if (url.pathname === "/api/uploads/presign" && request.method === "POST") return presignUpload(request, env);
    if (url.pathname === "/api/jobs" && request.method === "POST") return createJob(request, env);
    if (url.pathname === "/api/jobs" && request.method === "GET") return getJobs(env);

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && request.method === "GET") return getSingleJob(env, jobMatch[1]!);

    const downloadMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/download$/);
    if (downloadMatch && request.method === "GET") return downloadJobFile(env, downloadMatch[1]!, url.searchParams.get("format"));

    const deleteMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/delete$/);
    if (deleteMatch && request.method === "POST") return deleteJob(env, deleteMatch[1]!);

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { password?: string };
  if (body.password !== env.ADMIN_PASSWORD) return json({ error: "Invalid password" }, 401);

  const headers = new Headers({ "Set-Cookie": await createSessionCookie(env.SESSION_SECRET) });
  return json({ authenticated: true }, 200, headers);
}

function logout(): Response {
  return json({ authenticated: false }, 200, new Headers({ "Set-Cookie": clearSessionCookie() }));
}

async function presignUpload(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as UploadPresignRequest;
  validateUploadRequest(body);

  const jobId = crypto.randomUUID();
  const uploadKey = `uploads/${jobId}/${safeFileName(body.fileName)}`;
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: jobId,
    originalName: body.fileName,
    sizeBytes: body.fileSize,
    videoWidth: null,
    videoHeight: null,
    subtitlePrompt: null,
    uploadKey,
    srtKey: null,
    assKey: null,
    transcriptKey: null,
    sonioxTranscriptionId: null,
    status: "uploaded",
    errorMessage: null,
    createdAt: now,
    completedAt: null,
    expiresAt: null
  };
  await insertUploadedJob(env.DB, job);

  return json({
    jobId,
    uploadKey,
    uploadUrl: await createUploadUrl(env, uploadKey),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES
  });
}

async function createJob(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as CreateJobRequest;
  if (!body.jobId) return json({ error: "jobId is required" }, 400);
  const videoDimensions = parseVideoDimensions(body);
  const subtitlePrompt = parseSubtitlePrompt(body.subtitlePrompt);

  const job = await getJob(env.DB, body.jobId);
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "uploaded") return json({ error: `Job is ${job.status}` }, 409);

  await updateJobSubtitleOptions(env.DB, job.id, { ...videoDimensions, subtitlePrompt });
  const jobWithDimensions = {
    ...job,
    videoWidth: videoDimensions.videoWidth,
    videoHeight: videoDimensions.videoHeight,
    subtitlePrompt
  };

  const audioUrl = await createReadUrl(env, job.uploadKey);
  const sonioxId = await createSonioxTranscription(env, {
    audioUrl,
    enableSpeakerDiarization: Boolean(body.enableSpeakerDiarization),
    contextText: body.contextText ?? ""
  });
  await markTranscribing(env.DB, job.id, sonioxId);

  const updated = await getJob(env.DB, job.id);
  return json({ job: toJobDto(updated ?? jobWithDimensions) });
}

async function getJobs(env: Env): Promise<Response> {
  const jobs = await listJobs(env.DB);
  return json({ jobs: jobs.map(toJobDto) });
}

async function getSingleJob(env: Env, id: string): Promise<Response> {
  const job = await getJob(env.DB, id);
  if (!job || job.status === "deleted") return json({ error: "Job not found" }, 404);
  return json({ job: toJobDto(job) });
}

async function downloadJobFile(env: Env, id: string, format: string | null): Promise<Response> {
  const job = await getJob(env.DB, id);
  if (!job || job.status === "deleted") return json({ error: "Job not found" }, 404);

  const key = format === "srt" ? job.srtKey : format === "ass" ? job.assKey : format === "json" ? job.transcriptKey : null;
  if (!key) return json({ error: "Requested file is not available" }, 404);

  const object = await getTextObject(env, key);
  if (!object) return json({ error: "File object is missing" }, 404);

  const headers = new Headers({
    "Content-Type": object.contentType,
    "Content-Disposition": `attachment; filename="${downloadName(job.originalName, format!)}"`
  });
  return cors(new Response(object.body, { headers }));
}

async function deleteJob(env: Env, id: string): Promise<Response> {
  const job = await getJob(env.DB, id);
  if (!job) return json({ error: "Job not found" }, 404);
  await deleteObjects(env, [job.uploadKey, job.srtKey, job.assKey, job.transcriptKey]);
  await markDeleted(env.DB, id);
  return json({ deleted: true });
}

async function sonioxWebhook(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Authorization") !== `Bearer ${env.WEBHOOK_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = (await request.json()) as { id?: string; status?: string; error_message?: string };
  if (!body.id || !body.status) return json({ error: "Invalid webhook payload" }, 400);

  const job = await getJobBySonioxId(env.DB, body.id);
  if (!job) return json({ accepted: true });

  if (body.status === "completed") {
    await completeJob(env, job);
    return json({ accepted: true });
  }

  if (body.status === "failed" || body.status === "error") {
    await markFailed(env.DB, job.id, body.error_message ?? `Soniox status: ${body.status}`);
  }

  return json({ accepted: true });
}

async function completeJob(env: Env, job: JobRecord): Promise<void> {
  const artifacts = await buildArtifactsFromSoniox(env, job, {
    videoWidth: job.videoWidth,
    videoHeight: job.videoHeight
  });
  const outputPrefix = `outputs/${job.id}`;
  const srtKey = `${outputPrefix}/subtitle.srt`;
  const assKey = `${outputPrefix}/subtitle.ass`;
  const transcriptKey = `${outputPrefix}/transcript.json`;

  await Promise.all([
    putTextObject(env, srtKey, artifacts.srt, "application/x-subrip; charset=utf-8"),
    putTextObject(env, assKey, artifacts.ass, "text/plain; charset=utf-8"),
    putTextObject(env, transcriptKey, JSON.stringify(artifacts.transcriptJson, null, 2), "application/json; charset=utf-8")
  ]);
  await markCompleted(env.DB, job.id, { srtKey, assKey, transcriptKey }, new Date());
}

async function runCleanup(env: Env): Promise<void> {
  const jobs = await listCleanupCandidates(env.DB);
  const now = new Date();

  for (const job of jobs) {
    const decision = getCleanupDecision(job, now);
    if (decision.deleteUpload) await deleteObjects(env, [job.uploadKey]);
    if (decision.deleteOutputs) await deleteObjects(env, [job.srtKey, job.assKey, job.transcriptKey]);
    if (decision.markDeleted) await markDeleted(env.DB, job.id);
  }
}

function validateUploadRequest(body: UploadPresignRequest): void {
  if (!body.fileName?.trim()) throw new Error("fileName is required");
  if (!Number.isFinite(body.fileSize) || body.fileSize <= 0) throw new Error("fileSize is invalid");
  if (body.fileSize > MAX_FILE_SIZE_BYTES) throw new Error("File exceeds 2GB limit");
  if (!/^(video|audio)\//.test(body.contentType)) throw new Error("Only audio/video files are supported");
}

function parseVideoDimensions(body: CreateJobRequest): { videoWidth: number | null; videoHeight: number | null } {
  const videoWidth = parseVideoDimension(body.videoWidth, "videoWidth");
  const videoHeight = parseVideoDimension(body.videoHeight, "videoHeight");

  if ((videoWidth === null) !== (videoHeight === null)) {
    throw new Error("videoWidth and videoHeight must be provided together");
  }

  return { videoWidth, videoHeight };
}

function parseVideoDimension(value: number | null | undefined, fieldName: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0 || value > 16384) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}

function parseSubtitlePrompt(value: string | undefined): string | null {
  const prompt = value?.trim();
  if (!prompt) return null;
  if (prompt.length > 4000) throw new Error("subtitlePrompt must be 4000 characters or fewer");
  return prompt;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "_").slice(0, 160);
}

function downloadName(originalName: string, format: string): string {
  const base = originalName.replace(/\.[^.]+$/g, "").replace(/[\\/:*?"<>|]/g, "_");
  return format === "json" ? `${base}.transcript.json` : `${base}.subtitle.${format}`;
}

function json(data: unknown, status = 200, extraHeaders?: Headers): Response {
  const headers = extraHeaders ?? new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return cors(new Response(JSON.stringify(data), { status, headers }));
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
