terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  backend "s3" {}
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.target_account_id]
  default_tags {
    tags = { Application = "jevbox", Environment = var.environment, ManagedBy = "terraform" }
  }
}
