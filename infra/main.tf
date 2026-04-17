terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and configure once you have an S3 backend bucket:
  # backend "s3" {
  #   bucket  = "mobisim-terraform-state"
  #   key     = "prod/terraform.tfstate"
  #   region  = "us-west-2"
  #   encrypt = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

locals {
  common_tags = {
    Project     = "mobisim"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ─── DynamoDB ────────────────────────────────────────────────────────────────
module "dynamodb" {
  source = "./modules/dynamodb"

  table_name  = "${var.app_name}-${var.environment}-context-history"
  enable_pitr = var.environment == "prod"
  tags        = local.common_tags
}

# IAM policy so the webapp can read/write the DynamoDB table
data "aws_iam_policy_document" "dynamodb_rw" {
  statement {
    sid    = "DynamoDBAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchWriteItem",
      "dynamodb:DescribeTable",
    ]
    resources = [
      module.dynamodb.table_arn,
      "${module.dynamodb.table_arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "dynamodb_rw" {
  name        = "${var.app_name}-${var.environment}-dynamodb-rw"
  description = "Read/write access to mobisim DynamoDB context-history table"
  policy      = data.aws_iam_policy_document.dynamodb_rw.json
  tags        = local.common_tags
}

# ─── S3 ──────────────────────────────────────────────────────────────────────
module "s3" {
  source = "./modules/s3"

  bucket_name       = var.asset_bucket_name
  enable_versioning = var.environment == "prod"
  allowed_origins   = var.asset_cors_origins
  tags              = local.common_tags
}

# ─── Webapp (Lightsail) ───────────────────────────────────────────────────────
module "webapp" {
  source = "./modules/webapp"

  service_name = "${var.app_name}-${var.environment}"
  power        = var.lightsail_power
  scale        = var.lightsail_scale
  image        = var.webapp_image
  aws_region   = var.aws_region

  dynamodb_table_name    = module.dynamodb.table_name
  dynamodb_rw_policy_arn = aws_iam_policy.dynamodb_rw.arn

  asset_bucket_domain  = module.s3.bucket_regional_domain
  asset_bucket_name    = module.s3.bucket_name
  assets_rw_policy_arn = module.s3.assets_rw_policy_arn

  # Pass secrets through — use `TF_VAR_webapp_secrets` or a secrets manager
  extra_env = merge(
    {
      AUTH_SECRET        = var.auth_secret
      AUTH_TRUST_HOST    = "true"
      AUTH_GITHUB_ID     = var.auth_github_id
      AUTH_GITHUB_SECRET = var.auth_github_secret
      OPENAI_API_KEY     = var.openai_api_key
    },
    var.webapp_extra_env
  )

  tags = local.common_tags
}
