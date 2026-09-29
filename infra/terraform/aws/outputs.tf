output "cluster_name" { value = module.eks.cluster_name }
output "region" { value = var.region }
output "image_repository" { value = aws_ecr_repository.app.repository_url }
output "account_id" { value = data.aws_caller_identity.current.account_id }
