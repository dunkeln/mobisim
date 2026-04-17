variable "service_name" {
  description = "Lightsail container service name"
  type        = string
  default     = "mobisim"
}

variable "power" {
  description = "Lightsail container service power tier (nano|micro|small|medium|large|xlarge)"
  type        = string
  default     = "micro"
}

variable "scale" {
  description = "Number of nodes (1-20)"
  type        = number
  default     = 1
}

variable "image" {
  description = "Docker image URI (ECR or Lightsail private registry)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB context-history table"
  type        = string
}

variable "dynamodb_rw_policy_arn" {
  description = "ARN of the IAM policy granting DynamoDB access"
  type        = string
}

variable "asset_bucket_domain" {
  description = "S3 bucket regional domain name (used to construct ASSET_REGISTRY_PUBLIC_BASE_URL)"
  type        = string
}

variable "asset_bucket_name" {
  description = "S3 bucket name used for asset and semantic storage"
  type        = string
}

variable "assets_rw_policy_arn" {
  description = "ARN of the IAM policy granting S3 read/write access"
  type        = string
}

variable "extra_env" {
  description = "Additional environment variables to inject into the container"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
