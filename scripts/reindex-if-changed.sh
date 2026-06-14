#!/usr/bin/env bash
# 글(src/content/posts)이 커밋으로 바뀌면 검색 인덱스를 재빌드하고
# synaptic 검색 서비스를 재시작(=청크 재색인)한다. cron에서 주기 실행.
#
#   pnpm build → dist/search-fulltext.json 갱신
#   systemctl --user restart sonblog-search → 전체 본문 청크 재색인(~2~3분)
#
# 변경 없으면 즉시 종료(빌드/재색인 안 함). 마지막 색인한 posts 커밋 해시를
# ~/.cache/sonblog-reindex.hash 에 기록해 비교한다.
set -euo pipefail

export PATH=/usr/bin:/bin:/usr/local/bin
export XDG_RUNTIME_DIR="/run/user/$(id -u)"   # cron에서 systemctl --user 동작에 필요

REPO="$HOME/projects/blog/sonblog-astro"
STATE="$HOME/.cache/sonblog-reindex.hash"
cd "$REPO"

# 글을 마지막으로 건드린 커밋 해시 (디자인 등 다른 변경은 무시)
HASH="$(git log -1 --format=%H -- src/content/posts 2>/dev/null || echo nogit)"
mkdir -p "$(dirname "$STATE")"
PREV="$(cat "$STATE" 2>/dev/null || echo "")"

if [ "$HASH" = "$PREV" ]; then
  exit 0   # 글 변경 없음 → 아무것도 안 함
fi

echo "[$(date '+%F %T')] posts changed ($HASH) → build + reindex"
pnpm build
systemctl --user restart sonblog-search.service
echo "$HASH" > "$STATE"
echo "[$(date '+%F %T')] reindex triggered (서비스가 백그라운드에서 ~2~3분 청크 재색인)"
