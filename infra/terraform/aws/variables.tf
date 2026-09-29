variable "target_account_id" {
  type        = string
  description = "Dedicated target account, verified before any resource changes"
  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id))
    error_message = "A twelve-digit target account is required."
  }
}
variable "blocked_account_ids" {
  type        = set(string)
  description = "Accounts that must never receive this deployment; include the PROD 1 account"
  validation {
    condition     = length(var.blocked_account_ids) > 0 && alltrue([for id in var.blocked_account_ids : can(regex("^[0-9]{12}$", id))])
    error_message = "Provide a non-empty list of valid protected account IDs."
  }
}
variable "region" {
  type        = string
  description = "Explicit region for the isolated installation"
}
variable "environment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.environment)) && !can(regex("prod-?1", var.environment))
    error_message = "Choose an isolated environment name, never PROD 1."
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
  description = "Explicit IAM role allowed to administer the new cluster"
}
variable "kubernetes_version" {
  type        = string
  description = "A supported EKS Kubernetes minor version in the selected region"
}
variable "vpc_cidr" {
  type    = string
  default = "10.84.0.0/16"
}
