variable "table_name" {
  description = "Name of the DynamoDB context-history table"
  type        = string
  default     = "mobisim-context-history"
}

variable "enable_pitr" {
  description = "Enable point-in-time recovery"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
