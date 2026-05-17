import type { JobDto } from "../shared/types";

export type PresignResponse = {
  jobId: string;
  uploadKey: string;
  uploadUrl: string;
  maxFileSizeBytes: number;
};

export async function login(password: string): Promise<void> {
  await request("/api/session", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function logout(): Promise<void> {
  await request("/api/session", { method: "DELETE" });
}

export async function getMe(): Promise<boolean> {
  const response = await fetch("/api/me", { credentials: "include" });
  return response.ok;
}

export async function presignUpload(file: File): Promise<PresignResponse> {
  return request<PresignResponse>("/api/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || "video/mp4"
    })
  });
}

export async function uploadToR2(uploadUrl: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`R2 upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("R2 upload network error"));
    xhr.send(file);
  });
}

export async function createJob(
  jobId: string,
  options: {
    enableSpeakerDiarization: boolean;
    contextText: string;
    videoWidth: number | null;
    videoHeight: number | null;
    subtitlePrompt: string | null;
  }
) {
  return request<{ job: JobDto }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      jobId,
      videoWidth: options.videoWidth,
      videoHeight: options.videoHeight,
      enableSpeakerDiarization: options.enableSpeakerDiarization,
      contextText: options.contextText,
      subtitlePrompt: options.subtitlePrompt
    })
  });
}

export async function listJobs(): Promise<JobDto[]> {
  const result = await request<{ jobs: JobDto[] }>("/api/jobs");
  return result.jobs;
}

export async function deleteJob(jobId: string): Promise<void> {
  await request(`/api/jobs/${jobId}/delete`, { method: "POST" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}
