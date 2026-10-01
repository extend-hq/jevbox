mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
      arn        = "arn:aws:iam::123456789012:role/operator"
    }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_eks_addon_version" {
    defaults = { version = "v1.0.0-eksbuild.1" }
  }
  mock_resource "aws_eks_cluster" {
    defaults = {
      identity                  = [{ oidc = [{ issuer = "https://oidc.eks.us-east-1.amazonaws.com/id/test" }] }]
      certificate_authority     = [{ data = "dGVzdA==" }]
      kubernetes_network_config = { service_ipv4_cidr = "172.20.0.0/16" }
    }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/test" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::123456789012:policy/test" }
  }
  mock_resource "aws_launch_template" {
    defaults = { id = "lt-0123456789abcdef0" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/test" }
  }
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:us-east-1:123456789012:key/00000000-0000-4000-8000-000000000000"
      key_id = "00000000-0000-4000-8000-000000000000"
    }
  }
}
mock_provider "tls" {
  mock_data "tls_certificate" {
    defaults = { certificates = [{ sha1_fingerprint = "0000000000000000000000000000000000000000" }] }
  }
}
mock_provider "time" {}
mock_provider "cloudinit" {}
mock_provider "null" {}

variables {
  target_account_id  = "123456789012"
  region             = "us-east-1"
  environment        = "test"
  operator_cidrs     = ["203.0.113.10/32"]
  operator_role_arn  = "arn:aws:iam::123456789012:role/operator"
  kubernetes_version = "1.35"
}

run "deployment_foundation" {
  command = apply
  assert {
    condition     = aws_s3_bucket_public_access_block.files.block_public_policy && aws_s3_bucket_public_access_block.files.block_public_acls && aws_s3_bucket_public_access_block.files.ignore_public_acls && aws_s3_bucket_public_access_block.files.restrict_public_buckets
    error_message = "File storage must reject public access."
  }
  assert {
    condition     = strcontains(aws_iam_role.storage.assume_role_policy, "system:serviceaccount:jevbox-sandbox:jevbox-storage") && strcontains(aws_iam_role_policy.storage.policy, "s3:PutObject") && !strcontains(aws_iam_role_policy.storage.policy, "s3:*")
    error_message = "Storage credentials must bind to the application service account and scoped object actions."
  }
  assert {
    condition     = jsondecode(module.eks.cluster_addons["vpc-cni"].configuration_values).enableNetworkPolicy == "true"
    error_message = "Cluster networking must enforce policies."
  }
  assert {
    condition     = aws_ecr_repository.app.image_tag_mutability == "IMMUTABLE"
    error_message = "Deployment image tags must be immutable."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.database.referenced_security_group_id == module.eks.node_security_group_id
    error_message = "Database access must be limited to cluster nodes."
  }
  assert {
    condition     = strcontains(aws_iam_role.load_balancer_controller.assume_role_policy, "system:serviceaccount:kube-system:aws-load-balancer-controller")
    error_message = "Controller credentials must bind to its service account."
  }
}

run "reject_wrong_account" {
  command = plan
  variables {
    target_account_id = "999999999999"
  }
  expect_failures = [terraform_data.account_guard]
}

run "reject_open_cluster_api" {
  command = plan
  variables {
    operator_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.operator_cidrs]
}
