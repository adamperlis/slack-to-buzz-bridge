output "public_ip" {
  description = "Public IP of the bridge instance."
  value       = oci_core_instance.bridge.public_ip
}

output "next_steps" {
  value = <<-EOT
    1. Point DNS: create an A record for ${var.bridge_domain} -> ${oci_core_instance.bridge.public_ip}
       (Caddy fetches the TLS certificate automatically once DNS resolves.)
    2. First boot takes ~5 minutes (Docker install + image build).
       Check:  ssh ubuntu@${oci_core_instance.bridge.public_ip} 'docker ps'
    3. Verify: https://${var.bridge_domain}/healthz
    4. In your Slack app settings, set the redirect URL to
       https://${var.bridge_domain}/slack/oauth_redirect and the Events
       request URL to https://${var.bridge_domain}/slack/events.
    5. Recommended: upgrade the OCI account to Pay As You Go (still $0
       within Always Free limits) so the instance is never reclaimed as idle.
  EOT
}
