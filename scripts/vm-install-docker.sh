#!/usr/bin/env bash
# Install Docker and Docker Compose on an Ubuntu VM (e.g. Azure cryptoClever).
# Run this ON THE VM after SSH, from the SmartTrade repo root.
# Usage: chmod +x scripts/vm-install-docker.sh && ./scripts/vm-install-docker.sh
# After it finishes, run: exit, then reconnect via SSH so the docker group applies.

set -e

echo "=== SmartTrade VM: Installing Docker and Docker Compose ==="

# Update system
echo "Updating system..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# Prerequisites
echo "Installing prerequisites..."
sudo apt-get install -y ca-certificates curl

# Docker GPG and repo
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  echo "Adding Docker GPG key..."
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
fi

if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
  echo "Adding Docker apt repository..."
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -qq
fi

# Install Docker packages
echo "Installing Docker Engine and Docker Compose plugin..."
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group (so you don't need sudo for docker)
echo "Adding $USER to docker group..."
sudo usermod -aG docker "$USER" || true

echo ""
echo "=== Docker and Docker Compose are installed. ==="
echo ""
echo "IMPORTANT: You must log out and log back in for the docker group to apply."
echo "  1. Run:  exit"
echo "  2. Reconnect:  ssh -i ~/keys/cryptoClever_key.pem azureuser@52.186.173.64"
echo "  3. Then run:  cd ~/SmartTrade && docker compose up -d --build"
echo ""
echo "After reconnecting, verify with:  docker run hello-world   and   docker compose version"
echo ""
