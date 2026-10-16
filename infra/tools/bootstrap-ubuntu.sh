#!/usr/bin/env bash
# Sólo Ubuntu 24.04 del VPS; no ejecutar en estaciones macOS/Windows.
# Uso: sudo bash bootstrap-ubuntu.sh USUARIO CIDR_SSH
set -euo pipefail
test "$(id -u)" = 0
operator="${1:?usuario SSH existente}"
ssh_cidr="${2:?IP administrativa en CIDR, p.ej. 203.0.113.10/32}"
id "$operator" >/dev/null
test -s "/home/$operator/.ssh/authorized_keys"
test "$(. /etc/os-release && echo "$ID:$VERSION_ID")" = 'ubuntu:24.04'
apt-get update
apt-get install -y docker.io docker-compose-v2 age rclone curl ca-certificates xz-utils ufw
systemctl enable --now docker
usermod -aG docker "$operator"

# Node oficial de la línea 22, verificado contra su manifiesto SHA256 por HTTPS.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
case "$(uname -m)" in aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) exit 1 ;; esac
curl -fsS https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$stage/SHASUMS256.txt"
artifact="$(awk -v suffix="linux-$arch.tar.xz" '$2 ~ suffix"$" {print $2}' "$stage/SHASUMS256.txt")"
test -n "$artifact"
curl -fsS "https://nodejs.org/dist/latest-v22.x/$artifact" -o "$stage/$artifact"
(cd "$stage" && grep " $artifact$" SHASUMS256.txt | sha256sum -c -)
mkdir -p /opt/terreno-node
tar -xJf "$stage/$artifact" --strip-components=1 -C /opt/terreno-node
ln -sf /opt/terreno-node/bin/node /usr/bin/node
mkdir -p /opt/terreno/infra /opt/terreno/secrets /opt/terreno/backups
chown -R "$operator:$operator" /opt/terreno
chmod 700 /opt/terreno/secrets /opt/terreno/backups

# Abrir la nueva regla antes de habilitar el firewall. Mantener la sesión SSH.
ufw allow from "$ssh_cidr" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/00-terreno.conf
sshd -t
systemctl reload ssh
echo 'Reabre SSH con llave antes de cerrar esta sesión. Repite reglas en OCI Security List.'
