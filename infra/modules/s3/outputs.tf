output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.assets.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.assets.arn
}

output "bucket_regional_domain" {
  description = "S3 bucket regional domain name (for presigned URL construction)"
  value       = aws_s3_bucket.assets.bucket_regional_domain_name
}

output "assets_rw_policy_arn" {
  description = "ARN of the IAM policy granting read/write access to the bucket"
  value       = aws_iam_policy.assets_rw.arn
}
