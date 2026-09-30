# Deployment

All configuration is contained in this repository. Nothing deploys automatically. CI verifies builds and templates; it has no AWS credentials or deployment jobs.

## Portable container

Build an immutable image tag and push to a registry you control:

```sh
docker build -t YOUR_REGISTRY/jevbox:YOUR_COMMIT_SHA .
docker push YOUR_REGISTRY/jevbox:YOUR_COMMIT_SHA
```

Required runtime settings:

| Variable                     | Purpose                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                 | Exact browser origin, normally HTTPS; no trailing slash                                                              |
| `DATABASE_URL`               | Application PostgreSQL database connection URI                                                                       |
| `SPICEDB_HTTP_URL`           | Private SpiceDB HTTP endpoint (automatically set by Helm)                                                            |
| `SPICEDB_PRESHARED_KEY`      | Random service token shared with the SpiceDB server                                                                  |
| `SPICEDB_DATABASE_URL`       | Separate PostgreSQL database for the SpiceDB container; used by Helm                                                 |
| `DATA_DIR`                   | Writable scratch directory; image default `/data`; no document data is stored here                                   |
| `ENCRYPTION_KEY`             | 32 random bytes encoded as 64 hexadecimal characters                                                                 |
| `BETTER_AUTH_SECRET`         | Stable random secret of at least 32 characters for Better Auth cookies and verification links                        |
| `SMTP_HOST`, `SMTP_PORT`     | SMTP relay hostname and port; normally 587 with STARTTLS or 465 with TLS                                             |
| `SMTP_SECURE`                | Set true for implicit TLS; production requires TLS for all SMTP connections                                          |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional relay credentials, stored in the deployment secret                                                          |
| `AUTH_EMAIL_FROM`            | Sender address authorized by the email provider                                                                      |
| `BOOTSTRAP_TOKEN`            | Random token for creating the first private-deployment account                                                       |
| `ALLOW_SIGNUP`               | Default false in production; invitation-only after bootstrap                                                         |
| `PORT`, `HOST`               | Image defaults `4310`, `0.0.0.0`                                                                                     |
| `TRUST_PROXY_CIDRS`          | Optional comma-separated trusted ingress proxy CIDRs for per-client rate limits; empty means direct connections only |

Generate secrets with `openssl rand -hex 32`. Store them in your cloud secret manager or Kubernetes Secret, not Git or image build arguments. Provider keys are configured afterward through the application. The image runs as UID/GID 1000; its scratch directory must be writable by that user. PostgreSQL and SpiceDB are required; startup fails when either is unavailable.

## Web and background services

Run two processes from the same image: `node --import tsx server/index.ts` for the public web service and `node --import tsx server/worker.ts` for the background service. Production web processes enqueue jobs without running consumers. Both processes need the same `DATABASE_URL`, `SPICEDB_*`, `ENCRYPTION_KEY`, `APP_ORIGIN`, and SMTP configuration. The worker needs no public port; disable the image's HTTP health check when running it with Docker (`--no-healthcheck`). Compose does this automatically.

On Render, use a Docker Web Service and a Docker Background Worker with the worker command above, sharing the application database and encryption key. Keep SpiceDB private. Start one of each, then scale the worker independently. Give workers at least 45 seconds to terminate: pg-boss drains for 30 seconds, then aborts unfinished attempts. The process has a 40-second shutdown cap.

The queue installation owns its `pgboss` schema and uses the pinned library's migrations. The database role must be able to create that schema and its tables, functions, and indexes. Use a direct or session-pooled connection for LISTEN/NOTIFY; transaction-pooled connections fall back to polling. Per-process pool ceilings are 12 application, 4 auth, 1 permission snapshot, and 5 pg-boss connections, with a dedicated notification session. Budget database connections across both web and worker replicas; auth connections are opened lazily and unused by background-only processes.

## Any Kubernetes cluster

Prerequisites: PostgreSQL 17 or a compatible supported version, two dedicated databases with separate login roles, a TLS ingress controller, DNS, a TLS certificate, and a CNI enforcing NetworkPolicy. The chart starts the pinned SpiceDB container and runs its datastore migrations in an init container; it does not provision a managed PostgreSQL service. Use RDS, Cloud SQL, Azure Database for PostgreSQL, or your own PostgreSQL operator. Use a dedicated namespace and verify your Kubernetes context before every write.

Set `authEmail.host`, `authEmail.port`, `authEmail.secure`, and `authEmail.from` for the SMTP relay. For a private relay, set `authEmail.allowedCidrs` to its private endpoint ranges. The sender must be verified with the email provider.

Set `trustProxyCidrs` to the actual ingress proxy source ranges and ensure the controller replaces incoming forwarding headers. Never use `0.0.0.0/0` or `::/0`. Without this configuration, clients behind the same proxy share rate limits. Keep direct app access restricted by NetworkPolicy.

1. Copy `infra/k8s/values/portable.yaml` to an untracked values file. Set image repository/tag, HTTPS origin, ingress host/class/TLS secret, and the controller's namespace. Set `postgres.allowedCidrs` to the private PostgreSQL endpoint subnet ranges and `postgres.port` if different from 5432. The chart rejects missing database network ranges when NetworkPolicy is enabled. Ingress annotations are controller-specific; adjust upload size and request timeout for your controller.
2. Create the namespace and an existing secret named `jevbox-secrets` containing `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `BOOTSTRAP_TOKEN`, `DATABASE_URL`, `SPICEDB_DATABASE_URL`, and `SPICEDB_PRESHARED_KEY`, plus `SMTP_USER` and `SMTP_PASSWORD` when the relay requires authentication. The two database URLs must use different databases/roles. Require verified TLS (`sslmode=verify-full`) and configure the PostgreSQL server certificate chain for your platform. For a private or cloud database CA, create a separate Secret containing `ca.crt`, set `postgres.caSecret` to its name, and append `sslrootcert=/etc/postgres-ca/ca.crt` to both database URLs. The chart mounts this certificate for the app, SpiceDB, and its migration container. Never reuse the Compose development passwords. Use your secret manager integration or a mode-0600 temporary env file with `kubectl create secret generic ... --from-env-file=...`; do not paste secrets into shell history. Create/import the TLS secret separately.
3. Preview and lint before applying:

```sh
helm lint infra/k8s/charts/jevbox -f YOUR_VALUES.yaml
helm template sandbox infra/k8s/charts/jevbox \
  --namespace jevbox-sandbox -f YOUR_VALUES.yaml
```

4. After checking the target context, deploy explicitly:

```sh
helm upgrade --install sandbox infra/k8s/charts/jevbox \
  --namespace jevbox-sandbox -f YOUR_VALUES.yaml --wait --timeout 10m
kubectl --namespace jevbox-sandbox rollout status deployment/sandbox-jevbox
```

5. Open the HTTPS origin, create the first organization using **Deployment setup token**, verify the account through its email link, sign in, and configure connections, then invite other members. Verify upload → index → search → cited chat with your provider credentials. Test a restricted document from a second account before onboarding users.

The chart uses one web replica and one SpiceDB replica with `Recreate`; upgrades can have a short outage. The worker uses a separate rolling Deployment; set `worker.replicas` to scale consumers. Document data and permissions persist in PostgreSQL, so app and SpiceDB containers have no durable local volume. Keep one web replica until distributed API rate limits and snapshot rebuild throughput have been addressed. A permission mutation currently rebuilds its organization’s graph and database writes serialize under an advisory lock. This prioritizes atomic permission changes over large-organization write throughput.

Health probes are `/health/live` and `/health/ready`. Web readiness queries PostgreSQL, the pg-boss queue installation, and SpiceDB. Worker startup logs readiness after registering all consumers. SpiceDB uses a gRPC readiness probe; its HTTP API is accessible only to the app through a private Service. The application installs the permission schema at startup, so use a dedicated SpiceDB datastore for this deployment.

For an existing installation, create a fresh PostgreSQL-backed deployment. This revision intentionally does not import SQLite. Keep any old volume until its data has been deliberately discarded or exported; this chart no longer creates an application PVC.

## AWS

The Terraform package provisions a VPC, private worker subnets, NAT, EKS, one managed node, EBS CSI, and an immutable ECR repository. Managed PostgreSQL is a separate prerequisite; this Terraform package does not create it. This creates ongoing AWS costs when applied.

Before initialization, choose the target AWS account and region. The provider uses `allowed_account_ids`, and Terraform checks that the current credentials match `target_account_id`. The backend has its own account allowlist.

1. Create a versioned, encrypted private S3 state bucket in the target account. Limit access to deployment operators.
2. Copy `backend.hcl.example` to ignored `backend.hcl` and `terraform.tfvars.example` to ignored `terraform.tfvars`; replace every placeholder. Select an EKS minor supported in your chosen region. Restrict API CIDRs to your operator IPs and choose an explicit IAM operator role.
3. Set `AWS_PROFILE`, `AWS_REGION`, and `TARGET_ACCOUNT_ID`. Run the account check:

```sh
./scripts/aws-preflight.sh
```

4. Initialize and create a reviewable plan:

```sh
terraform -chdir=infra/terraform/aws init -backend-config=backend.hcl
terraform -chdir=infra/terraform/aws plan -out=deployment.tfplan
```

5. Review account, region, resources, and costs, then deploy with `terraform apply deployment.tfplan` from that directory.
6. Configure a named kubeconfig context for the returned cluster using the explicit profile/region. Check the context before deploying.
7. Install an ingress controller/TLS solution compatible with your platform. The portable values assume an NGINX-class controller; you may use another controller with corresponding annotations. Provision private PostgreSQL in the target account/region with dedicated application and SpiceDB databases; configure network access only from the cluster. Build/push the image to the returned ECR repository, then use the portable Helm steps with your values plus `infra/k8s/values/aws.yaml`, with your database CIDRs supplied last.

An existing cluster on AWS, GCP, Azure, or another provider can use Helm directly and skip Terraform entirely.

## Backup and recovery

Persist the encryption key separately and keep it stable across deployments. Changing it without re-encrypting the database makes stored provider credentials unreadable.

Stop application writes while taking coordinated PostgreSQL backups of both the application and SpiceDB databases, using `pg_dump` or your database provider’s backup facilities. Preserve the external encryption key separately. Restore both databases into an isolated environment with the same key and start SpiceDB before the application. Verify login, original bytes, parsed output, permitted reads, forbidden reads, and revocation from a second account. Restoring only one database can leave graph versions missing or inconsistent; fail closed and restore a matching pair. Backups of previously authorized data require the same access restrictions as the live databases.

Backups, ingress/controller installation, DNS, certificates, cloud quotas, and real provider calls need environment-specific acceptance. Local validation does not establish that a deployment has been applied or accepted in AWS.

The application applies the numbered PostgreSQL migrations at startup, including the link-sharing table and access constraint. Authorization startup installs the matching SpiceDB schema before serving application requests.

The Better Auth migration preserves account IDs, credentials, memberships, and documents while invalidating old sessions. Existing users must verify mailbox ownership before signing in. Back up the application database and stable auth secret before upgrading. Confirm verification delivery and password reset in the deployed environment before onboarding users.
