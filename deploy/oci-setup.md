# OCI Always Free (Ampere A1) Deployment Guide

Condensed from the full research in `docs/ARCHITECTURE-RESEARCH.md`.

## 1. Account & instance

- Create/verify the OCI account, then **upgrade to Pay As You Go** (Billing →
  Upgrade). Within Always Free limits you still pay $0, and the idle-instance
  reclamation policy no longer applies to your tenancy. This is the sanctioned
  alternative to keep-alive hacks.
- Launch a `VM.Standard.A1.Flex` instance with **Canonical Ubuntu (arm64)**.
  Budget for the post-June-2026 allowance: **2 OCPU / 12 GB** is the safe
  planning envelope. "Out of host capacity" errors are common in free home
  regions — retry across availability domains, or retry later.

## 2. VCN firewall (cloud layer)

Console → Networking → your VCN → subnet's **Security List** → Add Ingress
Rules (stateful):

| Source | Protocol | Dest port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |
| 0.0.0.0/0 | UDP | 443 (HTTP/3) |

## 3. Host firewall (VM layer)

Oracle's Ubuntu image persists iptables rules in `/etc/iptables/rules.v4`
ending in a REJECT-all — rules appended after it are dead. Insert ACCEPTs
**above** the REJECT:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

- **Never enable UFW** — Oracle documents that UFW on OCI Ubuntu can leave
  the instance unbootable (it clobbers the InstanceServices chain root needs
  to reach the iSCSI boot volume).
- Docker-published ports **bypass** the INPUT chain (DNAT → FORWARD, where
  Docker inserts its own ACCEPTs). Consequences: Caddy works even without
  the rules above, and *any* published port is internet-reachable once the
  VCN allows it. The compose file publishes ports on Caddy only; keep it
  that way. Extra host-level restrictions belong in the `DOCKER-USER` chain.
- If you ever run `netfilter-persistent reload`, restart Docker afterwards
  (`sudo systemctl restart docker`) so it re-inserts its chains.

## 4. Docker (arm64)

Use Docker's official apt repo (native arm64 builds of engine + compose v2):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # re-login afterwards
docker compose version
```

## 5. Deploy

```bash
sudo mkdir -p /opt/slack-buzz && sudo chown $USER /opt/slack-buzz
cd /opt/slack-buzz
git clone https://github.com/adamperlis/slack-to-buzz-bridge.git .
cp .env.example .env && chmod 600 .env    # fill in real values
mkdir -p deploy/secrets
openssl rand -hex 24 > deploy/secrets/pg_password
echo buzz-admin > deploy/secrets/minio_user
openssl rand -hex 24 > deploy/secrets/minio_password
chmod 600 deploy/secrets/*
# Vendor Buzz's relay build context into deploy/buzz per block/buzz docs,
# then edit deploy/Caddyfile domains and:
cd deploy && docker compose up -d --build
```

## 6. Lockdown verification (gate before real traffic)

From a machine **outside** OCI:

```bash
# Must succeed:
curl -s https://bridge.example.com/healthz
# Must FAIL (connection refused / filtered):
nc -vz <public-ip> 5432   # postgres
nc -vz <public-ip> 6379   # redis
nc -vz <public-ip> 9000   # minio
nc -vz <public-ip> 8080   # relay direct
# Relay reads must require auth — a REQ without NIP-42 AUTH on
# wss://buzz.example.com must be rejected or return nothing non-public.
```

On the VM: `docker ps` must show published ports on caddy only; `.env` and
`deploy/secrets/*` must be mode 600.

## 7. Operations

- **Backups (nightly cron):** `docker compose exec -T postgres pg_dump -U buzz buzz | gzip`
  plus a copy of the bridge SQLite volume; ship both off-box (rclone to any
  free object storage). The bridge DB contains encrypted tokens — the backup
  is useless to a thief without `BRIDGE_MASTER_KEY`, which lives only in
  `.env`. Store a copy of `.env` in a password manager, never beside backups.
- **Monitoring:** free uptime probe (e.g. UptimeRobot) on `/healthz`.
- **Reviews:** monthly check of Oracle's Always Free terms (the A1 allowance
  changed once already) and of block/buzz releases before upgrading the
  relay tier.
