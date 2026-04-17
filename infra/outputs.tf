output "webapp_url" {
  description = "Public URL of the deployed webapp"
  value       = module.webapp.service_url
}

output "asset_bucket_name" {
  description = "S3 bucket name for vehicle assets"
  value       = module.s3.bucket_name
}

output "asset_bucket_domain" {
  description = "S3 bucket regional domain (use as ASSET_REGISTRY_PUBLIC_BASE_URL prefix)"
  value       = module.s3.bucket_regional_domain
}

output "dynamodb_table_name" {
  description = "DynamoDB context-history table name"
  value       = module.dynamodb.table_name
}

output "runtime_access_key_id" {
  description = "AWS_ACCESS_KEY_ID for the webapp runtime user — add to container env"
  value       = module.webapp.runtime_access_key_id
  sensitive   = true
}

output "runtime_secret_access_key" {
  description = "AWS_SECRET_ACCESS_KEY for the webapp runtime user — add to container env"
  value       = module.webapp.runtime_secret_access_key
  sensitive   = true
}
