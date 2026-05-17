import { AwsClient } from "aws4fetch";
import type { Env } from "./types";

const R2_REGION = "auto";
const UPLOAD_URL_TTL_SECONDS = 60 * 30;
const READ_URL_TTL_SECONDS = 60 * 60 * 2;

export async function createUploadUrl(env: Env, key: string): Promise<string> {
  return signR2Url(env, key, "PUT", UPLOAD_URL_TTL_SECONDS);
}

export async function createReadUrl(env: Env, key: string): Promise<string> {
  return signR2Url(env, key, "GET", READ_URL_TTL_SECONDS);
}

async function signR2Url(env: Env, key: string, method: "GET" | "PUT", expiresSeconds: number): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: R2_REGION
  });
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodeR2Key(key)}`
  );
  url.searchParams.set("X-Amz-Expires", expiresSeconds.toString());

  const signed = await client.sign(url.toString(), {
    method,
    aws: { signQuery: true, service: "s3", region: R2_REGION }
  });
  return signed.url;
}

export async function putTextObject(env: Env, key: string, text: string, contentType: string): Promise<void> {
  await env.FILES.put(key, text, {
    httpMetadata: { contentType }
  });
}

export async function getTextObject(env: Env, key: string): Promise<{ body: ReadableStream; contentType: string } | null> {
  const object = await env.FILES.get(key);
  if (!object?.body) return null;
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream"
  };
}

export async function deleteObjects(env: Env, keys: Array<string | null>): Promise<void> {
  const cleanKeys = keys.filter((key): key is string => Boolean(key));
  if (cleanKeys.length === 0) return;
  await env.FILES.delete(cleanKeys);
}

function encodeR2Key(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
