variable "tenancy_ocid" {
  description = "OCID of your tenancy (auto-filled by Resource Manager)."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment to create resources in (root compartment is fine for personal tenancies)."
  type        = string
}

variable "region" {
  description = "OCI region (auto-filled by Resource Manager). Always Free A1 instances must be in your home region."
  type        = string
}

variable "availability_domain_number" {
  description = "Which availability domain to use (1-3). If instance creation fails with 'Out of host capacity', retry with a different number."
  type        = number
  default     = 1
}

variable "ssh_public_key" {
  description = "Your SSH public key (contents of ~/.ssh/id_ed25519.pub or similar) for logging into the instance."
  type        = string
}

variable "bridge_domain" {
  description = "Domain name for the bridge, e.g. bridge.example.com. After the stack finishes, point this domain's DNS A record at the instance's public IP — Caddy then fetches a TLS certificate automatically."
  type        = string
}

variable "slack_client_id" {
  description = "Slack app Client ID (Basic Information -> App Credentials)."
  type        = string
  sensitive   = true
}

variable "slack_client_secret" {
  description = "Slack app Client Secret."
  type        = string
  sensitive   = true
}

variable "slack_signing_secret" {
  description = "Slack app Signing Secret."
  type        = string
  sensitive   = true
}

variable "buzz_relay_url" {
  description = "WebSocket URL of your Buzz relay, e.g. wss://buzz.example.com."
  type        = string
}

variable "slack_allowed_teams" {
  description = "Optional comma-separated Slack team IDs allowed to install (empty = anyone with the link)."
  type        = string
  default     = ""
}

variable "instance_ocpus" {
  description = "A1 OCPUs. 2 fits the post-2026 Always Free allowance."
  type        = number
  default     = 2
}

variable "instance_memory_gb" {
  description = "A1 memory in GB. 12 fits the post-2026 Always Free allowance."
  type        = number
  default     = 12
}
