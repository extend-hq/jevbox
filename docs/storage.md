# File storage

Production deployments use a private S3 bucket for original uploads and generated thumbnails. PostgreSQL retains metadata, parsed content, chats, job state, object keys, sizes, and SHA-256 hashes. Web and worker processes must use the same storage configuration and database. Uploads and downloads continue through the application server; the browser never receives AWS credentials or a public object URL. No bucket CORS configuration is needed.

## Render

Create a private general-purpose S3 bucket in the AWS region you choose. Keep all four Block Public Access settings enabled, use Bucket owner enforced object ownership, and keep default server-side encryption enabled. Choose a region close to the Render services. Do not enable public bucket policies or website hosting.

Give a dedicated IAM principal these permissions, replacing `YOUR_BUCKET`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/jevbox/*"
    }
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

Set the actual bucket region. Add these variables to the dashboard-managed **`jevbox-app`** environment group before creating or syncing the Blueprint. The web service and worker both link to this group through `fromGroup`; code pushes and Blueprint syncs preserve its dashboard values. Also populate the group's existing encryption key and SMTP settings as described in [Render deployment](deployment.md#render). Group edits trigger deploys of linked services with auto-deploys enabled, without another Blueprint sync.

For an existing deployment, copy the current shared values into the group, sync the updated Blueprint to link it, then remove the individual shared variables from **both** services. Render preserves individual values omitted from the Blueprint, and those values override the group. Keep the existing `ENCRYPTION_KEY` unchanged. Confirm both services deploy after removing duplicates. See [Render's environment group behavior](https://render.com/docs/configure-environment-variables#environment-groups).

A missing bucket, denied permissions, or unreachable storage makes `/health/ready` return 503; the web process still starts to expose its probes, and the worker checks bucket access before starting consumers.

### Troubleshooting bucket access

Look for `File storage request failed` in the service logs. Diagnostics include the S3 operation, AWS error code and HTTP status when available, configured bucket/region, the bucket region returned by AWS, and a request ID. Raw error messages, credentials, response bodies, and signed URLs are omitted. Client responses remain generic.

For `HeadBucket`, a 403 can mean invalid credentials or missing `s3:ListBucket` permission; a 404 can indicate an incorrect bucket name. This operation returns generic HTTP errors without a detailed body, so its status alone cannot identify every cause. Check the full bucket name, region, and attached IAM policy. For account Regional namespace buckets, use the complete name including the account/region suffix in both `S3_BUCKET` and IAM resources. Compare `bucketRegion` with `AWS_REGION` when AWS supplies it. See [AWS HeadBucket behavior](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html).

Verify `jevbox-app` is linked to both services and that neither service has individual storage variables overriding it. Populate and link the group before removing old variables. Confirm both services have deployed with the updated group. Keep Block Public Access enabled; authenticated IAM access does not need a public bucket.

The default object prefix is `jevbox`. If setting `S3_PREFIX`, update the IAM object resource accordingly. Distinct installations sharing a bucket should have distinct prefixes and scoped IAM policies. Put optional `S3_PREFIX`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, and `AWS_SESSION_TOKEN` in `jevbox-app` when needed so both Render services receive the same settings.

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
