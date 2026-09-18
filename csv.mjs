export const COLUMNS = ['account_id', 'account_type', 'genre', 'goal', 'distribution', 'horizon_days', 'duration_seconds', 'post_url', 'script_id', 'store_name', 'syntax_pattern', 'final_text', 'published_at', 'measured_at', 'views', 'reach', 'saves', 'shares', 'follows', 'avg_watch_seconds', 'note'];
export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === ',') { row.push(field); field = ''; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field); if (row.some(cell => cell !== '')) rows.push(row);
      row = []; field = ''; closed = false;
    } else if (closed || char === '"') throw new Error('CSVの引用符を確認してください');
    else field += char;
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません');
  row.push(field); if (row.some(cell => cell !== '')) rows.push(row);
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length || headers.some(h => !COLUMNS.includes(h))) throw new Error('列名が不正です。専用CSVの列名を使用してください');
  if (rows.length > 100) throw new Error('1回100件以内にしてください');
  return rows.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`${i + 2}行目の列数が一致しません`);
    return Object.fromEntries(headers.map((header, j) => [header, cells[j]]));
  });
}
export function writeCsv(rows) {
  // 表計算ソフトで開いた時の数式実行を防ぐ。JSON控えは原文のまま保持する。
  const escape = value => '"' + String(value ?? '').replace(/^(\s*)([=+@-])/, "$1'$2").replaceAll('"', '""') + '"';
  return '\uFEFF' + [COLUMNS, ...rows.map(row => COLUMNS.map(column => row[column] ?? ''))].map(row => row.map(escape).join(',')).join('\r\n');
}
