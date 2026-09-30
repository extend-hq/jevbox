variable "target_account_id" {
  type        = string
  description = "Target AWS account, verified before any resource changes"
  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id))
    error_message = "A twelve-digit target account is required."
  }
}
variable "region" {
  type        = string
  description = "AWS region for the deployment"
}
variable "environment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.environment))
    error_message = "Use 3 to 25 lowercase letters, digits, or hyphens, starting with a letter."
  }
}
variable "operator_cidrs" {
  type        = list(string)
  description = "Public IP CIDRs allowed to reach the cluster API"
  validation {
    condition     = length(var.operator_cidrs) > 0 && alltrue([for cidr in var.operator_cidrs : can(cidrnetmask(cidr)) && !endswith(cidr, "/0")])
    error_message = "Provide explicit IPv4 operator CIDRs, not a global range."
  }
}
variable "operator_role_arn" {
  type        = string
  description = "IAM role allowed to administer the cluster"
}
variable "kubernetes_version" {
  type        = string
  description = "A supported EKS Kubernetes minor version in the selected region"
}
variable "vpc_cidr" {
  type    = string
  default = "10.84.0.0/16"
}
