import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SUBTITLE_POLISH_INSTRUCTION } from "../shared/subtitle-prompt";
import type { JobDto } from "../shared/types";
import { createJob, deleteJob, getMe, listJobs, login, logout, presignUpload, uploadToR2 } from "./api";
import "./styles.css";

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [subtitlePromptMode, setSubtitlePromptMode] = useState<"default" | "custom">("default");
  const [subtitlePrompt, setSubtitlePrompt] = useState(DEFAULT_SUBTITLE_POLISH_INSTRUCTION);
  const [enableSpeakerDiarization, setEnableSpeakerDiarization] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe().then(setAuthenticated);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refreshJobs();
    const timer = window.setInterval(() => void refreshJobs(), 8000);
    return () => window.clearInterval(timer);
  }, [authenticated]);

  const selectedFileState = useMemo(() => validateFile(file), [file]);

  async function refreshJobs() {
    setJobs(await listJobs());
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(password);
      setAuthenticated(true);
      setPassword("");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || selectedFileState) return;

    setBusy(true);
    setError(null);
    setUploadProgress(0);
    try {
      const dimensions = await readVideoDimensions(file);
      const presigned = await presignUpload(file);
      await uploadToR2(presigned.uploadUrl, file, setUploadProgress);
      await createJob(presigned.jobId, {
        enableSpeakerDiarization,
        contextText: "",
        videoWidth: dimensions.videoWidth,
        videoHeight: dimensions.videoHeight,
        subtitlePrompt: subtitlePromptMode === "custom" ? subtitlePrompt : null
      });
      setFile(null);
      setUploadProgress(null);
      await refreshJobs();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    setAuthenticated(false);
  }

  if (authenticated === null) {
    return <main className="shell">加载中</main>;
  }

  if (!authenticated) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={handleLogin}>
          <h1>OperonAI Captions</h1>
          <label>
            管理密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoFocus />
          </label>
          <button type="submit">进入</button>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>字幕工厂</h1>
          <p>Soniox 转写，Cloudflare 托管，本地 ffmpeg 合并。</p>
        </div>
        <button className="ghost" type="button" onClick={handleLogout}>
          退出
        </button>
      </header>

      <section className="workspace">
        <form className="upload-panel" onSubmit={handleUpload}>
          <label className="drop-zone">
            <input
              type="file"
              accept="video/*,audio/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span>{file ? file.name : "选择或拖入视频/音频文件"}</span>
            <small>v1 单文件上限 2GB，原视频仅短期保留用于转写。</small>
          </label>

          {selectedFileState && <p className="error">{selectedFileState}</p>}

          <fieldset className="prompt-panel">
            <legend>字幕润色提示词</legend>
            <label className="radio">
              <input
                type="radio"
                name="subtitlePromptMode"
                checked={subtitlePromptMode === "default"}
                onChange={() => setSubtitlePromptMode("default")}
              />
              使用默认飞书妙记风格
            </label>
            <label className="radio">
              <input
                type="radio"
                name="subtitlePromptMode"
                checked={subtitlePromptMode === "custom"}
                onChange={() => setSubtitlePromptMode("custom")}
              />
              自定义提示词
            </label>
            <textarea
              value={subtitlePrompt}
              onChange={(event) => setSubtitlePrompt(event.target.value)}
              disabled={subtitlePromptMode === "default"}
              placeholder={DEFAULT_SUBTITLE_POLISH_INSTRUCTION}
            />
            <small>API Key 仍保存在 Cloudflare Secret；这里只调整字幕润色风格。</small>
          </fieldset>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={enableSpeakerDiarization}
              onChange={(event) => setEnableSpeakerDiarization(event.target.checked)}
            />
            多人对话/访谈：启用说话人识别
          </label>

          {uploadProgress !== null && (
            <div className="progress">
              <div style={{ width: `${uploadProgress}%` }} />
            </div>
          )}

          <button type="submit" disabled={busy || !file || Boolean(selectedFileState)}>
            {busy ? "处理中" : "上传并生成字幕"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>

        <section className="jobs-panel">
          <div className="panel-head">
            <h2>任务</h2>
            <button className="ghost" type="button" onClick={() => void refreshJobs()}>
              刷新
            </button>
          </div>
          <div className="job-list">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} onDelete={async () => {
                await deleteJob(job.id);
                await refreshJobs();
              }} />
            ))}
            {jobs.length === 0 && <p className="empty">还没有任务。</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

function JobCard({ job, onDelete }: { job: JobDto; onDelete: () => Promise<void> }) {
  const baseName = job.originalName.replace(/\.[^.]+$/g, "");
  const srtCommand = `ffmpeg -i "${job.originalName}" -i "${baseName}.subtitle.srt" -c copy -c:s mov_text "${baseName}.softsub.mp4"`;
  const assCommand = `ffmpeg -i "${job.originalName}" -vf "subtitles=${baseName}.subtitle.ass" -c:a copy "${baseName}.burned.mp4"`;

  return (
    <article className="job-card">
      <div className="job-main">
        <strong>{job.originalName}</strong>
        <span>{formatBytes(job.sizeBytes)} · {statusText(job.status)}</span>
        {job.errorMessage && <p className="error">{job.errorMessage}</p>}
      </div>

      {job.status === "completed" && (
        <>
          <div className="download-row">
            <a href={`/api/jobs/${job.id}/download?format=srt`}>SRT</a>
            <a href={`/api/jobs/${job.id}/download?format=ass`}>ASS</a>
            <a href={`/api/jobs/${job.id}/download?format=json`}>JSON</a>
          </div>
          <pre>{srtCommand}</pre>
          <pre>{assCommand}</pre>
        </>
      )}

      <button className="danger" type="button" onClick={() => void onDelete()}>
        删除
      </button>
    </article>
  );
}

function validateFile(file: File | null): string | null {
  if (!file) return null;
  if (file.size > MAX_FILE_SIZE_BYTES) return "文件超过 2GB，v1 暂不支持。";
  if (!/^(video|audio)\//.test(file.type || "video/mp4")) return "只支持视频或音频文件。";
  return null;
}

async function readVideoDimensions(file: File): Promise<{ videoWidth: number | null; videoHeight: number | null }> {
  if (!file.type.startsWith("video/")) return { videoWidth: null, videoHeight: null };

  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const dimensions = {
        videoWidth: Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? video.videoWidth : null,
        videoHeight: Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? video.videoHeight : null
      };
      cleanup();
      resolve(dimensions);
    };
    video.onerror = () => {
      cleanup();
      resolve({ videoWidth: null, videoHeight: null });
    };
    video.src = url;
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function statusText(status: JobDto["status"]): string {
  const map: Record<JobDto["status"], string> = {
    uploaded: "已上传",
    transcribing: "转写中",
    completed: "已完成",
    failed: "失败",
    deleted: "已删除"
  };
  return map[status];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

createRoot(document.getElementById("root")!).render(<App />);
