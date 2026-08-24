import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import { createMinioClient } from "../src/lib/minioClient.js";

// Real MinIO via testcontainers, same "real infra, not a mock"
// approach as testDb.ts's Postgres.
export async function startTestMinio() {
  const container: StartedMinioContainer = await new MinioContainer("minio/minio:latest").start();

  const bucket = "bookclub-pdfs-test";
  const minio = createMinioClient(`${container.getHost()}:${container.getPort()}`, container.getUsername(), container.getPassword(), bucket);
  await minio.ensureBucket();

  return {
    minio,
    stop: () => container.stop(),
  };
}
