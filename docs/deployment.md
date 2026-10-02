# Deployment

All configuration is contained in this repository. Render deploys changes from `main` after CI passes, using per-service build filters. AWS and Kubernetes deployments remain explicit. CI verifies builds and templates; it has no AWS credentials or deployment jobs.

## Portable container

The runtime image includes only Chromium's headless shell and its Linux libraries, installed during the image build. Thumbnail workers serve their bundled renderer on an ephemeral loopback port; they need no public renderer endpoint or display server. Local development requires `pnpm exec playwright install --only-shell chromium` once. The default restricted containers use Playwright's default sandbox setting; set `THUMBNAIL_CHROMIUM_SANDBOX=true` only where the runtime supports Chromium's sandbox. Rendering contexts block external network access and never receive session tokens or provider credentials. Keep worker memory limits separate from the API; native image and text previews do not launch Chromium.

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

pg-boss drains for 30 seconds, then aborts unfinished attempts. The process has a 40-second shutdown cap. Give containers at least 45 seconds to shut down. See [Render's graceful shutdown settings](https://render.com/docs/deploys#graceful-shutdown).

The queue installation owns its `pgboss` schema and uses the pinned library's migrations. The database role must be able to create that schema and its tables, functions, and indexes. Use a direct or session-pooled connection for LISTEN/NOTIFY; transaction-pooled connections fall back to polling. Per-process pool ceilings are 6 application, 4 auth, 1 permission snapshot, and 3 pg-boss connections, with a dedicated notification session. Budget database connections across both web and worker replicas; auth connections are opened lazily and unused by background-only processes.

## Any Kubernetes cluster

Prerequisites: PostgreSQL 17 or a compatible supported version, two dedicated databases with separate login roles, a private S3 or S3-compatible bucket, a TLS ingress controller, DNS, a TLS certificate, and a CNI enforcing NetworkPolicy. The chart starts the pinned SpiceDB container and runs its datastore migrations in an init container; it does not provision a managed PostgreSQL service. Use RDS, Cloud SQL, Azure Database for PostgreSQL, or your own PostgreSQL operator. Use a dedicated namespace and verify your Kubernetes context before every write.

Configure `storage.bucket` and `storage.region`, then supply S3 credentials in the existing Secret or use an EKS IAM role. Private object-store endpoints also need the Helm storage network settings. See [file storage](storage.md) for full configuration and migration.

Set `authEmail.host`, `authEmail.port`, `authEmail.secure`, and `authEmail.from` for the SMTP relay. For a private relay, set `authEmail.allowedCidrs` to its private endpoint ranges. The sender must be verified with the email provider.

Set `trustProxyCidrs` to the actual ingress proxy source ranges and ensure the controller replaces incoming forwarding headers. Never use `0.0.0.0/0` or `::/0`. Without this configuration, clients behind the same proxy share rate limits. Keep direct app access restricted by NetworkPolicy.

1. Copy `infra/k8s/values/portable.yaml` to an untracked values file. Set image repository/tag, HTTPS origin, ingress host/class/TLS secret, and the controller's namespace. The portable settings use Traefik; configure its request/idle timeouts to at least 300 seconds and allow 32 MiB uploads. Use a maintained ingress controller. Set `postgres.allowedCidrs` to the private PostgreSQL endpoint subnet ranges and `postgres.port` if different from 5432. The chart rejects missing database and ingress network ranges when NetworkPolicy is enabled. Set `networkPolicy.ingressCidrs` instead of the namespace selector when a load balancer connects directly to pod IPs.
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
kubectl --namespace jevbox-sandbox rollout status deployment/sandbox-jevbox-worker
kubectl --namespace jevbox-sandbox logs deployment/sandbox-jevbox-worker --tail=50
```

5. Open the HTTPS origin, create the first organization using **Deployment setup token**, verify the account through its email link, sign in, and configure connections, then invite other members. Verify upload → index → search → cited chat with your provider credentials. Test a private document from a second account before onboarding users.

The chart uses one web replica and one SpiceDB replica with `Recreate`; upgrades can have a short outage. The worker uses a separate rolling Deployment; set `worker.replicas` to scale consumers. Document bytes persist in S3; metadata and permissions persist in PostgreSQL, so app and SpiceDB containers have no durable local volume. Keep one web replica until distributed API rate limits and snapshot rebuild throughput have been addressed. A permission mutation currently rebuilds its organization’s graph and database writes serialize under an advisory lock. This prioritizes atomic permission changes over large-organization write throughput.

Health probes are `/health/live` and `/health/ready`. Web readiness queries PostgreSQL, the pg-boss queue installation, SpiceDB, and the S3 bucket. Worker startup logs readiness after registering all consumers. SpiceDB uses a gRPC readiness probe; its HTTP API is accessible only to the app through a private Service. The application installs the permission schema at startup, so use a dedicated SpiceDB datastore for this deployment.

For an existing installation, create a fresh PostgreSQL-backed deployment. This revision intentionally does not import SQLite. Keep any old volume until its data has been deliberately discarded or exported; this chart no longer creates an application PVC.

## AWS

The Terraform package provisions a VPC, private node and database subnets, NAT, EKS, one managed node, EBS CSI, an immutable ECR repository, a private encrypted versioned S3 file bucket with an application IRSA role, a database security group, and an IAM role for the AWS Load Balancer Controller. VPC CNI NetworkPolicy enforcement is enabled in standard mode, allowing system add-ons to bootstrap before their policies are configured. Managed PostgreSQL remains a separate prerequisite; this package does not create an RDS instance. This creates ongoing AWS costs when applied.

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
6. Configure a named kubeconfig context for the returned cluster using the explicit profile/region and `operator_role_arn`. The creator has no automatic cluster admin access, so assume the configured operator role when running Kubernetes commands:

```sh
aws eks update-kubeconfig --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --name YOUR_CLUSTER --role-arn YOUR_OPERATOR_ROLE_ARN --alias jevbox-sandbox
kubectl config current-context
kubectl get nodes
kubectl --namespace kube-system get daemonset aws-node
```

7. Install the AWS Load Balancer Controller using the provisioned IAM role. Pass region and VPC explicitly because node metadata requires IMDSv2 with hop limit 1. The vendored IAM policy is from controller v2.14.1; keep the controller and policy versions in sync when upgrading. Review [AWS's installation procedure](https://docs.aws.amazon.com/eks/latest/userguide/lbc-helm.html).

```sh
helm repo add eks https://aws.github.io/eks-charts
helm repo update eks
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system --version 1.14.1 \
  --set clusterName=YOUR_CLUSTER --set region=YOUR_REGION --set vpcId=YOUR_VPC_ID \
  --set serviceAccount.create=true \
  --set 'serviceAccount.annotations.eks\.amazonaws\.com/role-arn=YOUR_CONTROLLER_ROLE_ARN' \
  --wait --timeout 10m
```

8. Provision private RDS PostgreSQL 17 in the returned `database_subnet_group`, attaching `database_security_group_id`. Set public accessibility to false, enable storage encryption and automated backups, and create separate application and SpiceDB databases with dedicated owner/login roles. Do not run the application as the RDS master user. An existing database must permit the node security group and supply its own private subnet CIDRs. Download the [AWS RDS CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem), mount it using `postgres.caSecret`, and require `sslmode=verify-full&sslrootcert=/etc/postgres-ca/ca.crt` on both URLs.
9. Request and validate an ACM certificate for the application's hostname in the same AWS region as the load balancer. Configure an SMTP relay with a verified sender and credentials. For SES, obtain production sending access or verify every recipient while in its sandbox; use port 587 or 465.
10. Build an image matching the x86-64 nodes and push an immutable tag. Building on an ARM laptop without the platform flag produces an image these nodes cannot run:

```sh
aws ecr get-login-password --profile "$AWS_PROFILE" --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin YOUR_ECR_REGISTRY
docker buildx build --platform linux/amd64 --push \
  -t YOUR_ECR_REPOSITORY:YOUR_COMMIT_SHA .
```

11. Create the namespace, database CA secret, and application secret as described above. Create an ignored AWS Helm values file with the repository/tag, origin, SMTP settings, and these values:

```yaml
appOrigin: https://YOUR_HOSTNAME
ingress:
  host: YOUR_HOSTNAME
  annotations:
    alb.ingress.kubernetes.io/certificate-arn: YOUR_ACM_CERTIFICATE_ARN
postgres:
  caSecret: jevbox-postgres-ca
  allowedCidrs: [YOUR_DATABASE_SUBNET_CIDR_1, YOUR_DATABASE_SUBNET_CIDR_2]
networkPolicy:
  ingressCidrs: [YOUR_PUBLIC_SUBNET_CIDR_1, YOUR_PUBLIC_SUBNET_CIDR_2]
trustProxyCidrs: YOUR_PUBLIC_SUBNET_CIDR_1,YOUR_PUBLIC_SUBNET_CIDR_2
serviceAccount:
  name: jevbox-storage
  annotations:
    eks.amazonaws.com/role-arn: YOUR_STORAGE_ROLE_ARN
storage:
  bucket: YOUR_STORAGE_BUCKET
  region: YOUR_AWS_REGION
authEmail:
  host: YOUR_SMTP_HOST
  from: YOUR_VERIFIED_SENDER
```

Read `storage_bucket` and `storage_role_arn` from Terraform outputs and match `app_namespace`/`app_service_account` to the Helm namespace/account. Do not add static AWS keys when using the role. Read the database ranges from `database_subnet_cidrs` and the ALB source ranges from `ingress_subnet_cidrs`. NetworkPolicy must allow these public-subnet private addresses, not the controller's namespace. The ALB appends the real client address to the forwarding chain; trust only its subnet ranges. The AWS values configure HTTP to HTTPS redirection, IP targets, readiness checks, and 300-second stream timeouts. The Service port matches the container port for VPC CNI policy compatibility. ACM terminates TLS at the ALB; no Kubernetes TLS secret is required.

```sh
helm lint infra/k8s/charts/jevbox \
  -f infra/k8s/values/aws.yaml -f YOUR_VALUES.yaml
helm template sandbox infra/k8s/charts/jevbox --namespace jevbox-sandbox \
  -f infra/k8s/values/aws.yaml -f YOUR_VALUES.yaml
helm upgrade --install sandbox infra/k8s/charts/jevbox --namespace jevbox-sandbox \
  -f infra/k8s/values/aws.yaml -f YOUR_VALUES.yaml --wait --timeout 10m
kubectl --namespace jevbox-sandbox get deployments,services,ingress,networkpolicies
```

12. Point DNS at the returned ALB hostname. Verify HTTPS redirect and `/health/ready`, worker readiness logs, verification email and password reset, then upload/index/search/chat and permission revocation. Test from two accounts. Confirm that unauthorized pods cannot reach SpiceDB or the application and that PostgreSQL is inaccessible publicly. A single node, NAT gateway, web replica, and SpiceDB replica make this a demo foundation; they do not provide availability-zone failover. A worker rollout may briefly overlap consumers; pg-boss coordinates their claims.

An existing cluster on AWS, GCP, Azure, or another provider can use Helm directly and skip Terraform entirely.

## Render

Before creating or syncing the Blueprint, create an environment group named **`jevbox-app`** in the Render Dashboard and populate its shared settings:

| Variables                                       | Values                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `FILE_STORAGE`, `S3_BUCKET`, `AWS_REGION`       | `s3`, the complete bucket name, and its AWS region                        |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`    | Scoped IAM credentials for that bucket                                    |
| `ENCRYPTION_KEY`                                | Existing deployment key, or `openssl rand -hex 32` for a new installation |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`         | Relay hostname, `587`, `false` for STARTTLS                               |
| `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM` | Existing SMTP credentials and verified sender                             |

Create a private bucket and scoped IAM credentials first, following [file storage](storage.md). Use an SMTP provider that supports STARTTLS on port 587 and verify the sender before deploying. Preserve the current `ENCRYPTION_KEY` when moving an existing installation; generating a replacement makes its encrypted provider credentials unreadable.

Then create a **New Blueprint** in Render, connect this repository, and select `render.yaml`. The Blueprint links the existing `jevbox-app` group to both the web service and worker. It creates three paid Docker services in Virginia: a public web service, a background worker, and private SpiceDB. It also creates two paid PostgreSQL 17 instances with separate roles and public database access disabled. Review the displayed cost before creating resources. Change all five regions together before the first deployment if necessary. Disable Blueprint Auto Sync in the dashboard to keep subsequent infrastructure updates manual. No persistent application disk is required.

The group is managed in the dashboard, so code pushes and Blueprint syncs do not overwrite its values. Changing a group value triggers a deploy for each linked service with auto-deploys enabled; later credential updates require one group edit without another Blueprint sync. Render does not support `sync: false` inside groups. See [environment groups](https://render.com/docs/configure-environment-variables#environment-groups).

For an existing deployment, copy the shared values from the web service into `jevbox-app`, sync the updated Blueprint to link both services, and remove the corresponding individual variables from **both** services. Render preserves variables omitted from the Blueprint, and individual service values override group values. Keep the group populated and linked before removing those duplicates. Remove every individual key listed in the table, including `FILE_STORAGE`, `SMTP_PORT`, and `SMTP_SECURE`, plus any optional `S3_*` or `AWS_SESSION_TOKEN` settings moved to the group. Redeploy both services once the migration is complete.

The initial Blueprint flow prompts for the web-only `ALLOW_SIGNUP` setting. Set it to `false` for invitation-only registration or `true` to allow public registration. This setting uses `sync: false`, so subsequent Blueprint syncs preserve its dashboard value. Better Auth, bootstrap, and shared SpiceDB secrets are generated automatically; keep them stable and save the encryption key separately.

Both services' `APP_ORIGIN` values directly reference the web service's `RENDER_EXTERNAL_URL`, including any generated hostname suffix. The startup wrapper constructs SpiceDB's HTTP URL from its private `hostport` reference. SpiceDB runs its database migrations before serving, with small connection pools. The database references use direct private connections, preserving pg-boss's LISTEN/NOTIFY connection. SpiceDB uses an unencrypted database connection inside Render's private network; both databases reject public connections. See [Render's connection guidance](https://render.com/docs/postgresql-creating-connecting).

Deploy SpiceDB first, then the web service and worker, checking their logs and the web health check. Services might restart while the authorization database initializes on the first deployment. Open the generated HTTPS URL, copy `BOOTSTRAP_TOKEN` from the web service's environment in the dashboard, create the initial account with **Deployment setup token**, verify the email link, and sign in. When `ALLOW_SIGNUP=false`, signup is disabled after bootstrap; invite additional users through the application. Configure provider credentials and verify upload/index/search/chat and private access with a second account.

For an existing Blueprint, push the updated configuration to `main` and select **Manual Sync** once in Render to apply the auto-deploy settings. Subsequent matching changes on `main` deploy automatically after the repository's CI checks pass (`autoDeployTrigger: checksPass`). Blueprint Auto Sync separately controls whether future `render.yaml` changes are applied automatically. See [Render's auto-deploy settings](https://render.com/docs/deploys#automatic-deploys).

The web and worker use the same app build filters because their image includes both the web app and the thumbnail renderer. Changes to application source, shared code, public assets, dependencies, build configuration, licenses, or their startup wrapper deploy both services. SpiceDB deploys for changes to its Dockerfile or startup wrapper. Changes to `render.yaml` or `.dockerignore` match all three services; docs-only and tests-only changes skip service builds. Services deploy independently, so coordinated manual upgrades should still deploy SpiceDB first when its version changes. Preview environments remain disabled.

All processes have a 45-second shutdown window. Keep one web instance because API rate limits are currently local to that process. To use a custom domain, add it in Render and replace both services' `APP_ORIGIN` references in the Blueprint with the same `value` containing the exact HTTPS origin, then sync. Set `renderSubdomainPolicy: disabled` on the web service to restrict access to the custom domain. Configure `TRUST_PROXY_CIDRS` only with verified proxy source ranges; leaving it unset is safe but clients share IP rate limits behind the proxy.

Validate configuration before syncing:

```sh
python3 -m venv /tmp/jevbox-deployment-validation
/tmp/jevbox-deployment-validation/bin/pip install -r infra/deployment-requirements.txt
/tmp/jevbox-deployment-validation/bin/python scripts/verify-deployment.py
```

CI also validates portable and AWS Helm manifests, builds both Docker images, and checks Terraform with mocked providers. This does not create cloud resources. Render's dashboard validation and an actual deploy remain the final checks for account-specific limits and networking. See the [Blueprint reference](https://render.com/docs/blueprint-spec).

## Backup and recovery

Persist the encryption key separately and keep it stable across deployments. Changing it without re-encrypting the database makes stored provider credentials unreadable.

Preserve the S3 bucket and object versions referenced by the database backup as described in [file storage](storage.md). Stop application writes while taking coordinated PostgreSQL backups of both the application and SpiceDB databases, using `pg_dump` or your database provider’s backup facilities. Preserve the external encryption key separately. Restore both databases into an isolated environment with the same key and start SpiceDB before the application. Verify login, original bytes, parsed output, permitted reads, forbidden reads, and revocation from a second account. Restoring only one database can leave graph versions missing or inconsistent; fail closed and restore a matching pair. Backups of previously authorized data require the same access restrictions as the live databases.

Backups, ingress/controller installation, DNS, certificates, cloud quotas, and real provider calls need environment-specific acceptance. Local validation does not establish that a deployment has been applied or accepted in AWS.

The application applies the numbered PostgreSQL migrations at startup, including the link-sharing table and access constraint. Authorization startup installs the matching SpiceDB schema before serving application requests.

The Better Auth migration preserves account IDs, credentials, memberships, and documents while invalidating old sessions. Existing users must verify mailbox ownership before signing in. Back up the application database and stable auth secret before upgrading. Confirm verification delivery and password reset in the deployed environment before onboarding users.

### Organization and credential plugins

Organizations, memberships, invitations, API keys, and MCP OAuth use Better Auth plugins. Invite emails use the same queued SMTP transport as verification and password reset, so no additional Render service or secret is required. For Resend, verify the sending domain, then set `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`, `SMTP_PASSWORD` to the Resend API key, and `AUTH_EMAIL_FROM` to a complete sender address, such as `Jevbox <no-reply@YOUR_VERIFIED_DOMAIN>`. A domain alone is not a sender address. Keep port 587 and `SMTP_SECURE=false` to require STARTTLS in production. On Render, change the email settings in `jevbox-app` and confirm both linked services deploy with the updated values. Remove any individual service overrides. SMTP authentication can succeed while message delivery fails; check the worker and the Resend Emails dashboard when a verification email is missing.

Registration through an invitation creates an unverified account without membership. The user verifies that email, signs in, and accepts the pending invitation. Membership changes commit only after SpiceDB publishes the corresponding permission snapshot. Removing a member invalidates their organization sessions and document grants immediately.

The plugin migration preserves existing accounts, memberships, and documents, and invalidates the unreleased custom API keys and pending invitations. Issue fresh invitations and keys after upgrading. MCP supports 2026-07-28 and older clients through the SDK's stateless compatibility handler. SDK v2 clients can pin 2026-07-28; 2025-11-25 clients use the standard initialize handshake. Authentication and document permissions apply to both protocols.
