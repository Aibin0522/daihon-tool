// api/daihon-generate.js  (v3)
// task=hearing: 店URL/店名 → Web検索 → ヒアリング下書きJSON
// task=script : ヒアリングデータ → 台本JSON(単発)
// task=pack   : ヒアリングデータ → 6案パック(A×3・B×3・投下順)
// APIキーはVercel環境変数 ANTHROPIC_API_KEY に設定

export const config = { maxDuration: 60 }

// ── 統合プレイブック準拠の共通ルール ──
const CORE_RULES = `
## テロップ絶対ルール
- 1枚15文字以内が絶対上限(最適10文字前後)。全テロップを数えてから出力
- 15秒=10〜12枚 / 17秒=12〜14枚 / 25秒=18〜22枚 / 35秒=28〜32枚。1カット約1〜1.5秒

## 8割の壁(最重要)
第1幕(0-3秒)のテロップは視聴者の80%が1秒で理解できる言葉のみ。専門用語・銘柄・産地・部位名は第2幕以降かキャプションで回収する。
言い換え辞書の考え方(この店に該当すれば必ず適用):
- 希少部位の固有名詞(コウネ/マルカワ/ヒウチ等)→ 1秒目では「広島名物」「希少部位」。第2幕で「牛一頭から2kgだけ」など数字で回収
- 映えメニューの固有名詞(コーンユッケ等)→「アイスみたいなユッケ」のように見た目の比喩で言い換え
- 料理ジャンルの専門用語(広東料理/XO醤/品種名等)→「広島のお米」のように日常語に置換
- 1秒目に置いてよいのは「数字」「地名」「誰でも知る一般名詞」「呼びかけ」

## ネガ→ポジ(強み×ネガ交互)
中盤に1〜2箇所ネガを挟み、必ず3カット以内にヒアリングの事実の強みで回収する。カット表のネガは is_nega=true。
- Aタイプ(ume)は率直なネガOK(「正直、深夜に罪深い」等)
- Bタイプ(店舗公式)は自己開示型で品位を保つ(「見た目は遊んでますが→味は大真面目です」)

## 5幕構成
第1幕フック(0-3秒)/第2幕権威・文脈(3-8秒)/第3幕シズル・本題(8-20秒)/第4幕回収・保証(20-25秒)/第5幕情報・CTA(キャプション)。15秒尺は フック0-3/権威3-6/シズル6-12/回収12-15 に圧縮。

## 事実の創作禁止
ヒアリングにない数字・経歴・受賞歴は使わない。不明は〔要確認〕を付ける。

## アカウントタイプ
- A(インフルエンサー用/@ume__gourmet): 第三者視点。ネガ訴求・価格言及・煽りOK。CTAは推薦形・保存誘導(「保存して夜中に見て」)
- B(店舗公式用): ブランディング毀損禁止(過度な自画自賛・自虐・安売り・他店比較・予約困難の誇示)。CTAは事実・実用情報(「本日も朝まで営業中」)。勝ちパターンフックを優先:
  1. 地域呼びかけ型(「流川で飲む皆さまへ」)— 対象を店の武器に合わせ絞るほど刺さる
  2. 実は型・自己開示(「実は当店、朝4時まで」)— 控えめな入りで品位を保つ。2連発も有効
  3. 立地キャッチ型(「胡町電停から徒歩3分」)— 駅/電停/目印+道中POVで来訪導線と保存
`

const PATTERN_LIST = `構文パターン10種:
1 ギャップ構文型「〇〇なのに〇〇」 / 2 結局これが一番型 / 3 騙されたと思って型 / 4 数字・スコア型 / 5 有名人権威型 / 6 ネガティブ→回収型 / 7 権威+意外性型 / 8 逆境サバイバル型 / 9 沼る・中毒性型 / 10 保証型`

const CUT_SCHEMA = `"cuts": [{"time":"0-1.5秒","footage":"映像(撮影指示)","telop":"テロップ(15字以内)","narration":"","is_nega":false}]`

const SINGLE_SYSTEM = `あなたは株式会社Aibinのリール台本ディレクターです。ヒアリングデータから統合プレイブックv1.5準拠の台本を1本作ります。
${CORE_RULES}
${PATTERN_LIST}

出力はJSONのみ(前置き・コードブロック記号なし):
{
  "pattern": "使用構文パターン名",
  "pattern_reason": "選定理由1行",
  "hooks": ["冒頭フック案1(映像の見せ方込み)", "案2"],
  "catchcopies_8wari": [{"text":"","chars":0},{"text":"","chars":0},{"text":"","chars":0}],
  "catchcopies_gyokai": [{"text":"","chars":0},{"text":"","chars":0}],
  ${CUT_SCHEMA},
  "caption_skeleton": "キャプション骨子(店舗情報ブロック+CTA+ハッシュタグ)",
  "weapon_explanation": "使用した武器・構文の説明(なぜこの構成か。ネガ回収位置・8割の壁対応にも触れる)",
  "missing_footage": ["追加で撮ると良い素材(なければ空)"]
}`

const PACK_SYSTEM = `あなたは株式会社Aibinのリール台本ディレクターです。1つの店舗につき、高頻度投稿に対応する「6案パック」を作ります。
${CORE_RULES}
${PATTERN_LIST}

## 6案パックの設計思想(最重要)
- A(インフルエンサー用/ume)を3案、B(店舗公式用)を3案、計6案
- 6案すべてフックの構文パターンを変える(視聴者の飽き防止)。同じ型を2度使わない
- Bタイプの3案は勝ちパターン(地域呼びかけ型/実は型/立地キャッチ型)を基本に据える
- 各案で主役の素材・切り口を変え、同じ店を6通りの角度から見せる
- 投下順を提示: A-1→B-1→A-2→B-2→A-3→B-3 の交互で、A同士・B同士の型が連続しないように

各案は単発台本と同じ構造を持つ。

出力はJSONのみ(前置き・コードブロック記号なし):
{
  "strategy_summary": "この店を何で戦うか1行",
  "post_order": ["A-1","B-1","A-2","B-2","A-3","B-3"],
  "cases": [
    {
      "label": "A-1",
      "type": "A",
      "pattern": "使用構文パターン名",
      "hook": "1秒目フック(8割の壁準拠)",
      "catchcopies_8wari": [{"text":"","chars":0}],
      ${CUT_SCHEMA},
      "caption_skeleton": "キャプション骨子",
      "weapon_explanation": "使用した武器・構文の説明"
    }
  ]
}
casesは必ずA-1,A-2,A-3,B-1,B-2,B-3の6件。labelとtypeを正しく設定。`

const HEARING_SYSTEM = `あなたは株式会社Aibin(広島の飲食店SNS運用会社)のリサーチャーです。
店舗のURLまたは店名を受け取り、Web検索で店を特定し、リール台本制作用のヒアリング下書きを作ります。
- 事実の創作は絶対禁止。Webで確認できた情報のみ記載し、不確かな情報は missing に回す
- 8割の壁: hooks_8wari はReels視聴者の80%が1秒で理解できる言葉のみ。専門用語版は hooks_gyokai へ
- ネガポジ: その店の事実の強みで回収できるネガ→ポジのセット
- 同名店に注意。地名とセットで特定

必ず以下のJSONのみで出力(前置き・コードブロック記号なし):
{
  "store": {"name":"","area":"","genre":"","address":"","phone":"","hours":"","holiday":"","access":"","budget":""},
  "weapons": ["主要武器3〜5個(事実ベース)"],
  "top5": ["最重要ポイント5つ(撮影可否確認等の戦略要点)"],
  "negapoji": [{"nega":"","posi":""}],
  "target": "ターゲット×シーン",
  "hooks_8wari": ["8割版フック3つ"],
  "hooks_gyokai": ["業界版2つ"],
  "avoid_words": ["1秒目に出してはいけない語"],
  "iikae": [{"word":"専門用語","say":"8割版の言い換え"}],
  "missing": ["🔴訪問時に必ず確認(撮影可否Q34/35・NGワードQ37・主役の一皿Q19は必ず含める)"]
}`

async function callClaude(system, user, useSearch, maxTokens) {
  const body = { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'API error')
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
}

function parseJson(raw) {
  let s = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = s.indexOf('{'), end = s.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no json braces')
  s = s.slice(start, end + 1)
  try { return JSON.parse(s) } catch { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')) }
}

function hearingBlock(input) {
  return `【ヒアリングデータ】
${JSON.stringify(input.hearing, null, 1)}

【指定】
尺: ${input.duration || '15秒前後'}
${input.material?.trim() ? `\n【撮影済み素材メモ(この素材にある映像だけで構成)】\n${input.material}` : ''}
${input.seasonal?.trim() ? `\n【今回の狙い・季節/限定訴求】\n${input.seasonal}` : ''}
${input.extraRules?.trim() ? `\n【追加テンプレートルール(必ず従う)】\n${input.extraRules}` : ''}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY が未設定です' })
  try {
    let { task, input } = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))

    if (task === 'hearing') {
      if (!input?.query?.trim()) return res.status(400).json({ error: '店舗URLまたは店名が空です' })
      let query = input.query.trim()
      const gm = query.match(/[?&]q=([^&]+)/)
      if (gm) { try { query = decodeURIComponent(gm[1].replace(/\+/g, ' ')) } catch {} }
      const user = `この店を特定してヒアリング下書きを作って:\n${query}\n※広島県の店の可能性が高い。同名店に注意。Web検索は2回までに抑え、分かったら速やかにJSON出力。`
      const raw = await callClaude(HEARING_SYSTEM, user, true, 3000)
      return res.status(200).json({ hearing: parseJson(raw) })
    }

    if (task === 'script') {
      if (!input?.hearing) return res.status(400).json({ error: 'ヒアリングデータがありません' })
      const at = input.accountType === 'B' ? 'B(店舗公式用)' : 'A(インフルエンサー用/ume)'
      const pt = input.pattern || 'おまかせ(ヒアリングから最適を選ぶ)'
      const user = `${hearingBlock(input)}\nアカウントタイプ: ${at}\n構文パターン: ${pt}\n\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`
      const raw = await callClaude(SINGLE_SYSTEM, user, false, 2500)
      try { return res.status(200).json({ script: parseJson(raw) }) }
      catch { return res.status(200).json({ parseError: true, raw: raw.slice(0, 800) }) }
    }

    if (task === 'pack') {
      if (!input?.hearing) return res.status(400).json({ error: 'ヒアリングデータがありません' })
      const user = `${hearingBlock(input)}\n\nこの店の6案パック(A×3・B×3)を作って。6案すべてフックの型を変え、投下順も提示。\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`
      const raw = await callClaude(PACK_SYSTEM, user, false, 6000)
      try { return res.status(200).json({ pack: parseJson(raw) }) }
      catch { return res.status(200).json({ parseError: true, raw: raw.slice(0, 1000) }) }
    }

    return res.status(400).json({ error: 'unknown task' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
