#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo 'Run as root on the ACC storefront server.' >&2
  exit 1
fi

release_dir="${1:-}"
if [[ -z "$release_dir" || ! -f "$release_dir/scripts/sync-epharm-orders.mjs" ||
      ! -f "$release_dir/scripts/lib/epharm-contract.mjs" ||
      ! -f "$release_dir/tests/epharm-contract.test.mjs" ]]; then
  echo 'Usage: deploy.sh /path/to/acc-order-bridge' >&2
  exit 1
fi

site_dir=/var/www/inkar-shop
worker_path="$site_dir/scripts/sync-epharm-orders.mjs"
contract_path="$site_dir/scripts/lib/epharm-contract.mjs"
expected_worker_sha=fac907e6a61bb4d14c60f93709c51adf30de6f7c7f33535ed09657f4eb37edd8
expected_contract_sha=28c4a09a740aa3aa08c3c7da1a092c2bbf6f388f6a383b0c8db3d108eec74aea
pilot_worker_sha=b891cfa916340067a476f4d6e1ce1b244e13706c0bbd7e5b4c0e89ec08909041
pilot_contract_sha=8b3abea5bda21f41de591a8e9d3538c1e52e1147b048316f66b618268c3bc05b

if systemctl is-active --quiet inkar-shop-epharm-orders.timer ||
    systemctl is-active --quiet inkar-shop-epharm-orders.service; then
  echo 'Stop the ACC order worker timer and wait for its service before deploying.' >&2
  exit 1
fi
if ! grep -qx 'EPHARM_ORDER_SYNC_ENABLED=false' /etc/inkar-shop/epharm-orders.env; then
  echo 'The ACC order worker must be disabled during deployment.' >&2
  exit 1
fi

worker_sha="$(sha256sum "$worker_path" | awk '{print $1}')"
contract_sha="$(sha256sum "$contract_path" | awk '{print $1}')"
if [[ ! ( "$worker_sha" == "$expected_worker_sha" && "$contract_sha" == "$expected_contract_sha" ) &&
      ! ( "$worker_sha" == "$pilot_worker_sha" && "$contract_sha" == "$pilot_contract_sha" ) ]]; then
  echo 'The live ACC order worker changed since the audited snapshot; re-review before deployment.' >&2
  exit 1
fi

node --check "$release_dir/scripts/sync-epharm-orders.mjs"
node --check "$release_dir/scripts/probe-epharm-orders.mjs"
node --check "$release_dir/scripts/configure-pilot.mjs"
node --test "$release_dir"/tests/*.test.mjs

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/opt/backups/acc-order-bridge-$stamp"
umask 077
mkdir -m 700 "$backup_dir"
cp -p "$worker_path" "$backup_dir/sync-epharm-orders.mjs"
cp -p "$contract_path" "$backup_dir/epharm-contract.mjs"
cp -p /etc/inkar-shop/epharm-orders.env "$backup_dir/epharm-orders.env"

worker_next="$worker_path.next-$stamp"
contract_next="$contract_path.next-$stamp"
trap 'rm -f "$worker_next" "$contract_next"' EXIT
install -m 0644 "$release_dir/scripts/sync-epharm-orders.mjs" "$worker_next"
install -m 0644 "$release_dir/scripts/lib/epharm-contract.mjs" "$contract_next"
mv "$contract_next" "$contract_path"
mv "$worker_next" "$worker_path"

cmp -s "$worker_path" "$release_dir/scripts/sync-epharm-orders.mjs"
cmp -s "$contract_path" "$release_dir/scripts/lib/epharm-contract.mjs"
echo "ACC order bridge installed. Backup: $backup_dir"
