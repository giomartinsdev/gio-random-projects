import { Client } from "minio";

// Object storage for post images (covers + inline pictures pasted into
// the markdown) -- same shape as bookclub-api's own minioClient.ts,
// with two differences that matter here:
//
// 1. The bucket is PUBLIC-READ and pre-created by terraform
//    (static_sites.tf -- same null_resource that makes the frontends'
//    buckets, serving it at media.giomartins.dev through ingress's
//    by-path proxy into MinIO's S3 API). Readers download the image
//    straight from MinIO/ingress, NOT through this API -- an <img> on
//    a page of visitors should never take an auth round-trip through
//    post-api first.
// 2. Nothing here EVER reads objects back -- this service only ever
//    uploads. getBytes lives with bookclub-api, where PDFs are private
//    and streamed through its own authed route; here public-read makes
//    the separate content-type/size validation at upload time the only
//    gate an object ever passes.
export function createMediaClient(endpoint: string, accessKey: string, secretKey: string, bucket: string, baseUrl: string) {
  const [host, portStr] = endpoint.split(":");
  const client = new Client({
    endPoint: host,
    port: portStr ? Number(portStr) : 9000,
    useSSL: false,
    accessKey,
    secretKey,
  });

  // One-off against a known-good internal host: buckets are expected
  // to exist (terraform creates it), this is the self-healing fallback
  // for a wiped bucket, not a per-request check.
  async function ensureBucket() {
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (!exists) await client.makeBucket(bucket);
  }

  async function upload(objectKey: string, data: Buffer, contentType: string): Promise<string> {
    await client.putObject(bucket, objectKey, data, data.byteLength, { "Content-Type": contentType });
    // The URL the editor pastes into markdown. media.giomartins.dev is
    // in ingress's static_sites and Cloudflare Access's exclusions --
    // every reader's <img> tag hits it directly, no post-api hop.
    return `${baseUrl.replace(/\/$/, "")}/${objectKey}`;
  }

  return { ensureBucket, upload };
}

export type MediaClient = ReturnType<typeof createMediaClient>;

// The slice routes/images.ts actually depends on -- tests inject a
// fake instead of a real MinIO, and index.ts wires the real one only
// when MINIO_* is configured.
export type Uploader = { upload(objectKey: string, data: Buffer, contentType: string): Promise<string> };