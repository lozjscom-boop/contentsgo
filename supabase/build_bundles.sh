#!/usr/bin/env bash
# 마이그레이션을 SQL Editor에 한 번에 붙여넣을 수 있게 묶는다.
#  - ALL_IN_ONE.sql          : 새 프로젝트용 (1~N 전체)
#  - UPDATE_04_TO_LATEST.sql : 1~3만 적용한 프로젝트용 (4~N)
set -euo pipefail
cd "$(dirname "$0")/migrations"
out_all=../ALL_IN_ONE.sql; out_up=../UPDATE_04_TO_LATEST.sql
: > "$out_all"; : > "$out_up"
for f in $(ls *.sql | sort); do
  num=$(echo "$f" | sed -E 's/^[0-9]{12}([0-9]{2})_.*/\1/' | sed 's/^0*//')
  { echo "-- ===== $f ====="; cat "$f"; echo; } >> "$out_all"
  if [ "${num:-0}" -ge 4 ]; then { echo "-- ===== $f ====="; cat "$f"; echo; } >> "$out_up"; fi
done
wc -l "$out_all" "$out_up"
