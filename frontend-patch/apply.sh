#!/usr/bin/env bash
# 把「国内底图」补丁打到本地 Home Assistant frontend 源码树上。
#
# 用法：bash apply.sh /path/to/frontend
# 前置：$FE 是 HA frontend 源码（2026.10 / 2026.11 附近版本）
set -euo pipefail

FE="${1:-}"
if [ -z "$FE" ] || [ ! -d "$FE/src/panels/lovelace/cards" ]; then
  echo "用法: bash apply.sh /path/to/home-assistant/frontend" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/patched-files"
BACKUP="$FE/.basemap-patch-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"

echo "→ 备份到 $BACKUP"
(cd "$SRC" && find . -type f -name '*.ts' | sed 's|^\./||') | while read -r f; do
  if [ -f "$FE/$f" ]; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp "$FE/$f" "$BACKUP/$f"
  else
    echo "$f" >> "$BACKUP/.added-files"
  fi
done

# 翻译文件走的是「原地改 JSON」，必须一并备份，否则回滚会留下 basemap_* 残留键。
for t in src/translations/en.json src/translations/zh-Hans.json; do
  if [ -f "$FE/$t" ]; then
    mkdir -p "$BACKUP/$(dirname "$t")"
    cp "$FE/$t" "$BACKUP/$t"
  fi
done

echo "→ 写入补丁文件"
(cd "$SRC" && find . -type f -name '*.ts') | while read -r f; do
  install -D -m 644 "$SRC/${f#./}" "$FE/${f#./}"
  echo "   ${f#./}"
done

echo "→ 合并翻译键"
node - "$FE" "$HERE/i18n" <<'NODE'
const fs = require("fs");
const path = require("path");
const [fe, i18nDir] = process.argv.slice(2);
const targets = [
  ["en.json", "src/translations/en.json"],
  ["zh-Hans.json", "src/translations/zh-Hans.json"],
];
for (const [name, rel] of targets) {
  const patchPath = path.join(i18nDir, name);
  const targetPath = path.join(fe, rel);
  if (!fs.existsSync(patchPath)) continue;
  if (!fs.existsSync(targetPath)) {
    console.warn(`  ! 未找到 ${rel}，跳过`);
    continue;
  }
  const added = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  const data = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  let n = 0;
  for (const [key, value] of Object.entries(added)) {
    const parts = key.split(".");
    let node = data;
    for (const part of parts.slice(0, -1)) {
      node[part] = node[part] ?? {};
      node = node[part];
    }
    if (node[parts[parts.length - 1]] !== value) {
      node[parts[parts.length - 1]] = value;
      n++;
    }
  }
  fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ${rel}: +${n}`);
}
NODE

cat <<EOF

✓ 完成。回滚（同时删掉新增文件）：
   cp -r "$BACKUP"/. "$FE"/ && cat "$BACKUP/.added-files" 2>/dev/null | xargs -r -I{} rm -f "$FE/{}"

接着：
   cd "$FE" && pnpm install && pnpm run build
   产物在 hass_frontend/（不是 dist/），挂到 HA（development_repo 或替换 hass_frontend 包），清缓存后重启

自检（可选）：
   npx vitest run --config test/vitest.config.ts test/common/map/
EOF
