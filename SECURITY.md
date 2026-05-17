# Security Policy

## Supported versions

Only the latest `main` branch is supported for security fixes.

## Reporting a vulnerability

Please do not open a public issue for secrets, credential exposure, or exploitable vulnerabilities.

Report privately through GitHub Security Advisories when available, or contact the repository owner through GitHub.

## Secret handling

Do not commit real values for:

- `SONIOX_API_KEY`
- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`
- `LLM_API_KEY`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `WEBHOOK_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- D1 `database_id`

Use `.dev.vars` locally and Cloudflare Worker secrets in production.
