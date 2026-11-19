// Presigned URLs for the previews bucket on Cloudflare R2 (S3-compatible).
// The keys live only in the web app's server environment, scoped to this one bucket.
import { AwsClient } from "aws4fetch";

const PREVIEW_URL_SECONDS = 15 * 60;

function client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PREVIEWS_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PREVIEWS_BUCKET) {
    throw new Error("R2 is not configured");
  }
  return {
    aws: new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" }),
    base: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_PREVIEWS_BUCKET}`,
  };
}

export function previewKey(versionId: string) {
  return `previews/${versionId}.mp3`;
}

export async function presign(method: "GET" | "PUT", key: string): Promise<string> {
  const { aws, base } = client();
  const url = new URL(`${base}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(PREVIEW_URL_SECONDS));
  const signed = await aws.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}
