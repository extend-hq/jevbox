# File storage

Production deployments use a private S3 bucket for original uploads and generated thumbnails. PostgreSQL retains metadata, parsed content, chats, job state, object keys, sizes, and SHA-256 hashes. Web and worker processes must use the same storage configuration and database. Uploads and downloads continue through the application server; the browser never receives AWS credentials or a public object URL. No bucket CORS configuration is needed.

## Render

Create a private general-purpose S3 bucket in the AWS region you choose. Keep all four Block Public Access settings enabled, use Bucket owner enforced object ownership, and keep default server-side encryption enabled. Choose a region close to the Render services. Do not enable public bucket policies or website hosting.

Give a dedicated IAM principal these permissions, replacing `YOUR_BUCKET`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::YOUR_BUCKET" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::YOUR_BUCKET/jevbox/*" }
  ]
}
```

`ListBucket` is needed for the readiness check. A bucket using a customer-managed KMS key also requires the matching KMS permissions. The application does not create buckets or change bucket policies at runtime.

Set these environment variables on the web service and worker:

```dotenv
FILE_STORAGE=s3
S3_BUCKET=YOUR_BUCKET
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
```

Set the actual bucket region. The Blueprint prompts for the four bucket/AWS variables on the web service with `sync: false`, preserving dashboard values on subsequent syncs. The worker references those values from the web service. Push the code and manually sync the updated Blueprint to install this wiring; for an existing deployment, supply the variables before deploying the new image. When changing credentials later, update/redeploy both services or sync the worker references. A missing bucket, denied permissions, or unreachable storage makes `/health/ready` return 503; the worker checks bucket access before starting consumers.

The default object prefix is `jevbox`. If setting `S3_PREFIX`, use the same value on both processes and update the IAM object resource accordingly. Distinct installations sharing a bucket should have distinct prefixes and scoped IAM policies. Configure optional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, and `AWS_SESSION_TOKEN` on both Render services when needed; these optional settings are not managed by the AWS-specific Blueprint.

## Kubernetes

The Helm chart defaults to S3 storage. Configure the bucket and region in your values file:

```yaml
storage:
  bucket: YOUR_BUCKET
  region: us-east-1
```

For static credentials, put `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the existing application Secret. `AWS_SESSION_TOKEN` is optional for temporary credentials. Set `storage.credentialsSecret` to use a separate existing Secret. The chart references these keys optionally so an IAM role can supply credentials instead. Store credentials in Secrets or your secret-manager integration, never in committed Helm values.

On EKS, use IAM Roles for Service Accounts. The AWS Terraform package creates a private encrypted versioned bucket and a role scoped to `jevbox/*`, trusted only by `app_namespace` and `app_service_account`. Their defaults are `jevbox-sandbox` and `jevbox-storage`. Apply Terraform through the normal reviewed deployment process and use its outputs:

```yaml
serviceAccount:
  name: jevbox-storage
  annotations:
    eks.amazonaws.com/role-arn: YOUR_STORAGE_ROLE_ARN
storage:
  bucket: YOUR_STORAGE_BUCKET_OUTPUT
  region: YOUR_AWS_REGION
```

The Helm release namespace and service account name must match the Terraform trust policy. Web and worker pods use the same account; SpiceDB does not. Omit AWS static credential keys when using the role. The AWS SDK obtains and refreshes temporary credentials through its default credential provider chain. The chart enables regional STS endpoints. Public S3 and STS HTTPS traffic is already permitted by NetworkPolicy and requires working DNS and outbound connectivity. Private VPC endpoint ranges must be added to `storage.allowedCidrs`.

Other Kubernetes providers can use AWS S3 with static credentials, or their own S3-compatible storage. A private in-cluster service can be configured as follows; adjust its service DNS name, port, namespace, and pod labels to the actual installation:

```yaml
storage:
  bucket: YOUR_PRIVATE_BUCKET
  region: us-east-1
  endpoint: http://object-store.storage.svc.cluster.local:9000
  forcePathStyle: true
  port: 9000
  allowedPeers:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: storage
      podSelector:
        matchLabels:
          app: object-store
```

Use HTTPS when the service supports it; HTTP sends credentials and file data over the cluster network. The endpoint must be reachable from both Deployments. `storage.allowedPeers` permits namespace/pod selectors, while `storage.allowedCidrs` supports private external endpoints. `storage.port` must match the endpoint port. Storage provisioning, bucket policies, persistence, TLS, and backups belong to the object-store installation; this chart does not install an object store. No application PVC is needed.

## Existing files and migration

The database migration preserves existing `BYTEA` content. New writes use S3 when configured; old database files remain readable until migrated. Never roll back to an older application image after S3 writes have begun: older code cannot resolve S3 references.

After backing up the application database and checking bucket access, run this once using the same database, encryption key, SpiceDB, and storage environment as the deployment:

```sh
node --import tsx server/migrate-storage.ts
```

For local development, `pnpm storage:migrate` loads `.env`. On Render, run the Node command in the web service's Shell. In Kubernetes, execute it in the web pod or in a one-off Job with the same image, service account, environment, and network access.

The command copies small batches, downloads each copy, verifies its bytes and SHA-256, and only then commits its reference and clears the database bytes. Failed batches roll back, leaving originals intact. The command is safe to restart. It holds the application mutation lock while processing each batch, so run it during a maintenance window for larger libraries. PostgreSQL may retain freed space for reuse; clearing `BYTEA` does not automatically shrink its disk allocation.

Deletion removes application access immediately and detaches stored objects in the same database transaction. The scheduled cleanup consumer deletes detached objects and retries failures. It waits until each reservation is at least one hour old to protect in-progress uploads; older deleted objects are eligible on the next cleanup run. Reservations committed before S3 uploads let it also recover objects left by process crashes or rolled-back uploads. Keep the worker and permission-cleanup consumer running. Cleanup processes five objects per minute; a large deletion backlog drains over time. On versioned buckets, deletion creates a delete marker; retained versions remain part of the backup/retention policy until deliberately expired. Do not add blanket expiry rules for live objects.

## Local development and recovery

With no `S3_BUCKET` or `FILE_STORAGE`, local development continues storing bytes in PostgreSQL. Set `FILE_STORAGE=postgres` explicitly to force that backend; remove `S3_BUCKET` in this mode. Production Render and Helm configurations select `FILE_STORAGE=s3` and require a bucket and region. Both AWS and S3-compatible services use the same adapter.

Back up the object bucket together with both PostgreSQL databases and stable encryption/auth secrets. Keep objects or versions referenced by database backups for the required retention period. A database restore without the corresponding objects cannot restore original uploads or thumbnails. Restore into an isolated environment, then check downloads, thumbnails, indexing, shared-link revocation, and denied access before resuming writes. Preserve `storage_objects` records; the cleanup process uses them to distinguish live objects from detached ones.

For implementation behavior, see [AWS credential providers](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), [IRSA setup](https://docs.aws.amazon.com/eks/latest/eksctl/iamserviceaccounts.html), and [S3 access controls](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html).
