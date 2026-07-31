# One-click(ish) deploy on Oracle Cloud Always Free

This folder is a complete [Oracle Resource Manager](https://docs.oracle.com/en-us/iaas/Content/ResourceManager/home.htm)
stack: Terraform that provisions the network (ports 80/443 pre-opened),
an Always Free Ampere A1 instance, Oracle's iptables fix, Docker, Caddy
TLS, and the bridge itself — with a form for your Slack credentials, just
like a managed platform's deploy button. The master key is generated
during provisioning; you never handle it.

## Deploy via the OCI console (no tools needed)

1. Download this folder as a zip (or grab `oci-stack.zip` from the
   repo's GitHub Releases if published).
2. In the OCI console: **Developer Services → Resource Manager → Stacks →
   Create Stack**, choose **My Configuration**, upload the zip.
3. Fill in the form: compartment, SSH public key, your bridge domain,
   the three Slack credentials, and your Buzz relay URL.
4. Click **Apply**. When it finishes, the stack's **Outputs** show the
   public IP and exact next steps (point DNS, verify `/healthz`, set the
   two URLs in your Slack app).

If instance creation fails with **"Out of host capacity"** (common in
free-tier home regions), re-apply with a different availability domain
number — or upgrade the account to Pay As You Go first (still $0 within
Always Free limits, and it also prevents idle reclamation).

## Deploy via Terraform CLI

```bash
cd deploy/oci
terraform init
terraform apply \
  -var tenancy_ocid=ocid1.tenancy... \
  -var compartment_ocid=ocid1.tenancy... \
  -var region=us-ashburn-1 \
  -var "ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)" \
  -var bridge_domain=bridge.example.com \
  -var slack_client_id=... -var slack_client_secret=... \
  -var slack_signing_secret=... \
  -var buzz_relay_url=wss://buzz.example.com
```

## What it costs

$0 on the Always Free tier (2 OCPU / 12 GB defaults match the post-2026
allowance). Upgrading the account to Pay As You Go keeps it $0 within
free limits and exempts the instance from idle reclamation — recommended.

## Notes

- This stack deploys the **bridge only** (your Buzz hive lives
  elsewhere). For co-hosting Buzz on the same instance, follow
  [`../oci-setup.md`](../oci-setup.md) manually — the full stack needs
  choices (image sources, sizing) that don't automate cleanly yet.
- ⚠️ Written to Oracle's documented schemas but **not yet exercised
  against a live OCI tenancy** — validate with `terraform plan` and
  report issues.
