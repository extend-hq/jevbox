data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}
resource "terraform_data" "account_guard" {
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.target_account_id
      error_message = "Current credentials do not match the target account."
    }
  }
}
locals {
  name = "jevbox-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
}
module "vpc" {
  source                       = "terraform-aws-modules/vpc/aws"
  version                      = "6.0.1"
  name                         = local.name
  cidr                         = var.vpc_cidr
  azs                          = local.azs
  private_subnets              = [cidrsubnet(var.vpc_cidr, 8, 1), cidrsubnet(var.vpc_cidr, 8, 2)]
  public_subnets               = [cidrsubnet(var.vpc_cidr, 8, 101), cidrsubnet(var.vpc_cidr, 8, 102)]
  database_subnets             = [cidrsubnet(var.vpc_cidr, 8, 11), cidrsubnet(var.vpc_cidr, 8, 12)]
  create_database_subnet_group = true
  enable_nat_gateway           = true
  single_nat_gateway           = true
  enable_dns_hostnames         = true
  public_subnet_tags           = { "kubernetes.io/role/elb" = "1" }
  private_subnet_tags          = { "kubernetes.io/role/internal-elb" = "1" }
  depends_on                   = [terraform_data.account_guard]
}
module "eks" {
  source                                   = "terraform-aws-modules/eks/aws"
  version                                  = "21.3.1"
  name                                     = local.name
  kubernetes_version                       = var.kubernetes_version
  endpoint_public_access                   = true
  endpoint_public_access_cidrs             = var.operator_cidrs
  endpoint_private_access                  = true
  enable_cluster_creator_admin_permissions = false
  enable_irsa                              = true
  vpc_id                                   = module.vpc.vpc_id
  subnet_ids                               = module.vpc.private_subnets
  access_entries = {
    operator = {
      principal_arn = var.operator_role_arn
      policy_associations = {
        administrator = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }
  addons = {
    coredns    = {}
    kube-proxy = {}
    vpc-cni = {
      before_compute = true
      configuration_values = jsonencode({
        enableNetworkPolicy = "true"
        env                 = { NETWORK_POLICY_ENFORCING_MODE = "standard" }
      })
    }
    aws-ebs-csi-driver = { service_account_role_arn = aws_iam_role.ebs.arn }
  }
  eks_managed_node_groups = {
    app = {
      instance_types   = ["t3.large"]
      min_size         = 1
      max_size         = 2
      desired_size     = 1
      metadata_options = { http_tokens = "required", http_put_response_hop_limit = 1 }
    }
  }
}
resource "aws_iam_role" "ebs" {
  name = "${local.name}-ebs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = module.eks.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:sub" = "system:serviceaccount:kube-system:ebs-csi-controller-sa"
        "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:aud" = "sts.amazonaws.com"
      } }
    }]
  })
}
resource "aws_iam_role_policy_attachment" "ebs" {
  role       = aws_iam_role.ebs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}
resource "aws_ecr_repository" "app" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
  depends_on = [terraform_data.account_guard]
}
