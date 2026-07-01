#!/usr/bin/env node
// 毎月のピクミン情報（お題・ボーナス報酬）更新スクリプト
// 使い方:
//   node scripts/update-monthly.mjs <記事URL> --month=2026-08 [--odai-url=...] [--hoshu-url=...] [--event-name="8月のピクミン情報"]
// --odai-url / --hoshu-url を省略した場合は記事本文の <article> 内から
// lh3.googleusercontent.com の画像を自動抽出し、ヒーロー画像の次から2枚を採用する。
// 自動抽出は記事テンプレートが変わると外れる可能性があるため、実行後に
// 保存された *_odai.png / *_hoshu.png を必ず目視確認すること。

import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RYOKO_INDEX = path.resolve(REPO_ROOT, '..', 'Ryoko', 'index.html');
const PIKMIN_INDEX = path.resolve(REPO_ROOT, 'index.html');

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
    else args._.push(a);
  }
  return args;
}

async function extractArticleImages(articleUrl) {
  const res = await fetch(articleUrl);
  if (!res.ok) throw new Error(`記事の取得に失敗: ${res.status}`);
  const html = await res.text();
  const start = html.indexOf('<article');
  const end = html.lastIndexOf('</article>');
  if (start === -1 || end === -1) throw new Error('<article> タグが見つからない');
  const body = html.slice(start, end);
  // 同じ画像でも解像度違いで複数回出現するため、URL中の画像IDでグルーピングし、
  // 各画像につき最も解像度の高いバリアント(s0-e365、無ければ最大幅)を1つ採用する。
  const matches = [...body.matchAll(/https:\/\/lh3\.googleusercontent\.com\/([A-Za-z0-9_\-]+)=([A-Za-z0-9\-]+)/g)];
  const order = [];
  const byId = new Map();
  for (const [full, id, variant] of matches) {
    if (!byId.has(id)) { byId.set(id, []); order.push(id); }
    byId.get(id).push({ full, variant });
  }
  return order.map(id => {
    const variants = byId.get(id);
    const original = variants.find(v => v.variant.startsWith('s0-'));
    if (original) return original.full;
    const widest = variants.reduce((a, b) => {
      const wa = parseInt((a.variant.match(/w(\d+)/) || [0, 0])[1], 10);
      const wb = parseInt((b.variant.match(/w(\d+)/) || [0, 0])[1], 10);
      return wb > wa ? b : a;
    });
    return widest.full;
  });
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像の取得に失敗: ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

function updatePikminBlock(content, { key, eventName, odaiFile, hoshuFile }) {
  content = content.replace(/"\d{4}-\d{2}":\s*\{/, `"${key}": {`);
  content = content.replace(/eventName:\s*"[^"]*"/, `eventName: "${eventName}"`);
  content = content.replace(
    /https:\/\/raw\.githubusercontent\.com\/takaya5233\/pikmin-weather\/main\/\S*odai\.png/,
    `https://raw.githubusercontent.com/takaya5233/pikmin-weather/main/${odaiFile}`
  );
  content = content.replace(
    /https:\/\/raw\.githubusercontent\.com\/takaya5233\/pikmin-weather\/main\/\S*hoshu\.png/,
    `https://raw.githubusercontent.com/takaya5233/pikmin-weather/main/${hoshuFile}`
  );
  return content;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const articleUrl = args._[0];
  if (!articleUrl) {
    console.error('使い方: node scripts/update-monthly.mjs <記事URL> --month=2026-08');
    process.exit(1);
  }

  const month = args.month || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const monthNum = parseInt(month.split('-')[1], 10);
  const eventName = args['event-name'] || `${monthNum}月のピクミン情報`;

  let odaiUrl = args['odai-url'];
  let hoshuUrl = args['hoshu-url'];

  if (!odaiUrl || !hoshuUrl) {
    console.log(`記事を解析中: ${articleUrl}`);
    const images = await extractArticleImages(articleUrl);
    console.log('検出した本文画像(順番):');
    images.forEach((u, i) => console.log(`  [${i}] ${u}`));
    if (images.length < 3) {
      throw new Error('画像が3枚未満のため自動判定不可。--odai-url / --hoshu-url を手動指定してください。');
    }
    odaiUrl = odaiUrl || images[1];
    hoshuUrl = hoshuUrl || images[2];
    console.log(`→ お題候補: [1] ${odaiUrl}`);
    console.log(`→ 報酬候補: [2] ${hoshuUrl}`);
    console.log('  誤っていれば --odai-url= / --hoshu-url= で上書きして再実行してください。');
  }

  const odaiFile = `${monthNum}_odai.png`;
  const hoshuFile = `${monthNum}_hoshu.png`;

  await downloadImage(odaiUrl, path.resolve(REPO_ROOT, odaiFile));
  await downloadImage(hoshuUrl, path.resolve(REPO_ROOT, hoshuFile));
  console.log(`保存: ${odaiFile}, ${hoshuFile}`);

  for (const file of [PIKMIN_INDEX, RYOKO_INDEX]) {
    const content = await readFile(file, 'utf-8');
    const updated = updatePikminBlock(content, { key: month, eventName, odaiFile, hoshuFile });
    await writeFile(file, updated, 'utf-8');
    console.log(`更新: ${file}`);
  }

  console.log('\n次の手順: 保存された画像を目視確認 → git diff を確認 → commit & push');
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
