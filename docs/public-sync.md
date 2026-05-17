# Public 同步说明

本仓库是从私有生产仓库导出的开源版本。

同步原则：

- 私有仓库保存真实生产部署配置、真实域名、Cloudflare 资源 ID 和内部 runbook。
- Public 仓库只保存通用源码、通用文档、example 配置和 CI。
- 从私有仓库同步到 Public 仓库时，必须先运行脱敏导出脚本，不能直接 push 私有仓库历史。

私有仓库侧命令：

```bash
scripts/export-public.sh ../video-caption-generator
```

导出脚本会处理：

- `wrangler.toml` -> `wrangler.toml.example`
- 真实域名 -> `caption.example.com`
- 真实 Cloudflare Account ID / D1 database ID -> placeholder
- 生产 R2 bucket / D1 database 名称 -> 通用示例名称
- 生成 `LICENSE`、`SECURITY.md`、GitHub Actions CI 和 Dependabot 配置

Public 仓库提交前至少执行：

```bash
npm test
npm run build
rg "R2_ACCOUNT_ID = \"[a-f0-9]{32}\"|database_id = \"[0-9a-fA-F-]{36}\"|<add-your-private-domain-pattern>"
```
