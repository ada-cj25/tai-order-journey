#!/usr/bin/env bash
set -Eeuo pipefail

release_env="${1:?Usage: restore-drill.sh /etc/tai-erp/production/release.env COS_OBJECT_KEY [compose.yaml]}"
object_key="${2:?COS backup object key is required}"
compose_file="${3:-/opt/tai-erp/deploy/personal/compose.yaml}"
if [[ ! "$object_key" =~ ^postgresql/[0-9]{4}/[0-9]{2}/[0-9]{2}/tai_erp_[0-9]{8}T[0-9]{6}Z_[a-f0-9]{8}\.dump$ ]]; then
  echo "COS 对象键不符合备份格式" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$release_env"
set +a
: "${ERP_POSTGRES_ENV_FILE:?release.env 缺少 ERP_POSTGRES_ENV_FILE}"
: "${ERP_BACKUP_DIRECTORY:?release.env 缺少 ERP_BACKUP_DIRECTORY}"
if [[ "$ERP_BACKUP_DIRECTORY" != "/var/lib/tai-erp/backups" && "$ERP_BACKUP_DIRECTORY" != /var/lib/tai-erp/backups/* ]]; then
  echo "拒绝使用非受控恢复目录" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ERP_POSTGRES_ENV_FILE"
set +a
: "${POSTGRES_DB:?postgres.env 缺少 POSTGRES_DB}"
: "${POSTGRES_USER:?postgres.env 缺少 POSTGRES_USER}"

file_name="${object_key##*/}"
mkdir -p "$ERP_BACKUP_DIRECTORY/restores"
chown 10001:10001 "$ERP_BACKUP_DIRECTORY/restores"
chmod 700 "$ERP_BACKUP_DIRECTORY/restores"
local_dump="$ERP_BACKUP_DIRECTORY/restores/$file_name"
container_dump="/backups/restores/$file_name"
docker compose --env-file "$release_env" -f "$compose_file" --profile maintenance run --rm \
  -e "BACKUP_OBJECT_KEY=$object_key" -e "RESTORE_FILE=$container_dump" \
  backup-tool node scripts/download-backup.mjs

restore_database="tai_restore_$(date -u +%Y%m%d%H%M%S)_$(tr -d '-' </proc/sys/kernel/random/uuid | cut -c1-6)"
if [[ "$restore_database" == "$POSTGRES_DB" ]]; then
  echo "拒绝覆盖正式数据库" >&2
  exit 1
fi
docker compose --env-file "$release_env" -f "$compose_file" exec -T db \
  createdb --username "$POSTGRES_USER" "$restore_database"
docker compose --env-file "$release_env" -f "$compose_file" exec -T db \
  pg_restore --username "$POSTGRES_USER" --dbname "$restore_database" --exit-on-error <"$local_dump"

docker compose --env-file "$release_env" -f "$compose_file" exec -T db \
  psql --username "$POSTGRES_USER" --dbname "$restore_database" --set=ON_ERROR_STOP=1 \
  --command='SELECT COUNT(*) AS employee_count FROM "Employee";' \
  --command='SELECT COUNT(*) AS order_count FROM "Order";' \
  --command='SELECT COUNT(*) AS attachment_count FROM "Attachment";'

echo "恢复演练库已创建：$restore_database"
echo "请按手册抽查编号、付款事实、工序数量和附件；本脚本不会自动删除演练库。"
