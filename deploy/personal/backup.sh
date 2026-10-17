#!/usr/bin/env bash
set -Eeuo pipefail

release_env="${1:-/etc/tai-erp/production/release.env}"
compose_file="${2:-/opt/tai-erp/deploy/personal/compose.yaml}"
if [[ ! -f "$release_env" || ! -f "$compose_file" ]]; then
  echo "缺少 release.env 或 compose.yaml" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$release_env"
set +a
: "${ERP_POSTGRES_ENV_FILE:?release.env 缺少 ERP_POSTGRES_ENV_FILE}"
: "${ERP_BACKUP_DIRECTORY:?release.env 缺少 ERP_BACKUP_DIRECTORY}"
if [[ "$ERP_BACKUP_DIRECTORY" != "/var/lib/tai-erp/backups" && "$ERP_BACKUP_DIRECTORY" != /var/lib/tai-erp/backups/* ]]; then
  echo "拒绝在非受控备份目录中运行" >&2
  exit 1
fi
if [[ ! -f "$ERP_POSTGRES_ENV_FILE" ]]; then
  echo "缺少受保护的 PostgreSQL 环境文件" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ERP_POSTGRES_ENV_FILE"
set +a
: "${POSTGRES_DB:?postgres.env 缺少 POSTGRES_DB}"
: "${POSTGRES_USER:?postgres.env 缺少 POSTGRES_USER}"

mkdir -p "$ERP_BACKUP_DIRECTORY"
chown 10001:10001 "$ERP_BACKUP_DIRECTORY"
chmod 700 "$ERP_BACKUP_DIRECTORY"
exec 9>"$ERP_BACKUP_DIRECTORY/.backup.lock"
if ! flock -n 9; then
  echo "已有备份任务在运行，本次跳过" >&2
  exit 75
fi

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
suffix="$(tr -d '-' </proc/sys/kernel/random/uuid | cut -c1-8)"
file_name="tai_erp_${stamp}_${suffix}.dump"
temporary="$ERP_BACKUP_DIRECTORY/.${file_name}.partial"
final="$ERP_BACKUP_DIRECTORY/$file_name"
trap 'rm -f -- "$temporary"' EXIT

docker compose --env-file "$release_env" -f "$compose_file" exec -T db \
  pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=9 >"$temporary"
if [[ ! -s "$temporary" ]]; then
  echo "pg_dump 产生了空文件" >&2
  exit 1
fi
mv -- "$temporary" "$final"
chown 10001:10001 "$final"

docker compose --env-file "$release_env" -f "$compose_file" --profile maintenance run --rm \
  -e "BACKUP_FILE=/backups/$file_name" -e "BACKUP_DATABASE_NAME=$POSTGRES_DB" backup-tool

find "$ERP_BACKUP_DIRECTORY" -maxdepth 1 -type f -name 'tai_erp_*.dump' -mtime +2 -delete
echo "备份已上传并校验：$file_name"
