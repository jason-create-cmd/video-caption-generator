# Video Caption Generator

开源视频字幕生成工具：Cloudflare 负责上传入口、任务状态、Soniox 异步转写、LLM 字幕润色和字幕文件生成；本地 `ffmpeg` 负责字幕合并或烧录。

---

## 1. 架构

- Pages：单页前端，示例入口 `https://caption.example.com`
- Worker：`/api/*`，负责登录、上传签名、任务状态、Soniox webhook、字幕生成和清理
- R2：`video-caption-files`，保存原视频、字幕和 transcript
- D1：`video-caption-db`，保存 job 元数据、视频宽高和单次字幕提示词
- Soniox：Async Transcription，默认 model `stt-async-v4`
- LLM：字幕文本润色，默认 DeepSeek，Gemini 作为备用；缺 key 或失败时自动回退原始字幕

## 2. 字幕生成流程

```text
视频上传
→ R2 signed URL 浏览器直传
→ Worker 创建 D1 job
→ Soniox Async Transcription
→ Soniox webhook 回调
→ 初步字幕分段
→ LLM 文本润色
→ 本地结构校验和兜底
→ 生成 SRT / ASS / transcript.json
```

关键边界：

- LLM 只处理字幕文本，不处理时间码。
- LLM 输出必须引用原始 `sourceSegmentIds`，最终时间轴由 Worker 映射回原始 segment。
- LLM 可合并相邻残缺短句，但不能创造无来源句子。
- JSON 解析失败、source id 非法、空文本、超时或 API 失败时，任务仍完成，自动使用未润色字幕。
- 旧任务不会自动重算；部署后只影响新任务。

## 3. 字幕润色能力

默认提示词目标是接近飞书妙记风格：短、准、自然、便于一眼读完。

当前默认逻辑：

- 删除无意义口语词：呃、额、嗯、啊、唔等。
- 压缩重复表达：这个这个、然后然后等。
- 修复明显 ASR 断裂：`D em o` → `Demo`，`A P I` → `API`，`5,0 0 0` → `5000`。
- 数字按场景处理：金额、日期、百分比、编号、精确统计用阿拉伯数字；普通口语和小数量优先保留中文数字。
- 每条字幕开头和末尾不保留标点；中间必要标点可保留，但尽量克制。
- 每条字幕优先单行显示，控制在 8 到 18 个中文字符，硬上限约 20 个中文字符。
- 不拆断产品名、业务名、模块名、人名、金额和编号。

前端支持两种模式：

- 使用默认提示词。
- 为单次任务填写自定义提示词。

自定义提示词只作为该 job 的运行配置写入 D1 `subtitle_prompt` 字段；API key 仍只保存在 Cloudflare Worker Secrets，不会暴露到前端。

## 4. ASS 样式

ASS 生成会写入真实视频分辨率：

- `PlayResX`
- `PlayResY`

当前默认样式：

- 字体：`PingFang SC`
- 1080p 字号：约 `44`
- 底部居中：`Alignment=2`
- 底部距离：`MarginV = videoHeight * 4.5%`
- 背景：半透明黑色底框，避免巨大描边
- 布局：单行优先，不主动合成两行大段字幕

这样可以避免 `ffmpeg/libass` 因缺少 `PlayResX/PlayResY` fallback 到 `384x288`，导致字幕被异常放大。

## 5. 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run worker:dev
npm run dev
```

前端本地地址：`http://127.0.0.1:5173`

Worker 本地地址：`http://127.0.0.1:8787`

## 6. Cloudflare 资源

```bash
npx wrangler r2 bucket create video-caption-files
npx wrangler d1 create video-caption-db
```

把 D1 输出的 `database_id` 写入 `wrangler.toml`。

R2 需要配置 CORS，允许 `caption.example.com` 对 bucket 执行浏览器直传：

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://caption.example.com", "http://127.0.0.1:5173"],
        "methods": ["PUT", "GET"],
        "headers": ["*"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

项目已提供 `cloudflare.r2.cors.json` 和 `cloudflare.r2.lifecycle.json`：

```bash
npx wrangler r2 bucket cors set video-caption-files --file cloudflare.r2.cors.json
npx wrangler r2 bucket lifecycle set video-caption-files --file cloudflare.r2.lifecycle.json
```

## 7. Secrets

```bash
npx wrangler secret put SONIOX_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put LLM_PROVIDER
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_MODEL
npx wrangler secret put LLM_BASE_URL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

变量说明：

- `SONIOX_API_KEY`：Soniox API key。
- `DEEPSEEK_API_KEY`：DeepSeek key；默认主 provider。
- `GEMINI_API_KEY`：Gemini key；默认备用 provider。
- `LLM_PROVIDER`：`deepseek`、`gemini` 或 `off`；不填时默认 `deepseek` → `gemini` fallback。
- `LLM_API_KEY`：通用模型 API key；provider-specific key 优先级更高。
- `LLM_MODEL`：可选；DeepSeek 默认 `deepseek-chat`，Gemini 默认 `gemini-2.5-flash`。
- `LLM_BASE_URL`：可选；DeepSeek / OpenAI-compatible provider 需要自定义 endpoint 时使用。
- `ADMIN_PASSWORD`：私人工具登录密码。
- `SESSION_SECRET`：登录 cookie 签名密钥。
- `WEBHOOK_SECRET`：Soniox webhook 鉴权密钥。
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`：用于生成浏览器直传签名 URL。

> ⚠️ **重要**
>
> 不要把任何 secret 明文写进仓库、README、Obsidian、issue 或截图。只能记录变量名、用途和保存位置。

手动创建 R2 S3 API token 的 Dashboard 操作步骤见：`docs/r2-api-token.md`。

也可以用脚本一次性写入基础 secret：

```powershell
.\scripts\set-secrets.ps1 `
  -SonioxApiKey "your-soniox-api-key" `
  -AdminPassword "your-private-password" `
  -R2AccessKeyId "xxx" `
  -R2SecretAccessKey "xxx"
```

## 8. 部署

```bash
npm test
npm run build
npm run db:migrate:remote
npm run deploy:worker
npm run deploy:pages
```

部署后在 Cloudflare Dashboard 配置：

- Worker route：`caption.example.com/api/*`
- Pages custom domain：`caption.example.com`

线上 smoke test：

```bash
curl -sS -D - https://caption.example.com/api/me
```

未登录返回 `401 Unauthorized` 是正常结果，说明 `/api/*` 已进入 Worker。

## 9. 本地合并命令

软字幕：

```bash
ffmpeg -i input.mp4 -i subtitle.srt -c copy -c:s mov_text output.mp4
```

硬字幕：

```bash
ffmpeg -i input.mp4 -vf "subtitles=subtitle.ass" -c:a copy output.mp4
```

前端会在上传前读取视频宽高，并传给 Worker 写入 D1。ASS 生成阶段使用真实 `PlayResX/PlayResY`，避免 `ffmpeg/libass` 按 `384x288` fallback 放大字幕。

## 10. 保留策略

- 原视频：完成后 24 小时删除。
- 失败或卡住任务：创建后 72 小时删除。
- 字幕和 transcript：默认 30 天删除。
- Worker Cron 每天清理一次；R2 建议对 `uploads/` 配 3 天 lifecycle 作为兜底。
