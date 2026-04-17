variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Deployment environment (prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "app_name" {
  description = "Application name prefix used for resource naming"
  type        = string
  default     = "mobisim"
}

# ─── S3 ──────────────────────────────────────────────────────────────────────
variable "asset_bucket_name" {
  description = "Globally unique S3 bucket name for vehicle assets (GLBs, semantic manifests)"
  type        = string
  # Must be globally unique — override in terraform.tfvars
  default = "mobisim-assets-prod"
}

variable "asset_cors_origins" {
  description = "Allowed CORS origins for the S3 asset bucket"
  type        = list(string)
  default     = ["*"]
}

# ─── Lightsail ───────────────────────────────────────────────────────────────
variable "lightsail_power" {
  description = "Lightsail container service power (nano|micro|small|medium|large|xlarge)"
  type        = string
  default     = "micro"
}

variable "lightsail_scale" {
  description = "Number of container nodes"
  type        = number
  default     = 1
}

variable "webapp_image" {
  description = "Docker image URI for the webapp (e.g. 123456789.dkr.ecr.us-west-2.amazonaws.com/mobisim:latest)"
  type        = string
}

variable "webapp_extra_env" {
  description = "Extra environment variables to pass to the container"
  type        = map(string)
  default     = {}
  sensitive   = true
}

# ─── Secrets (set via TF_VAR_* env vars or a .tfvars file never committed) ───
variable "auth_secret" {
  description = "AUTH_SECRET for SvelteKit Auth.js"
  type        = string
  sensitive   = true
}

variable "auth_github_id" {
  description = "GitHub OAuth client ID"
  type        = string
  sensitive   = true
  default     = ""
}

variable "auth_github_secret" {
  description = "GitHub OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}
