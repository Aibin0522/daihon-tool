// api/daihon-generate.js  (Vercel版)
// task=hearing: 店URL/店名 → Web検索 → ヒアリング下書きJSON
// task=script : ヒアリングデータ → プレイブックv1.5準拠の台本JSON
// APIキーはVercel環境変数 ANTHROPIC_API_KEY に設定(コードに書かない)

// Vercelのタイムアウトを60秒に設定(無料枠でも有効)
export const config = { maxDuration: 60 }

const HEARING_SYSTEM = `あなたは株式会社Aibin(広島の飲食店SNS運用会社)のリサーチャーです。
店舗のURLまたは店名を受け取り、Web検索で店を特定し、リール台本制作用のヒアリング下書きを作ります。
統合プレイブックのルール:
- 事実の創作は絶対禁止。Webで確認できた情報のみ記載し、不確かな情報は fields に入れず missing に回す
- 8割の壁: hooks_8wari はReels視聴者の80%が1秒で理解できる言葉のみ(専門用語・銘柄・固有名詞NG)。専門用語版は hooks_gyokai へ
- ネガポジ: その店の事実の強みで回収できるネガ→ポジのセットを作る(盛らない)
- 同名店に注意。地名とセットで特定する

必ず以下のJSONのみで出力(前置き・コードブロック記号なし):
{
  "store": {"name":"正式店名","area":"エリア","genre":"業態","address":"","phone":"","hours":"","holiday":"","access":"","budget":""},
  "weapons": ["主要武器を3〜5個(事実ベース)"],
  "top5": ["この店の最重要ポイント5つ(撮影可否確認など戦略上の要点)"],
  "negapoji": [{"nega":"","posi":""}, {"nega":"","posi":""}, {"nega":"","posi":""}],
  "target": "ターゲット×シーン(1動画1ターゲットの想定)",
  "hooks_8wari": ["8割版フック案を3つ"],
  "hooks_gyokai": ["業界版(専門用語含む)を2つ"],
  "avoid_words": ["1秒目に出してはいけない語(この店の場合)"],
  "missing": ["🔴訪問時に必ず確認すべきこと(撮影可否Q34/35・NGワードQ37・主役の一皿Q19は必ず含める)"]
}`

const SCRIPT_SYSTEM = `あなたは株式会社Aibinのリール台本ディレクターです。渡されたヒアリングデータを使い、統合プレイブックv1.5準拠の台本を作ります。

## 絶対ルール
1. テロップは1枚15文字以内が絶対上限(最適は10文字前後)。全テロップを数えてから出力する
2. 8割の壁: 第1幕(0-3秒)のテロップは視聴者の8割が1秒で理解できる言葉のみ。専門用語・銘柄・固有名詞は第2幕以降かキャプションへ
3. 5幕構成: 第1幕フック(0-3秒)/第2幕権威・文脈(3-8秒)/第3幕シズル・本題(8-20秒)/第4幕回収・保証(20-25秒)/第5幕情報・CTA(キャプション)。15秒尺は フック0-3/権威3-6/シズル6-12/回収12-15 に圧縮
4. 強み×ネガポジ交互: ネガは必ず3行(3カット)以内にヒアリングデータの事実の強みで回収。回収しない単発ネガは1〜2個まで。カット表でネガのカットは is_nega=true にする
5. テロップ枚数の目安: 15秒=10〜12枚/17秒=12〜14枚/25秒=18〜22枚/35秒=28〜32枚。1カット約1〜2秒
6. 「…」「けど」「だけど」で次カットへ引っ張る継ぎを使う
7. 事実の創作禁止。ヒアリングデータにない数字・経歴は使わず、必要なら〔要確認〕を付ける
8. 撮影済み素材メモが渡された場合: その素材にある映像だけでカット表を構成し、足りないものは missing_footage へ

## アカウントタイプ
- A(インフルエンサー用/@ume__gourmet): 第三者視点。ネガ訴求・価格言及・煽りOK(「予約は取れない」等)。CTAは推薦形・保存誘導
- B(店舗公式用): ブランディング毀損禁止(過度な自画自賛・自虐・安売り訴求・他店比較・予約困難の誇示)。ネガは自己開示型で品位を保つ(弱み→こだわりの理由に変換)。CTAは事実・実用情報。勝ちパターンフック: 地域呼びかけ型/実は型/立地キャッチ型を優先

## 出力(JSONのみ・コードブロック記号なし)
{
  "pattern": "使用した構文パターン名",
  "pattern_reason": "選定理由1行",
  "hooks": ["冒頭フック案1(映像の見せ方込み)", "案2"],
  "catchcopies_8wari": [{"text":"","chars":0},{"text":"","chars":0},{"text":"","chars":0}],
  "catchcopies_gyokai": [{"text":"","chars":0},{"text":"","chars":0}],
  "cuts": [{"time":"0-1.5秒","footage":"映像(撮影指示)","telop":"テロップ","note":"編集メモ(SE/ズーム等)","is_nega":false}],
  "caption_skeleton": "キャプション骨子(店舗情報ブロック+CTA。ハッシュタグ込み)",
  "missing_footage": ["追加で撮ると良い素材(なければ空)"]
}`

async function callClaude(system, user, useSearch, maxTokens) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  }
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'API error')
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
}

function parseJson(raw) {
  let s = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no json braces')
  s = s.slice(start, end + 1)
  try {
    return JSON.parse(s)
  } catch {
    return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1'))
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が未設定です' })
  }
  try {
    let { task, input } = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))

    if (task === 'hearing') {
      if (!input?.query?.trim()) return res.status(400).json({ error: '店舗URLまたは店名が空です' })
      let query = input.query.trim()
      const gm = query.match(/[?&]q=([^&]+)/)
      if (gm) { try { query = decodeURIComponent(gm[1].replace(/\+/g, ' ')) } catch {} }
      const user = `この店を特定してヒアリング下書きを作って:\n${query}\n※広島県の店の可能性が高い。同名店に注意。Web検索は2回までに抑え、店名・場所・主要メニューが分かったら速やかにJSONを出力すること。`
      const raw = await callClaude(HEARING_SYSTEM, user, true, 3000)
      return res.status(200).json({ hearing: parseJson(raw) })
    }

    if (task === 'script') {
      if (!input?.hearing) return res.status(400).json({ error: 'ヒアリングデータがありません' })
      const user = `【ヒアリングデータ】
${JSON.stringify(input.hearing, null, 1)}

【指定】
アカウントタイプ: ${input.accountType === 'B' ? 'B(店舗公式用)' : 'A(インフルエンサー用/@ume__gourmet)'}
構文パターン: ${input.pattern || 'おまかせ(ヒアリングデータから最適を選ぶ)'}
尺: ${input.duration || '25秒前後'}
${input.material?.trim() ? `\n【撮影済み素材メモ(この素材だけで構成する)】\n${input.material}` : ''}
${input.extraRules?.trim() ? `\n【追加テンプレートルール(必ず従う)】\n${input.extraRules}` : ''}

重要: 説明文やコードブロック記号を一切付けず、{ で始まり } で終わるJSONだけを出力すること。`
      const raw = await callClaude(SCRIPT_SYSTEM, user, false, 2500)
      let script
      try {
        script = parseJson(raw)
      } catch {
        return res.status(200).json({ parseError: true, message: 'AIの出力がJSON形式になりませんでした', raw: raw.slice(0, 800) })
      }
      return res.status(200).json({ script })
    }

    return res.status(400).json({ error: 'unknown task' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
