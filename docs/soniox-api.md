# Soniox API 约定

## 创建异步转写

Worker 使用：

- endpoint：`POST https://api.soniox.com/v1/transcriptions`
- model：`stt-async-v4`
- input：R2 signed `audio_url`
- language hints：`zh`、`en`
- webhook：`https://caption.example.com/api/soniox/webhook`

请求字段：

```json
{
  "model": "stt-async-v4",
  "audio_url": "https://...signed-r2-url...",
  "language_hints": ["zh", "en"],
  "enable_language_identification": true,
  "enable_speaker_diarization": false,
  "webhook_url": "https://caption.example.com/api/soniox/webhook",
  "webhook_auth_header_name": "Authorization",
  "webhook_auth_header_value": "Bearer <WEBHOOK_SECRET>"
}
```

## Webhook

Webhook 只作为状态通知使用。收到 `completed` 后，Worker 再调用 transcript endpoint 拉 token 时间戳。

## Transcript

Worker 读取 `tokens[]` 的 `text`、`start_ms`、`end_ms` 字段，生成：

- `subtitle.srt`
- `subtitle.ass`
- `transcript.json`

## 视频尺寸与字幕润色

前端在 `createJob` 阶段提交视频元数据：

```json
{
  "jobId": "<uuid>",
  "videoWidth": 1920,
  "videoHeight": 1080,
  "enableSpeakerDiarization": false,
  "contextText": "预算管理\n智能财务",
  "subtitlePrompt": "可选：本次字幕润色提示词"
}
```

Worker 将 `video_width` / `video_height` 写入 D1，并在 Soniox 完成后传给字幕构建模块。ASS renderer 应使用真实 `PlayResX` / `PlayResY`，避免 libass 使用 `384x288` fallback。

LLM 字幕润色由核心字幕模块处理：

- `LLM_PROVIDER=deepseek | gemini | off`，不填时默认 DeepSeek
- DeepSeek 失败且配置了 Gemini key 时，会自动尝试 Gemini 备用
- `LLM_API_KEY` 为空时自动 fallback
- `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` 可选，优先级高于通用 `LLM_API_KEY`
- `LLM_MODEL` 不填时由 provider 默认值决定
- `LLM_BASE_URL` 仅 DeepSeek / OpenAI-compatible provider 需要；DeepSeek 官方默认可不填
- `subtitlePrompt` 为单次任务自定义提示词；为空时使用内置默认飞书妙记风格提示词

LLM 只处理字幕文本，不生成时间码；时间轴仍来自 Soniox token span。
