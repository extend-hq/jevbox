# Deployment

All configuration is contained in this repository. Nothing deploys automatically. CI verifies builds and templates; it has no AWS credentials or deployment jobs. Never target the existing PROD 1 environment.

## Portable container

Build an immutable image tag and push to a registry you control:

```sh
docker build -t YOUR_REGISTRY/jevbox:YOUR_COMMIT_SHA .
docker push YOUR_REGISTRY/jevbox:YOUR_COMMIT_SHA
```

Required runtime settings:

| Variable                | Purpose                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`            | Exact browser origin, normally HTTPS; no trailing slash                                                              |
| `DATABASE_URL`          | Application PostgreSQL database connection URI                                                                       |
| `SPICEDB_HTTP_URL`      | Private SpiceDB HTTP endpoint (automatically set by Helm)                                                            |
| `SPICEDB_PRESHARED_KEY` | Random service token shared with the SpiceDB server                                                                  |
| `SPICEDB_DATABASE_URL`  | Separate PostgreSQL database for the SpiceDB container; used by Helm                                                 |
| `DATA_DIR`              | Writable scratch directory; image default `/data`; no document data is stored here                                   |
| `ENCRYPTION_KEY`        | 32 random bytes encoded as 64 hexadecimal characters                                                                 |
| `BOOTSTRAP_TOKEN`       | Random token for creating the first private-deployment account                                                       |
| `ALLOW_SIGNUP`          | Default false in production; invitation-only after bootstrap                                                         |
| `PORT`, `HOST`          | Image defaults `4310`, `0.0.0.0`                                                                                     |
| `TRUST_PROXY_CIDRS`     | Optional comma-separated trusted ingress proxy CIDRs for per-client rate limits; empty means direct connections only |

Generate secrets with `openssl rand -hex 32`. Store them in your cloud secret manager or Kubernetes Secret, not Git or image build arguments. Provider keys are configured afterward through the application. The image runs as UID/GID 1000; its scratch directory must be writable by that user. PostgreSQL and SpiceDB are required; startup fails when either is unavailable.

## Any Kubernetes cluster

Prerequisites: PostgreSQL 17 or a compatible supported version, two dedicated databases with separate login roles, a TLS ingress controller, DNS, a TLS certificate, and a CNI enforcing NetworkPolicy. The chart starts the pinned SpiceDB container and runs its datastore migrations in an init container; it does not provision a managed PostgreSQL service. Use RDS, Cloud SQL, Azure Database for PostgreSQL, or your own PostgreSQL operator. Use a dedicated namespace and verify your Kubernetes context before every write.

Set `trustProxyCidrs` to the actual ingress proxy source ranges and ensure the controller replaces incoming forwarding headers. Never use `0.0.0.0/0` or `::/0`. Without this configuration, clients behind the same proxy share rate limits. Keep direct app access restricted by NetworkPolicy.

1. Copy `infra/k8s/values/portable.yaml` to an untracked values file. Set image repository/tag, HTTPS origin, ingress host/class/TLS secret, and the controller's namespace. Set `postgres.allowedCidrs` to the private PostgreSQL endpoint subnet ranges and `postgres.port` if different from 5432. The chart rejects missing database network ranges when NetworkPolicy is enabled. Ingress annotations are controller-specific; adjust upload size and request timeout for your controller.
2. Create the namespace and an existing secret named `jevbox-secrets` containing `ENCRYPTION_KEY`, `BOOTSTRAP_TOKEN`, `DATABASE_URL`, `SPICEDB_DATABASE_URL`, and `SPICEDB_PRESHARED_KEY`. The two database URLs must use different databases/roles. Require verified TLS (`sslmode=verify-full`) and configure the PostgreSQL server certificate chain for your platform. For a private or cloud database CA, create a separate Secret containing `ca.crt`, set `postgres.caSecret` to its name, and append `sslrootcert=/etc/postgres-ca/ca.crt` to both database URLs. The chart mounts this certificate for the app, SpiceDB, and its migration container. Never reuse the Compose development passwords. Use your secret manager integration or a mode-0600 temporary env file with `kubectl create secret generic ... --from-env-file=...`; do not paste secrets into shell history. Create/import the TLS secret separately.
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

5. Open the HTTPS origin, create the first organization using **Deployment setup token**, configure connections, then invite other members. Verify upload → index → search → cited chat with your provider credentials. Test a restricted document from a second account before onboarding users.

The chart uses one app replica and one SpiceDB replica with `Recreate`; upgrades can have a short outage. Document data and permissions persist in PostgreSQL, so app and SpiceDB containers have no durable local volume. Keep one app replica until job scheduling, distributed rate limits, and snapshot rebuild throughput have been addressed. A permission mutation currently rebuilds its organization’s graph and database writes serialize under an advisory lock. This prioritizes atomic permission changes over large-organization write throughput.

Health probes are `/health/live` and `/health/ready`. Readiness queries PostgreSQL and SpiceDB. SpiceDB uses a gRPC readiness probe; its HTTP API is accessible only to the app through a private Service. The application installs the permission schema at startup, so use a dedicated SpiceDB datastore for this deployment.

For an existing installation, create a fresh PostgreSQL-backed deployment. This revision intentionally does not import SQLite. Keep any old volume until its data has been deliberately discarded or exported; this chart no longer creates an application PVC.

## Isolated AWS account and region

The Terraform package provisions a new VPC, private worker subnets, NAT, EKS, one managed node, EBS CSI, and an immutable ECR repository. Managed PostgreSQL is a separate prerequisite; this Terraform package does not create it. This creates ongoing AWS costs when applied. It does not reuse production networking, database, clusters, state, or identities.

Before initialization, choose a new/dedicated account and region. Obtain the actual PROD 1 account ID and add it to `blocked_account_ids`. There is deliberately no guessed or default account. The provider uses `allowed_account_ids`; Terraform preconditions reject protected targets. The backend has its own account allowlist. Helm also rejects release/namespace names containing PROD 1, but account IDs are the authoritative protection.

1. Create a versioned, encrypted private S3 state bucket in the new account through your approved account bootstrap process. Limit access to deployment operators. Do not use an existing production state bucket.
2. Copy `backend.hcl.example` to ignored `backend.hcl` and `terraform.tfvars.example` to ignored `terraform.tfvars`; replace every placeholder. Select an EKS minor supported in your chosen region. Restrict API CIDRs to your operator IPs and choose an explicit IAM operator role.
3. Set `AWS_PROFILE`, `AWS_REGION`, `TARGET_ACCOUNT_ID`, and comma-separated `BLOCKED_ACCOUNT_IDS`. Run the read-only guard:

```sh
./scripts/aws-preflight.sh
```

4. Initialize and create a reviewable plan. These steps contact AWS; none were run as part of implementation:

```sh
terraform -chdir=infra/terraform/aws init -backend-config=backend.hcl
terraform -chdir=infra/terraform/aws plan -out=isolated.tfplan
```

5. Review account, region, resources, and costs. Only a human-approved deployment should run `terraform apply isolated.tfplan` from that directory.
6. Configure a **new named kubeconfig context** for the returned cluster using the explicit profile/region. Check the context; do not overwrite or select a production context implicitly.
7. Install an ingress controller/TLS solution compatible with your platform. The portable values assume an NGINX-class controller; you may use another controller with corresponding annotations. Provision private PostgreSQL in that new account/region with dedicated application and SpiceDB databases; configure network access only from the new cluster. Build/push the image to the returned ECR repository, then use the portable Helm steps with your values plus `infra/k8s/values/aws.yaml`, with your database CIDRs supplied last.

An existing cluster on AWS, GCP, Azure, or another provider can use Helm directly and skip Terraform entirely.

## Backup and recovery

Persist the encryption key separately and keep it stable across deployments. Changing it without re-encrypting the database makes stored provider credentials unreadable.

Stop application writes while taking coordinated PostgreSQL backups of both the application and SpiceDB databases, using `pg_dump` or your database provider’s backup facilities. Preserve the external encryption key separately. Restore both databases into an isolated environment with the same key and start SpiceDB before the application. Verify login, original bytes, parsed output, permitted reads, forbidden reads, and revocation from a second account. Restoring only one database can leave graph versions missing or inconsistent; fail closed and restore a matching pair. Backups of previously authorized data require the same access restrictions as the live databases.

Backups, ingress/controller installation, DNS, certificates, cloud quotas, and real provider calls need environment-specific acceptance. Local validation does not establish that a deployment has been applied or accepted in AWS.

The application applies the numbered PostgreSQL migrations at startup, including the link-sharing table and access constraint. Authorization startup installs the matching SpiceDB schema before serving application requests.
