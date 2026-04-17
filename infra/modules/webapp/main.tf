# ─── Lightsail Container Service ─────────────────────────────────────────────
resource "aws_lightsail_container_service" "webapp" {
  name  = var.service_name
  power = var.power # nano | micro | small | medium | large | xlarge
  scale = var.scale # 1–20 nodes

  is_disabled = false

  # Allow the container service to pull from its own private registry
  private_registry_access {
    ecr_image_puller_role {
      is_active = true
    }
  }

  tags = var.tags
}

# ─── Container deployment ────────────────────────────────────────────────────
# Lightsail container deployments are managed separately from the service so
# Terraform can update the image/env without recreating the service.
resource "aws_lightsail_container_service_deployment_version" "webapp" {
  service_name = aws_lightsail_container_service.webapp.name

  container {
    container_name = "app"
    image          = var.image # e.g. "123456789.dkr.ecr.us-west-2.amazonaws.com/mobisim:latest"

    # Runtime env vars — secrets handled via SSM/Secrets Manager in production
    environment = merge(
      {
        NODE_ENV   = "production"
        PORT       = "3000"
        HOST       = "0.0.0.0"
        AWS_REGION = var.aws_region

        # DynamoDB context history
        CONTEXT_HISTORY_STORE = "dynamodb"
        CONTEXT_HISTORY_TABLE = var.dynamodb_table_name

        # Asset registry — point at the S3 bucket regional domain
        ASSET_REGISTRY_PUBLIC_BASE_URL = "https://${var.asset_bucket_domain}"
        ASSET_BUCKET_NAME             = var.asset_bucket_name
        AWS_ACCESS_KEY_ID             = aws_iam_access_key.webapp.id
        AWS_SECRET_ACCESS_KEY         = aws_iam_access_key.webapp.secret
      },
      var.extra_env
    )

    ports = {
      "3000" = "HTTP"
    }
  }

  public_endpoint {
    container_name = "app"
    container_port = 3000

    health_check {
      healthy_threshold   = 2
      unhealthy_threshold = 3
      timeout_seconds     = 5
      interval_seconds    = 30
      path                = "/"
      success_codes       = "200-499"
    }
  }
}

# ─── IAM role for the container service (DynamoDB + S3 access) ───────────────
# Lightsail container services don't natively support IAM task roles like ECS.
# The recommended pattern is to use an IAM user with least-privilege permissions
# and pass credentials as environment variables (or use IRSA via an ALB in front).
# This module creates that IAM user and its access key.
resource "aws_iam_user" "webapp" {
  name = "${var.service_name}-runtime"
  path = "/mobisim/"
  tags = var.tags
}

resource "aws_iam_user_policy_attachment" "s3" {
  user       = aws_iam_user.webapp.name
  policy_arn = var.assets_rw_policy_arn
}

resource "aws_iam_user_policy_attachment" "dynamodb" {
  user       = aws_iam_user.webapp.name
  policy_arn = var.dynamodb_rw_policy_arn
}

resource "aws_iam_access_key" "webapp" {
  user = aws_iam_user.webapp.name
}
