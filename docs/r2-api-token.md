# Cloudflare R2 API Token 获取步骤

本文档用于手动创建 `video-caption-files` 的 R2 S3 API 凭证，并把拿到的值交给部署流程使用。

需要拿到的两个值：

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

---

## 1. 前置确认

1. Cloudflare 账号中已经存在 R2 bucket：`video-caption-files`。

2. 当前项目的非敏感 R2 配置已经在 `wrangler.toml` 中声明：

   - `R2_ACCOUNT_ID`
   - `R2_BUCKET_NAME = "video-caption-files"`
   - Worker R2 binding：`FILES`

3. 这两个 R2 S3 API 凭证是敏感信息，只能放在以下位置：

   - 本地开发：`.dev.vars`
   - 线上部署：Cloudflare Worker secrets

不要把真实值写入 README、docs、截图、Git commit、issue 或聊天记录中的公开区域。

## 2. 创建 R2 API Token

1. 打开 Cloudflare Dashboard：

   <https://dash.cloudflare.com/>

2. 进入当前项目所属的 Cloudflare account。

3. 在左侧导航进入：

   `R2` -> `Manage R2 API Tokens`

4. 点击：

   `Create API token`

5. 填写 token 名称，建议使用：

   `video-caption-files-upload`

6. 在权限配置中选择：

   `Object Read & Write`

7. 在 bucket 范围中选择只授权指定 bucket：

   `video-caption-files`

   不建议选择 All buckets。这个 token 只需要给当前字幕工具生成浏览器直传签名 URL，没有必要扩大权限。

8. 如果页面提供过期时间设置：

   - 私人工具可先选择不过期或较长周期。
   - 若后续要做严格安全策略，再改成定期轮换。

9. 点击创建 token。

10. 创建完成后，Cloudflare 会显示两项凭证：

    - `Access Key ID`
    - `Secret Access Key`

    其中 `Secret Access Key` 通常只显示一次。创建后立即复制保存到本地安全位置。

## 3. 提供给部署流程

把拿到的两个值按下面格式提供：

```env
R2_ACCESS_KEY_ID=粘贴 Access Key ID
R2_SECRET_ACCESS_KEY=粘贴 Secret Access Key
```

注意：

- 不要加引号。
- 不要在值前后保留空格。
- 不要把 `Access Key ID` 和 `Secret Access Key` 填反。
- 如果复制时带入换行，先删除换行。

## 4. 本地开发写入方式

如果要先在本地测试 Worker：

1. 复制本地环境变量模板：

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   ```

2. 打开 `.dev.vars`，填入真实值：

   ```env
   R2_ACCESS_KEY_ID=真实 Access Key ID
   R2_SECRET_ACCESS_KEY=真实 Secret Access Key
   ```

3. `.dev.vars` 已在 `.gitignore` 中，不应提交到仓库。

## 5. 线上部署写入方式

线上 Worker 使用 Cloudflare secrets，不读取 `.dev.vars`。

拿到凭证后可以逐个写入：

```powershell
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

也可以使用项目脚本一次性写入部署所需 secrets：

```powershell
.\scripts\set-secrets.ps1 `
  -SonioxApiKey "soniox_xxx" `
  -AdminPassword "your-private-password" `
  -R2AccessKeyId "粘贴 Access Key ID" `
  -R2SecretAccessKey "粘贴 Secret Access Key"
```

脚本会同时生成并写入：

- `SESSION_SECRET`
- `WEBHOOK_SECRET`

## 6. 完成后验证

1. 确认 Worker secrets 已写入：

   ```powershell
   npx wrangler secret list
   ```

2. 部署 Worker：

   ```powershell
   npm run deploy:worker
   ```

3. 部署后通过上传一个小文件验证：

   - 前端能成功请求上传 URL。
   - 浏览器能把文件写入 `video-caption-files`。
   - R2 bucket 中能看到对应对象。

4. 如果上传签名失败，优先检查：

   - `R2_ACCESS_KEY_ID` 是否填反。
   - `R2_SECRET_ACCESS_KEY` 是否复制完整。
   - token 是否只给了 Object Read 权限，缺少 Write 权限。
   - token 是否授权到了错误 bucket。
   - `wrangler.toml` 中的 `R2_ACCOUNT_ID` 是否属于同一个 Cloudflare account。
