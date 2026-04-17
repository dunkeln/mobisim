output "service_url" {
  description = "Public HTTPS URL of the Lightsail container service"
  value       = aws_lightsail_container_service.webapp.url
}

output "service_name" {
  description = "Lightsail container service name"
  value       = aws_lightsail_container_service.webapp.name
}

output "runtime_access_key_id" {
  description = "AWS access key ID for the runtime IAM user (set as AWS_ACCESS_KEY_ID env var)"
  value       = aws_iam_access_key.webapp.id
  sensitive   = true
}

output "runtime_secret_access_key" {
  description = "AWS secret access key for the runtime IAM user (set as AWS_SECRET_ACCESS_KEY env var)"
  value       = aws_iam_access_key.webapp.secret
  sensitive   = true
}
