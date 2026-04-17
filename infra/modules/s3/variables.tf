variable "bucket_name" {
  description = "Globally unique S3 bucket name for vehicle assets"
  type        = string
}

variable "enable_versioning" {
  description = "Enable S3 object versioning"
  type        = bool
  default     = false
}

variable "allowed_origins" {
  description = "CORS allowed origins for GLB asset fetches"
  type        = list(string)
  default     = ["*"]
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
