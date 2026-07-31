# Slack-to-Buzz bridge on an OCI Always Free Ampere A1 instance.
# Provisions the network (with 80/443 open), the ARM instance, and a
# cloud-init that installs Docker, fixes Oracle's iptables gotcha, and
# launches the bridge-only compose stack (Caddy + bridge).
#
# Use via OCI Resource Manager (upload this folder as a stack) or plain
# `terraform apply`. See README.md in this directory.

terraform {
  required_version = ">= 1.2.0"
  required_providers {
    oci = {
      source = "oracle/oci"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

provider "oci" {
  region = var.region
}

# Master secret generated at provision time — never typed, never logged.
resource "random_id" "bridge_master_key" {
  byte_length = 32
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# ---------------------------------------------------------------------------
# Network: VCN with a public subnet; ingress 22, 80, 443/tcp, 443/udp
# ---------------------------------------------------------------------------
resource "oci_core_vcn" "bridge" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "slack-buzz-bridge-vcn"
  dns_label      = "buzzbridge"
}

resource "oci_core_internet_gateway" "bridge" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.bridge.id
  display_name   = "slack-buzz-bridge-ig"
}

resource "oci_core_route_table" "bridge" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.bridge.id
  display_name   = "slack-buzz-bridge-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.bridge.id
  }
}

resource "oci_core_security_list" "bridge" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.bridge.id
  display_name   = "slack-buzz-bridge-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    protocol = "17" # UDP (HTTP/3)
    source   = "0.0.0.0/0"
    udp_options {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_subnet" "bridge" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.bridge.id
  cidr_block        = "10.0.1.0/24"
  display_name      = "slack-buzz-bridge-subnet"
  dns_label         = "bridge"
  route_table_id    = oci_core_route_table.bridge.id
  security_list_ids = [oci_core_security_list.bridge.id]
}

# ---------------------------------------------------------------------------
# The Always Free A1 instance
# ---------------------------------------------------------------------------
resource "oci_core_instance" "bridge" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_number - 1].name
  display_name        = "slack-buzz-bridge"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gb
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_arm.images[0].id
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.bridge.id
    assign_public_ip = true
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.tftpl", {
      bridge_domain        = var.bridge_domain
      slack_client_id      = var.slack_client_id
      slack_client_secret  = var.slack_client_secret
      slack_signing_secret = var.slack_signing_secret
      buzz_relay_url       = var.buzz_relay_url
      slack_allowed_teams  = var.slack_allowed_teams
      bridge_master_key    = random_id.bridge_master_key.hex
    }))
  }
}
