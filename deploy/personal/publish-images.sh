#!/usr/bin/env bash
set -Eeuo pipefail

tag="${1:?Usage: publish-images.sh v1.2.0 ccr.ccs.tencentyun.com/NAMESPACE}"
registry="${2:?Tencent TCR registry namespace is required}"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]]; then
  echo "版本号必须是 v1.2.0 这类受控标签" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "发布前工作区必须干净" >&2
  exit 1
fi
if [[ "$(git describe --tags --exact-match 2>/dev/null || true)" != "$tag" ]]; then
  echo "当前提交没有对应的 $tag 标签" >&2
  exit 1
fi

npm ci
npm run db:generate
npm run typecheck
npm test
npm run test:workflow
npm run test:deploy
npm run build
npm run build:api
npm run test:sites
npm audit --omit=dev --audit-level=high

for repository in tai-erp-api tai-erp-web tai-erp-migrate tai-erp-backup; do
  case "$repository" in
    tai-erp-api) target=api ;;
    tai-erp-web) target=personal-web ;;
    tai-erp-migrate) target=migrate ;;
    tai-erp-backup) target=backup-tool ;;
  esac
  image="$registry/$repository:$tag"
  docker buildx build --platform linux/amd64 --target "$target" --provenance=true --sbom=true --tag "$image" --push .
  echo "已推送 $image"
  docker buildx imagetools inspect "$image"
done

echo "请把上面四个 sha256 digest 复制到受保护的 release.env；服务器禁止使用浮动 tag。"
