# Buckets backing locals.tf's static_sites -- one per hostname, public
# read-only (this is a public website's own bundle, not user data;
# there's nothing in it that needs a signed URL). Runs as a one-off
# `mc` container on the shared docker network, the same idiom
# secrets.tf's null_resources use for "do a thing against a running
# container over the remote dockerd" -- no Terraform MinIO provider
# needed just for two buckets that never change shape.
#
# Deliberately idempotent (mc mb ignores "already exists", mc
# anonymous set is a plain overwrite either way) -- the trigger only
# re-runs this when the bucket list itself changes, but nothing breaks
# if it ran again on every apply too.
resource "null_resource" "static_site_buckets" {
  triggers = {
    buckets = join(",", [for s in local.static_sites : s.bucket])
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST         = var.docker_host
      NETWORK_NAME        = "apps"
      MINIO_ROOT_USER     = module.storage_minio.root_user
      MINIO_ROOT_PASSWORD = random_password.minio_root_password.result
      BUCKETS             = join(" ", [for s in local.static_sites : s.bucket])
    }
    command = <<-EOT
      docker run --rm --network "$NETWORK_NAME" \
        -e MC_HOST_local="http://$${MINIO_ROOT_USER}:$${MINIO_ROOT_PASSWORD}@minio:9000" \
        --entrypoint sh minio/mc -c '
          set -eu
          for b in '"$BUCKETS"'; do
            mc mb "local/$b" 2>/dev/null || true
            mc anonymous set download "local/$b"
          done
        '
    EOT
  }

  depends_on = [module.storage_minio]
}
