import { mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
// サーバーのコードや設定は公開用フォルダへ入れない。
for (const name of ['index.html', 'growth.js', 'growth.css', 'csv.mjs']) {
  await copyFile(new URL(name, root), new URL(`public/${name}`, root));
}
