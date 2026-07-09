// api/daihon-generate.js  (v3)
// task=hearing: 店URL/店名 → Web検索 → ヒアリング下書きJSON
// task=script : ヒアリングデータ → 台本JSON(単発)
// task=pack   : ヒアリングデータ → 6案パック(A×3・B×3・投下順)
// APIキーはVercel環境変数 ANTHROPIC_API_KEY に設定

export const config = { maxDuration: 60 }

// ── 統合プレイブック準拠の共通ルール ──
const CORE_RULES = `
## フックの大原則(最重要)
- ネガ・権威性・強み・数字など「一番強い要素」は中盤に温存せず、冒頭0-4秒に前倒しして興味を作る。台本の後半で初めて武器が出てくる構成は禁止
- 抽象的な比喩・詩的表現(「宝石」「芸術品」「魔法のような」等)を冒頭に置くのは禁止。共感も親近感も湧かない。フックは必ず具体(地名・料理名・数字・価格・呼びかけ・視聴者の心の声の代弁)で組む
- 「美味しい」は使わない。「とろける」「ぷりぷり」「じゅんわり」「コク深い」など食感・温度感が伝わるシズルワードに置き換える

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

const PATTERN_LIST = `構文パターン16種:
1 ギャップ構文型「〇〇なのに〇〇」 / 2 結局これが一番型 / 3 騙されたと思って型 / 4 数字・スコア型 / 5 有名人権威型 / 6 ネガティブ→回収型 / 7 権威+意外性型 / 8 逆境サバイバル型 / 9 沼る・中毒性型 / 10 保証型 / 11 ギャップ裏切り型 / 12 常識破壊型 / 13 思い込み裏切り型(価格特化) / 14 感覚崩壊型(ビジュアル衝撃) / 15 機会損失型(ついで提案) / 16 労力正当化型(わざわざ型)

## 構文11「ギャップ裏切り型」(ume__gourmet実証済み・100万再生の主力型)
核心: 価格や安さそのものではなく「視聴者の思い込み→裏切り」の感情の落差が主役。落差が大きいほど視聴維持・コメントが伸びる。
必ずこの順で組む:
(1) 0-2秒: 誰でも分かる映像+テロップで思い込みの種を蒔く(例「海老そば880円とか」)。1秒目は料理名+数字など8割が即理解できる情報
(2) 2-4秒: 視聴者の心の声をセリフ化して代弁(例「"どうせ高いんやろ?"って思ったら」)。この"〜って思ったら"のセリフ化が肝。視聴者が自分ごと化して離脱しない
(3) 4-6秒: 予想を明確に裏切る(例「まさかの大誤算でした」)。ここで引きを最大化
(4) 6-20秒: 裏切りを裏付ける事実を畳みかける(品×価格、ボリューム、こだわり)
(5) 締め: こだわり/権威でダメ押し+CTA(保存・来店)
注意: 「安い」を連呼するのではなく、"疑い"を作って"裏切る"設計にすること。ギャップの対象は価格に限らず応用可。

## 構文12「常識破壊型」(再現性テンプレ)
向く店: 業界の常識・定番を覆す商品(デカ盛り・溢れる系・ありえない組み合わせ)。
フック例: 「これは非常識やろ」「正直、やりすぎやろ」「最初は"絶対売れない"と言われた」「ルール違反やろ」
構成: 冒頭0-3秒で[地名]+非常識フック(オープン当初に言われた批判でも可)→ 商品の全体像とダイナミックな調理 → 職人の手元・素材 → 割る/持ち上げるシズル →「[業界の常識]が定番の中、と言われても」→ [地名]を代表する[素材]を主役にした想い → 締めは来店呼びかけ。批判された過去→現在の人気で回収するストーリー仕立て。

## 構文13「思い込み裏切り型(価格特化)」(構文11の価格特化版)
向く店: 高級そうに見えて安い/安っぽく見えて本格派。コスパと職人技を訴えたい店。
フック例: 「どうせ高いんやろ?って思ったら、まさかの大誤算でした」「"ただの安い店"って舐めてたら、衝撃受けました」「絶対[高い金額]円はすると思ったら…」「本当は教えたくない、価格破壊のお店」
構成: 冒頭0-4秒「待って。[地名]で[フック]」→ 複数メニューを価格付きでテンポよく連打「[メニューA]は[価格]円、[メニューB]は[価格]円とか破格すぎる」→ 厨房の本格調理(炎・包丁・出汁)+[料理人の肩書・経歴]で権威 → 食べる直前シズル+味の言語化 → 締め「このクオリティをリーズナブルに楽しめるとか、ぜひチェックしてね」。

## 構文14「感覚崩壊型(ビジュアル衝撃)」
向く店: 溢れるチーズ・滴る肉汁・どっぷりソースなど視覚インパクトが強烈な商品。理屈でなく本能に訴える。
フック例: 「こんな[商品名]出されたら、脳がバグってしまうやつ」「カロリーの暴力すぎる…」「見たら最後、絶対行きたくなる」「ダイエット中の方は見ないでください」
構成: 冒頭0-4秒は商品を割る/ソースが溢れる/チーズが伸びる超ドアップ+「ちょっと待って。[地名]でさすがに[フック]」→ 立地情報を早めに挟む([主要駅]から[時間]分)→「やりすぎ感」のある工程(ソースに浸す/クリームを詰める)→ 断面強調 → トッピング・別メニュー → 締め「[味の特徴]がヤミツキ。[ターゲット層]は絶対チェックしてて」。

## 構文15「機会損失型(ついで提案)」
向く店: 観光地・アウトレット・大型施設の近くの店。既存の行動に「行かないと損」を乗せる。
フック例: 「[施設名]だけで帰るのは、さすがにもったいない」「[施設名]行くなら、知らないと絶対損するお店」「[施設名]の帰りは、絶対ここに寄って」「[地名]に来て、ここ行かない人いるの?」
構成: 冒頭0-5秒で[施設名]とセットのフック+「だって[施設名]から車で[時間]分に」→ 目玉商品A/Bのアップ →大きさ比較・職人の手元+産地こだわり → 食べる直前カット+食感言語化 → トッピング・小鉢の豊富さ → 締め「[施設名]行くなら立ち寄って欲しいから要チェック」。

## 構文16「労力正当化型(わざわざ型)」
向く店: 立地が悪い・遠い・並ぶなどのデメリットを逆手に取る目的店(デスティネーション)。
フック例: 「[中心地]から高速使ってでも行きたい」「2時間並んでも食べる価値がある」「ぶっちゃけ遠いけど、絶対行くべきお店」「わざわざ行く価値しかない、隠れ家すぎる名店」
構成: 冒頭0-5秒は外観(隠れ家感)から料理の超ドアップへ一気に+フック → [有名観光地]から[時間]分の位置情報 → 素材の新鮮さ・調理の丁寧さ → 盛り合わせ・豪華メニュー勢揃い → 出汁をかける湯気シズル → 締め「ぶっちゃけ[デメリット]けど、立ち寄って損はないけん、保存してね」。デメリットの明言→期待値の最大化が核。`

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

const PACK_SYSTEM = `あなたは株式会社Aibinのリール台本ディレクターです。1つの店舗につき、指定タイプの3案パックを作ります。
${CORE_RULES}
${PATTERN_LIST}

## 3案パックの設計思想(最重要)
- 指定されたタイプ(AまたはB)の台本を3案作る
- 3案すべてフックの構文パターンを変える(視聴者の飽き防止)。同じ型を2度使わない
- Bタイプの場合は勝ちパターン(地域呼びかけ型/実は型/立地キャッチ型)を基本に据える
- 各案で主役の素材・切り口を変え、同じ店を3通りの角度から見せる

各案は単発台本と同じ構造を持つ。

出力はJSONのみ(前置き・コードブロック記号なし):
{
  "strategy_summary": "この店を何で戦うか1行",
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
casesは必ず3件。labelは指定タイプに応じてA-1〜A-3またはB-1〜B-3。typeも正しく設定。`

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
      const packType = input.packType === 'B' ? 'B(店舗公式用)' : 'A(インフルエンサー用/ume)'
      const user = `${hearingBlock(input)}\n\nこの店の${packType}の3案を作って。3案すべてフックの型を変える。\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`
      const raw = await callClaude(PACK_SYSTEM, user, false, 3500)
      try { return res.status(200).json({ pack: parseJson(raw) }) }
      catch { return res.status(200).json({ parseError: true, raw: raw.slice(0, 1000) }) }
    }

    return res.status(400).json({ error: 'unknown task' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
