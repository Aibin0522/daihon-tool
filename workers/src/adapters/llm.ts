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
  maxTokens: number
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
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

/** 現行 parseJson と同一挙動 */
export function parseJson<T>(raw: string): T {
  let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json braces");
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")) as T;
  }
}
