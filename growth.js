(() => {
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const field = (id, label, type = 'text', extra = '') => `<label>${label}<input id="${id}" type="${type}" ${extra}></label>`;
  const select = (id, label, options) => `<label>${label}<select id="${id}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
  const genreOptions = ['パン・焼き菓子', 'カフェ・スイーツ', 'ランチ・定食', '焼肉・肉料理', '居酒屋', '和食', '麺類', 'まとめ・アカウント紹介', 'その他'];
  byId('tabBtn-tpl').insertAdjacentHTML('afterend', '<button id="tabBtn-growth">④ 投稿実績</button>');
  byId('tab-script').querySelector('.card').insertAdjacentHTML('afterbegin', `<div class="growth-box">
    <h2 style="font-size:18px;margin:0 0 8px">実績を次の台本へ</h2>
    <p class="growth-note">同じアカウント・ジャンル・視点・尺帯・配信条件・目的・観測期間の投稿を参考にします。実績がなくても生成ルールは使えます。</p>
    <div class="growth-grid">
      ${field('gAccount', 'Instagramアカウント名', 'text', 'placeholder="@アカウント名"')}
      ${select('gGenre', '比較ジャンル', genreOptions.map(g => [g, g]))}
      ${select('gGoal', '今回の目的', [['reach', 'リーチを伸ばす'], ['saves', '保存率を上げる'], ['shares', 'シェア率を上げる'], ['follows', 'フォロー率を上げる']])}
      ${select('gDistribution', '配信条件', [['organic', '通常投稿'], ['paid', '広告あり'], ['collab', '共同投稿']])}
      ${select('gDays', '比較する取得時点', [['7', '投稿から7日後'], ['1', '投稿から1日後'], ['30', '投稿から30日後']])}
      ${select('gAuto', '3案生成時の構成選び', [['auto', 'ヒアリング・実績から選ぶ'], ['manual', '下で指定した3型を使う']])}
    </div>
    <label class="growth-field">訪問・店舗確認済みの事実と根拠（任意）<textarea id="gFacts" rows="3" placeholder="例：確認したメニュー名・税込価格・確認日・公式URL。未確認の情報はヒアリング側に残してください。"></textarea></label>
    <div class="growth-actions"><button type="button" id="gPreview">生成前の参照内容を確認</button><button type="button" id="gDownloadPrompt">生成用指示書を保存</button></div>
    <div id="gPromptError" class="growth-error" role="status"></div><div id="gPrompt" class="growth-output" hidden></div>
  </div>`);
  byId('tab-tpl').insertAdjacentHTML('afterend', `<div id="tab-growth" style="display:none"><div class="card">
    <h2>投稿実績を記録する</h2>
    <p class="growth-note">採用レビューと投稿成果を分けて蓄積します。未取得の数字は空欄のままにしてください。保存・シェア・フォローの率はリーチを分母に計算します。</p>
    <div class="growth-box"><div id="gContextLabel" class="growth-message"></div><div class="growth-actions"><button type="button" id="gEditContext">比較条件を変更</button><button type="button" id="gReload">実績を読み込む</button></div></div>
    <div id="gSummary" class="growth-summary"><div class="growth-stat">比較対象<strong>—</strong></div><div class="growth-stat">実績の取得<strong>手入力 / CSV</strong></div><div class="growth-stat">自動評価<strong>未判定</strong></div></div>
    <div id="gInsight" class="growth-note">比較条件を設定すると、登録済みの実績を確認できます。</div>
    <div id="gMessage" class="growth-error" role="status"></div>
    <div class="growth-box"><h3 style="margin-top:0">1投稿の実績を追加</h3>
      <label class="growth-field">元になった台本（任意）<select id="gScript"><option value="">過去の投稿・ツール外で作った台本</option></select></label>
      <div class="growth-grid" style="margin-top:14px">
        <label class="wide">投稿URL<input id="gPostUrl" type="url" placeholder="https://www.instagram.com/reel/…/"></label>
        ${field('gStore', '店舗名 / まとめの名称')}${field('gPattern', '構文・訴求の型', 'text', 'placeholder="例：価格訴求、断面から導入"')}${field('gActualDuration', '実際の動画尺（秒）', 'number', 'min="1" max="180" step="0.1" value="25"')}
        ${field('gPublished', '投稿した日時', 'datetime-local')}${field('gMeasured', '数字を取得した日時', 'datetime-local')}
        <div class="growth-note" style="align-self:end">日時は端末のタイムゾーンで入力。比較対象は選択した日数から24時間以内の観測です。</div>
        ${field('gViews', '再生数', 'number', 'min="0" step="1"')}${field('gReach', 'リーチ', 'number', 'min="0" step="1"')}${field('gSaves', '保存数', 'number', 'min="0" step="1"')}
        ${field('gShares', 'シェア数', 'number', 'min="0" step="1"')}${field('gFollows', 'この投稿経由のフォロー数', 'number', 'min="0" step="1"')}${field('gWatch', '平均視聴時間（秒）', 'number', 'min="0" step="0.1"')}
      </div>
      <label class="growth-field">実際に投稿した最終台本<textarea id="gFinalText" rows="6" placeholder="生成後に変更した部分も含めて、投稿時の文章を残します。"></textarea></label>
      <label class="growth-field">補足メモ<textarea id="gNote" rows="2" placeholder="映像の変更、季節要因など"></textarea></label>
      <div class="growth-actions"><button id="gSave" class="cta" type="button">この実績を保存</button></div>
    </div>
    <div class="growth-actions"><button type="button" id="gCsvTemplate">CSVの列名を取得</button><label class="growth-note">CSVを取り込む<input type="file" id="gImport" accept=".csv,text/csv"></label><button type="button" id="gExport">実績の控えを保存（JSON）</button></div>
    <details><summary>CSVの入力方法</summary><p class="growth-note">account_type は A（インフルエンサー）/ B（店舗公式）、goal は reach / saves / shares / follows、distribution は organic / paid / collab、horizon_days は 1 / 7 / 30。日時は 2026-09-19T12:00:00+09:00 の形式。空欄は未取得です。複数行の台本は引用符で囲んでください。独自の列名や数値の桁区切りには対応していません。</p></details>
    <div id="gRecords" class="growth-table"></div>
  </div></div>`);
  let scripts = [], currentRecords = [], promptText = '';
  const numericFields = { views: 'gViews', reach: 'gReach', saves: 'gSaves', shares: 'gShares', follows: 'gFollows', avg_watch_seconds: 'gWatch' };
  function context() {
    return { account_id: byId('gAccount').value.trim(), account_type: byId('sType').value, genre: byId('gGenre').value, goal: byId('gGoal').value, distribution: byId('gDistribution').value, horizon_days: Number(byId('gDays').value), duration_seconds: Number.parseFloat(byId('sDuration').value) };
  }
  function contextLabel() {
    const c = context(); byId('gContextLabel').textContent = `比較条件：${c.account_id || 'アカウント未指定'} / ${c.genre} / ${byId('sType').selectedOptions[0].textContent} / ${byId('gGoal').selectedOptions[0].textContent} / ${byId('gDistribution').selectedOptions[0].textContent} / ${c.duration_seconds}秒前後 / ${c.horizon_days}日後`;
  }
  async function request(action, method = 'GET', body, query = '') {
    const response = await fetch(`/api/growth?action=${action}${query}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '処理に失敗しました'); return result;
  }
  const format = value => value === null || value === undefined ? '未取得' : Number(value).toLocaleString('ja-JP');
  const percent = value => value === null ? '—' : `${(value * 100).toFixed(2)}%`;
  async function loadScripts() {
    scripts = (await request('scripts')).scripts;
    byId('gScript').innerHTML = '<option value="">過去の投稿・ツール外で作った台本</option>' + scripts.map(s => `<option value="${escape(s.id)}">${escape(s.store_name)} / ${escape(s.syntax_pattern)}</option>`).join('');
  }
  async function refresh() {
    contextLabel();
    if (!context().account_id) { byId('gMessage').textContent = '②台本でアカウント名と比較条件を設定してください。'; return; }
    const result = await request('records', 'GET', null, '&' + new URLSearchParams(context()));
    currentRecords = result.records;
    byId('gSummary').innerHTML = `<div class="growth-stat">登録した観測<strong>${result.records.length}件</strong></div><div class="growth-stat">条件が一致した投稿<strong>${result.summary.count}件</strong></div><div class="growth-stat">評価の状態<strong>${result.summary.status === 'insufficient' ? '蓄積中' : '参考比較'}</strong></div>`;
    byId('gInsight').textContent = result.summary.message + (result.limited ? ' 最新500件の観測に限定した集計です。' : '');
    const groupRows = result.summary.groups.map(g => `<tr><td>${escape(g.pattern)}</td><td>${g.count}件</td><td>${context().goal === 'reach' ? format(g.median) : percent(g.median)}</td></tr>`).join('');
    byId('gRecords').innerHTML = `<h3>構文別の参考比較</h3><table><thead><tr><th>構文・訴求</th><th>投稿数</th><th>${escape(result.summary.metric)}の中央値</th></tr></thead><tbody>${groupRows || '<tr><td colspan="3">比較できる実績はまだありません</td></tr>'}</tbody></table><h3>登録済みの観測（このアカウント）</h3><table><thead><tr><th>店舗 / 投稿</th><th>取得日時</th><th>比較日数</th><th>リーチ</th><th>保存</th><th>シェア</th><th>フォロー</th></tr></thead><tbody>${result.records.map(r => `<tr><td><a href="${escape(r.post_url)}" target="_blank" rel="noreferrer">${escape(r.store_name)}</a><br>${escape(r.syntax_pattern)}</td><td>${escape(new Date(r.measured_at).toLocaleString('ja-JP'))}</td><td>${r.horizon_days}日後</td><td>${format(r.reach)}</td><td>${format(r.saves)}</td><td>${format(r.shares)}</td><td>${format(r.follows)}</td></tr>`).join('') || '<tr><td colspan="7">実績は未登録です。架空の数字は入れていません。</td></tr>'}</tbody></table>`;
  }
  async function run(button, target, task) {
    button.disabled = true; byId(target).textContent = '';
    try { await task(); } catch (error) { byId(target).textContent = error.message; } finally { button.disabled = false; }
  }
  function download(name, text, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const inputForGeneration = () => {
    const store = load(K.stores).find(s => s.id === byId('sStore').value);
    return { hearing: store?.hearing ?? {}, accountType: byId('sType').value, duration: byId('sDuration').value, material: byId('sMaterial').value, seasonal: byId('sSeasonal').value, verifiedFacts: byId('gFacts').value, growth: context().account_id ? { ...context(), verified_facts: byId('gFacts').value } : undefined };
  };
  async function preparePrompt() {
    const input = inputForGeneration();
    const result = await request('context', 'POST', input);
    promptText = result.rules + result.block + '\n\n【今回の入力】\n' + JSON.stringify(input, null, 2) + result.output_guide;
    byId('gPrompt').hidden = false; byId('gPrompt').textContent = promptText;
  }
  byId('tabBtn-growth').onclick = () => { showTab('growth'); contextLabel(); run(byId('gReload'), 'gMessage', async () => { await loadScripts(); await refresh(); }); };
  byId('gEditContext').onclick = () => { showTab('script'); byId('gAccount').focus(); };
  byId('gReload').onclick = () => run(byId('gReload'), 'gMessage', refresh);
  byId('gPreview').onclick = () => run(byId('gPreview'), 'gPromptError', preparePrompt);
  byId('gDownloadPrompt').onclick = () => run(byId('gDownloadPrompt'), 'gPromptError', async () => { await preparePrompt(); download('台本生成用指示書.txt', promptText); });
  byId('gScript').onchange = () => {
    const script = scripts.find(s => s.id === byId('gScript').value); if (!script) return;
    byId('gStore').value = script.store_name; byId('gPattern').value = script.syntax_pattern;
    byId('gFinalText').value = script.text; byId('sType').value = script.account_type; contextLabel();
  };
  const now = new Date(); byId('gMeasured').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  byId('gSave').onclick = () => run(byId('gSave'), 'gMessage', async () => {
    const iso = id => { const value = byId(id).value; if (!value) throw new Error('投稿日時と取得日時を入力してください'); return new Date(value).toISOString(); };
    const record = { ...context(), duration_seconds: byId('gActualDuration').value, script_id: byId('gScript').value || null, post_url: byId('gPostUrl').value, store_name: byId('gStore').value, syntax_pattern: byId('gPattern').value, final_text: byId('gFinalText').value, published_at: iso('gPublished'), measured_at: iso('gMeasured'), note: byId('gNote').value, ...Object.fromEntries(Object.entries(numericFields).map(([name, id]) => [name, byId(id).value])) };
    const result = await request('records', 'POST', { records: [record] }); await refresh();
    byId('gMessage').textContent = result.saved ? '実績を保存しました。比較条件・取得時点が一致する投稿に反映されます。' : '同じ内容はすでに保存されています（二重登録していません）。';
  });
  byId('gCsvTemplate').onclick = async () => { const { writeCsv } = await import('/csv.mjs'); download('投稿実績_列名.csv', writeCsv([]), 'text/csv;charset=utf-8'); };
  byId('gImport').onchange = () => run(byId('gSave'), 'gMessage', async () => {
    const file = byId('gImport').files[0]; if (!file) return;
    if (file.size > 131072) throw new Error('CSVは128KB以内にしてください');
    const { parseCsv } = await import('/csv.mjs');
    const rows = parseCsv(await file.text()); const result = await request('records', 'POST', { records: rows });
    if (!byId('gAccount').value && rows[0]) byId('gAccount').value = rows[0].account_id;
    await refresh(); byId('gMessage').textContent = `${result.saved}件を保存しました。重複${result.duplicates}件は追加していません。`;
  });
  byId('gExport').onclick = () => download('投稿実績_控え.json', JSON.stringify({ version: 1, exported_at: new Date().toISOString(), records: currentRecords }, null, 2), 'application/json');
  const originalApi = window.api;
  window.api = async (task, input) => {
    if (task !== 'hearing') {
      input.verifiedFacts = byId('gFacts').value;
      if (context().account_id) input.growth = { ...context(), verified_facts: byId('gFacts').value };
      if (task === 'multi' && byId('gAuto').value === 'auto') input.patterns = [];
    }
    return originalApi(task, input);
  };
  const originalRender = window.renderScript;
  window.renderScript = () => {
    originalRender(); byId('gScriptChecks')?.remove();
    const script = currentScript?.script; if (!script) return;
    const checks = [...(script.quality_checks ?? []), ...(script.missing_facts ?? []).map(x => typeof x === 'string' ? x : JSON.stringify(x))];
    byId('sResult').insertAdjacentHTML('beforeend', `<div id="gScriptChecks" class="growth-box"><strong>生成の根拠・確認事項</strong><p class="growth-note">${escape(script.strategy_reason ?? '旧版の台本のため生成理由は記録されていません。')}</p><p class="growth-note">参照した比較対象：${script.learning_context?.count ?? 0}投稿。検品・事実確認は別途必要です。</p><div class="growth-message">${escape(checks.join('\n') || '自動チェックの追加指摘はありません。事実や映像を確認済みという意味ではありません。')}</div><button id="gUseCurrent" type="button">この台本の投稿実績を記録</button></div>`);
    byId('gUseCurrent').onclick = async () => {
      showTab('growth'); await run(byId('gReload'), 'gMessage', async () => { await loadScripts(); byId('gScript').value = script.script_db_id ?? ''; byId('gScript').onchange(); contextLabel(); await refresh(); });
    };
  };
  function updateAutoLabel() {
    const auto = byId('gAuto').value === 'auto';
    byId('mBtn').textContent = auto ? '実績・ヒアリングを参考に3案を作る' : '選んだ3型を一気に出す';
    for (const id of ['mPat1', 'mPat2', 'mPat3']) byId(id).disabled = auto;
    byId('mBtn').nextElementSibling.textContent = auto ? '3案はヒアリング・素材・条件が一致した実績から構成を選びます。実績が少ない場合は、未検証の仮説として作ります。' : '下で指定した3つの構文を使います。各案のレビューと投稿実績を別々に記録できます。';
  }
  byId('gAuto').onchange = updateAutoLabel; updateAutoLabel();
  contextLabel();
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    document.body.insertAdjacentHTML('afterbegin', '<div id="growthBanner">ローカル確認版：実績と指示書の動作を確認できます。AI生成・本番への保存・公開は行いません。</div>');
    for (const id of ['sBtn', 'mBtn', 'hBtn']) { byId(id).disabled = true; byId(id).title = '本番接続・生成費用の承認後に利用できます'; }
  }
})();
