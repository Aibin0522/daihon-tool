/**
 * LLM adapter層。現行 daihon-generate.js の callClaude / parseJson を移植。
 * Anthropic API直叩き(既存のANTHROPIC_API_KEYをそのまま使用)。
 * モデルは wrangler.toml の LLM_MODEL で交換可能。
 */

export async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  useSearch: boolean,
  maxTokens: number,
  temperature?: number
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    // プロンプトキャッシュ: 大きく静的なルール文(システムプロンプト)をキャッシュ対象にする。
    // 数分以内の連続生成で入力コストが約90%オフ。出力内容・品質は不変。
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  };
  if (typeof temperature === "number") body.temperature = temperature;
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  // 過負荷(429/5xx/529)は指数バックオフで自動リトライ。同時生成時のレート制限対策。
  const maxTries = 5;
  let lastErr = "API error";
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 529) {
      lastErr = `HTTP ${res.status} (overloaded)`;
      const waitMs = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 500);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message || "API error");
    return (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text ?? "")
      .join("");
  }
  throw new Error(lastErr);
}

/**
 * LLM出力からJSONを取り出す。崩れたJSONを段階的に修復して復元を試みる。
 * よくある崩れ: 末尾カンマ / 配列・オブジェクト要素間のカンマ抜け。
 */
export function parseJson<T>(raw: string): T {
  let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json braces");
  s = s.slice(start, end + 1);

  // 要素間のカンマ抜けを補う（改行をまたぐ場合のみ。既存カンマは "," が \s に含まれず二重化しない）
  const insertCommas = (x: string): string =>
    x
      .replace(/"(\s*\n\s*)"/g, '",$1"') // "..." 改行 "..."（文字列配列・キー/値の区切り抜け）
      .replace(/(\}|\]|true|false|null|-?\d+(?:\.\d+)?)(\s*\n\s*)(")/g, "$1,$2$3") // 値 改行 "..."
      .replace(/(\})(\s*\n\s*)(\{)/g, "$1,$2$3") // } 改行 {
      .replace(/(\])(\s*\n\s*)(\[)/g, "$1,$2$3"); // ] 改行 [

  const repairs: ((x: string) => string)[] = [
    x => x,
    x => x.replace(/,(\s*[}\]])/g, "$1"), // 末尾カンマ除去
    x => insertCommas(x), // カンマ抜け補完
    x => insertCommas(x).replace(/,(\s*[}\]])/g, "$1"), // 併用
  ];

  let lastErr: unknown;
  for (const fix of repairs) {
    try {
      return JSON.parse(fix(s)) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("JSON parse failed");
}

/**
 * JSON生成専用ヘルパー。生成→parseを最大3回試行し、失敗時は温度を下げ、
 * 「厳密に有効なJSONのみ」を強めて再生成する。これでLLMのJSON崩れをジョブ失敗にしない。
 */
export async function generateJson<T>(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  useSearch: boolean,
  maxTokens: number
): Promise<T> {
  const attempts = [
    { temperature: 0.6, extra: "" },
    { temperature: 0.2, extra: "\n\n【重要・再送】前回の出力はJSONとして不正でした（カンマ抜け等）。説明文やコードブロック記号を付けず、{で始まり}で終わる、厳密に有効なJSONだけを返してください。" },
    { temperature: 0.0, extra: "\n\n【最終・厳守】有効なJSONのみを返すこと。全ての配列・オブジェクト要素はカンマで正しく区切ること。末尾カンマ禁止。" },
  ];
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      const raw = await callClaude(apiKey, model, system, user + a.extra, useSearch, maxTokens, a.temperature);
      return parseJson<T>(raw);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("JSON generation failed");
}
