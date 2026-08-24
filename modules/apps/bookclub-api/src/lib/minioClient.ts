import { Client } from "minio";

// Object storage for uploaded PDFs -- replaces the old bytea-in-
// Postgres column (see db/schema.ts's own comment on why). Bytes
// never leave this service's own network hop to a browser directly:
// there's no presigned-URL flow, no public bucket. routes/rooms.ts's
// GET /rooms/:id/pdf still does its own auth check first, then
// streams straight from here -- same access-control shape as before,
// just a different place the bytes physically live.
export function createMinioClient(endpoint: string, accessKey: string, secretKey: string, bucket: string) {
  const [host, portStr] = endpoint.split(":");
  const client = new Client({
    endPoint: host,
    port: portStr ? Number(portStr) : 9000,
    useSSL: false,
    accessKey,
    secretKey,
  });

  async function ensureBucket() {
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (!exists) await client.makeBucket(bucket);
  }

  async function upload(objectKey: string, data: Buffer, contentType: string) {
    await client.putObject(bucket, objectKey, data, data.byteLength, { "Content-Type": contentType });
  }

  async function getBytes(objectKey: string): Promise<Buffer> {
    const stream = await client.getObject(bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async function remove(objectKey: string) {
    await client.removeObject(bucket, objectKey);
  }

  return { ensureBucket, upload, getBytes, remove };
}

export type MinioClient = ReturnType<typeof createMinioClient>;
