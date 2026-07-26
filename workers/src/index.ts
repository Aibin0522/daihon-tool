import type { Env, JobMessage, JobRequest, ReviewRequest, PackCase } from "./types";
import { REASON_TAGS } from "./types";
import { generateJson } from "./adapters/llm";
import {
  SINGLE_SYSTEM,
  PACK_SYSTEM,
  HEARING_SYSTEM,
  MULTI_SELECT_SYSTEM,
  PATTERN_CANON,
  PROMPT_VERSION,
  KNOWLEDGE_RULE_VERSION,
} from "./prompts";

// ---------- helpers ----------

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const err = (message: string, status: number) => json({ error: message }, status);

const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 現行 daihon-generate.js の hearingBlock を移植 */
function hearingBlock(input: JobRequest["input"]): string {
  return `【ヒアリングデータ】
${JSON.stringify(input.hearing, null, 1)}

【指定】
尺: ${input.duration || "15秒前後"}
${input.material?.trim() ? `\n【撮影済み素材メモ(この素材にある映像だけで構成)】\n${input.material}` : ""}
${input.seasonal?.trim() ? `\n【今回の狙い・季節/限定訴求】\n${input.seasonal}` : ""}
${input.extraRules?.trim() ? `\n【追加テンプレートルール(必ず従う)】\n${input.extraRules}` : ""}`;
}

function storeNameOf(input: JobRequest["input"]): string | null {
  const h = input.hearing as { store?: { name?: string } } | undefined;
  return h?.store?.name ?? null;
}

// ---------- レビュー燃料(学習ループ) ----------

const TAG_LABEL: Record<string, string> = {
  hook_weak: "冒頭が弱い",
  fact_error: "事実が違う",
  generic: "一般論すぎる",
  tone_mismatch: "らしくない",
  structure_bad: "順番が悪い",
  cta_weak: "CTAが弱い",
  compliance_risk: "表現・権利リスク",
  good_pattern: "勝ちパターン",
};

/** 台本JSON(単発/case両形式)から1秒目フックを取り出す */
function hookOf(body: Record<string, unknown>): string {
  if (typeof body.hook === "string" && body.hook.trim()) return body.hook.trim();
  const hooks = body.hooks;
  if (Array.isArray(hooks) && typeof hooks[0] === "string") return (hooks[0] as string).trim();
  const c8 = body.catchcopies_8wari;
  if (Array.isArray(c8) && c8[0] && typeof (c8[0] as { text?: string }).text === "string") {
    return (c8[0] as { text: string }).text.trim();
  }
  return "";
}

interface FuelRow {
  decision: string;
  reason_tags: string;
  reason_note: string | null;
  after_text: string | null;
  syntax_pattern: string | null;
  body_json: string;
}

/**
 * 全店共通のレビュー履歴から「手本(採用)」と「NG(ボツ)」を抽出し、
 * 生成プロンプトに差し込む学習ブロックを作る。レビューが無ければ空文字。
 */
async function buildFuel(env: Env): Promise<string> {
  let rows: { results?: FuelRow[] };
  try {
    rows = await env.DB.prepare(
      `SELECT r.decision, r.reason_tags, r.reason_note, r.after_text, s.syntax_pattern, s.body_json
       FROM script_reviews r JOIN scripts s ON r.script_id = s.id
       ORDER BY r.created_at DESC LIMIT 60`
    ).all<FuelRow>();
  } catch {
    return "";
  }
  const good: string[] = [];
  const bad: string[] = [];
  for (const r of rows.results ?? []) {
    let tags: string[] = [];
    try { tags = JSON.parse(r.reason_tags) as string[]; } catch { /* ignore */ }
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(r.body_json) as Record<string, unknown>; } catch { /* ignore */ }
    const pat = r.syntax_pattern || (body.pattern as string) || "-";
    const hook = hookOf(body);

    if (r.decision === "adopted" || tags.includes("good_pattern")) {
      if (good.length < 6 && hook) good.push(`・[${pat}] フック「${hook}」`);
    } else if (r.decision === "revised") {
      if (good.length < 6 && r.after_text) {
        const after = r.after_text.split("\n")[0].slice(0, 40);
        good.push(`・[${pat}] 修正後テロップの方向性「${after}」`);
      }
    } else if (r.decision === "rejected") {
      if (bad.length < 6 && hook) {
        const why = tags.map(t => TAG_LABEL[t] || t).filter(Boolean).join("・") || (r.reason_note ?? "");
        bad.push(`・[${pat}] フック「${hook}」は避ける${why ? `(理由: ${why})` : ""}`);
      }
    }
  }
  if (good.length === 0 && bad.length === 0) return "";

  let block = "\n\n## 過去レビューからの学習(全店共通・必ず反映)";
  if (good.length) block += `\n### 手本(採用された良い型・良い直し。この方向を活かす)\n${good.join("\n")}`;
  if (bad.length) block += `\n### 避けるべき例(過去にボツ。同じ轍を踏まない)\n${bad.join("\n")}`;
  return block;
}

// ---------- API (fetch) ----------

async function handleFetch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.API_AUTH_TOKEN}`) return err("unauthorized", 401);

  try {
    // ===== 店舗(D1共有・設計書 Day 6-7) =====
    // GET /api/stores — 一覧
    if (req.method === "GET" && path === "/api/stores") {
      const rows = await env.DB.prepare(
        "SELECT id, name, industry, official_url, hearing_json, updated_at FROM stores WHERE status = 'active' ORDER BY updated_at DESC, created_at DESC"
      ).all();
      return json({ stores: rows.results ?? [] });
    }
    // POST /api/stores — 作成/更新(upsert)。id指定可(端末生成idをそのまま主キーに)
    if (req.method === "POST" && path === "/api/stores") {
      const b = (await req.json()) as { id?: string; name?: string; industry?: string; official_url?: string; hearing?: unknown };
      if (!b.name) return err("name is required", 400);
      const id = b.id || uid("store");
      await env.DB.prepare(
        `INSERT INTO stores (id, name, industry, official_url, status, hearing_json, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, industry=excluded.industry, official_url=excluded.official_url,
           hearing_json=excluded.hearing_json, status='active', updated_at=datetime('now')`
      ).bind(id, b.name, b.industry ?? "food", b.official_url ?? null, b.hearing != null ? JSON.stringify(b.hearing) : null).run();
      return json({ store_id: id }, 201);
    }
    // DELETE /api/stores/:id — 論理削除
    const storeDel = path.match(/^\/api\/stores\/([^/]+)$/);
    if (req.method === "DELETE" && storeDel) {
      await env.DB.prepare("UPDATE stores SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").bind(storeDel[1]).run();
      return json({ ok: true });
    }

    // ===== テンプレート(D1共有) =====
    if (req.method === "GET" && path === "/api/templates") {
      const rows = await env.DB.prepare("SELECT id, name, rules, created_at FROM templates ORDER BY created_at DESC").all();
      return json({ templates: rows.results ?? [] });
    }
    if (req.method === "POST" && path === "/api/templates") {
      const b = (await req.json()) as { id?: string; name?: string; rules?: string };
      if (!b.name || !b.rules) return err("name and rules are required", 400);
      const id = b.id || uid("tpl");
      await env.DB.prepare(
        `INSERT INTO templates (id, name, rules) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, rules=excluded.rules`
      ).bind(id, b.name, b.rules).run();
      return json({ template_id: id }, 201);
    }
    const tplDel = path.match(/^\/api\/templates\/([^/]+)$/);
    if (req.method === "DELETE" && tplDel) {
      await env.DB.prepare("DELETE FROM templates WHERE id = ?").bind(tplDel[1]).run();
      return json({ ok: true });
    }

    // ===== 生成履歴(単発台本・D1共有) =====
    // GET /api/history?limit=30 — 全端末共通の最近の単発台本
    if (req.method === "GET" && path === "/api/history") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 100);
      const rows = await env.DB.prepare(
        `SELECT s.id AS script_db_id, s.body_json, s.account_type, s.created_at, j.store_name
         FROM scripts s JOIN script_jobs j ON s.job_id = j.id
         WHERE j.task = 'script' ORDER BY s.created_at DESC LIMIT ?`
      ).bind(limit).all<{ script_db_id: string; body_json: string; account_type: string | null; created_at: string; store_name: string | null }>();
      const history = (rows.results ?? []).map(r => ({
        script: { script_db_id: r.script_db_id, ...JSON.parse(r.body_json) },
        storeName: r.store_name ?? "",
        type: r.account_type ?? "B",
        at: r.created_at,
      }));
      return json({ history });
    }

    // POST /api/jobs — ジョブ発行のみ。LLMは呼ばない
    if (req.method === "POST" && path === "/api/jobs") {
      const b = (await req.json()) as JobRequest;
      if (!["hearing", "script", "pack", "multi"].includes(b.task)) return err("unknown task", 400);
      if (b.task === "hearing" && !b.input?.query?.trim()) {
        return err("店舗URLまたは店名が空です", 400);
      }
      if ((b.task === "script" || b.task === "pack" || b.task === "multi") && !b.input?.hearing) {
        return err("ヒアリングデータがありません", 400);
      }
      const jobId = uid("job");
      // multi は複数案(pack相当)。DBのCHECK制約は 'pack' を使い、
      // 実際のmulti判定は request_json 内の task で行う(GETもpack形状で返る)。
      const dbTask = b.task === "multi" ? "pack" : b.task;
      await env.DB.prepare(
        "INSERT INTO script_jobs (id, task, store_name, request_json, status) VALUES (?, ?, ?, ?, 'queued')"
      ).bind(jobId, dbTask, storeNameOf(b.input), JSON.stringify(b)).run();
      await env.SCRIPT_QUEUE.send({ job_id: jobId });
      return json({ job_id: jobId, status: "queued" }, 202);
    }

    // GET /api/jobs/:id — 状態と、完了時は現行UI互換のresultを返す
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = await env.DB.prepare(
        "SELECT id, task, status, result_json, error FROM script_jobs WHERE id = ?"
      ).bind(jobMatch[1]).first<{
        id: string; task: string; status: string; result_json: string | null; error: string | null;
      }>();
      if (!job) return err("job not found", 404);
      if (job.status !== "done") {
        return json({ job_id: job.id, status: job.status, error: job.error });
      }

      // 現行 api(task, input) の戻り値と同じ形へ組み立て(UI互換)
      if (job.task === "hearing") {
        return json({ job_id: job.id, status: "done", result: { hearing: JSON.parse(job.result_json ?? "{}") } });
      }
      const rows = await env.DB.prepare(
        "SELECT id, variant, body_json FROM scripts WHERE job_id = ? ORDER BY variant"
      ).bind(job.id).all<{ id: string; variant: number; body_json: string }>();
      const bodies = (rows.results ?? []).map(r => ({ script_db_id: r.id, ...JSON.parse(r.body_json) }));
      if (job.task === "script") {
        return json({ job_id: job.id, status: "done", result: { script: bodies[0] ?? null } });
      }
      const meta = JSON.parse(job.result_json ?? "{}") as { strategy_summary?: string };
      return json({
        job_id: job.id,
        status: "done",
        result: { pack: { strategy_summary: meta.strategy_summary ?? "", cases: bodies } },
      });
    }

    // POST /api/scripts/:id/review — レビュー学習データ保存(設計書§4)
    const reviewMatch = path.match(/^\/api\/scripts\/([^/]+)\/review$/);
    if (req.method === "POST" && reviewMatch) {
      const b = (await req.json()) as ReviewRequest;
      if (!["adopted", "revised", "rejected"].includes(b.decision)) {
        return err("decision must be adopted / revised / rejected", 400);
      }
      if (!Array.isArray(b.reason_tags)) return err("reason_tags must be an array", 400);
      const invalid = b.reason_tags.filter(t => !(REASON_TAGS as readonly string[]).includes(t));
      if (invalid.length > 0) return err(`unknown reason_tags: ${invalid.join(", ")}`, 400);
      if (!b.reviewer) return err("reviewer is required", 400);

      const script = await env.DB.prepare("SELECT id FROM scripts WHERE id = ?").bind(reviewMatch[1]).first();
      if (!script) return err("script not found", 404);

      const reviewId = uid("rev");
      await env.DB.prepare(
        `INSERT INTO script_reviews (id, script_id, decision, before_text, after_text, reason_tags, reason_note, reviewer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        reviewId, reviewMatch[1], b.decision,
        b.before_text ?? null, b.after_text ?? null,
        JSON.stringify(b.reason_tags), b.reason_note ?? null, b.reviewer
      ).run();
      await env.DB.prepare("UPDATE scripts SET status = ? WHERE id = ?").bind(b.decision, reviewMatch[1]).run();
      return json({ review_id: reviewId }, 201);
    }

    return err("not found", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : "internal error", 500);
  }
}

// ---------- Queue consumer ----------

async function processJob(jobId: string, env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT request_json, status FROM script_jobs WHERE id = ?")
    .bind(jobId).first<{ request_json: string; status: string }>();
  if (!row) throw new Error(`job not found: ${jobId}`);
  if (row.status === "done") return; // 冪等

  await env.DB.prepare(
    "UPDATE script_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?"
  ).bind(jobId).run();

  const { task, input } = JSON.parse(row.request_json) as JobRequest;
  const model = env.LLM_MODEL;
  const key = env.ANTHROPIC_API_KEY;
  // 台本生成タスクは、全店共通のレビュー履歴を「燃料」として毎回注入する。
  const fuel = task === "hearing" ? "" : await buildFuel(env);

  if (task === "hearing") {
    let query = (input.query ?? "").trim();
    const gm = query.match(/[?&]q=([^&]+)/);
    if (gm) { try { query = decodeURIComponent(gm[1].replace(/\+/g, " ")); } catch { /* keep */ } }
    const user = `この店を特定してヒアリング下書きを作って:\n${query}\n※広島県の店の可能性が高い。同名店に注意。Web検索は2回までに抑え、分かったら速やかにJSON出力。`;
    const hearing = await generateJson<Record<string, unknown>>(key, model, HEARING_SYSTEM, user, true, 3000);

    // 根拠として source_documents にも保存(AI生成・hearing種別)
    const store = hearing.store as { name?: string } | undefined;
    await env.DB.prepare(
      `INSERT INTO source_documents (id, store_name, source_type, url, fetched_at, body, created_by)
       VALUES (?, ?, 'hearing', NULL, datetime('now'), ?, 'ai')`
    ).bind(uid("src"), store?.name ?? query, JSON.stringify(hearing)).run();

    await env.DB.prepare(
      "UPDATE script_jobs SET status = 'done', result_json = ?, finished_at = datetime('now') WHERE id = ?"
    ).bind(JSON.stringify(hearing), jobId).run();
    return;
  }

  if (task === "script") {
    const at = input.accountType === "B" ? "B(店舗公式用)" : "A(インフルエンサー用/ume)";
    const pt = input.pattern || "おまかせ(ヒアリングから最適を選ぶ)";
    const user = `${hearingBlock(input)}\nアカウントタイプ: ${at}\n構文パターン: ${pt}${fuel}\n\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`;
    const script = await generateJson<Record<string, unknown>>(key, model, SINGLE_SYSTEM, user, false, 2500);

    await env.DB.prepare(
      `INSERT INTO scripts (id, job_id, variant, account_type, body_json, syntax_pattern, model, prompt_version, knowledge_rule_version)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid("script"), jobId, input.accountType ?? "A", JSON.stringify(script),
      (script.pattern as string) ?? null, model, PROMPT_VERSION, KNOWLEDGE_RULE_VERSION
    ).run();
    await env.DB.prepare(
      "UPDATE script_jobs SET status = 'done', finished_at = datetime('now') WHERE id = ?"
    ).bind(jobId).run();
    return;
  }

  if (task === "multi") {
    await processMulti(jobId, input, env, model, key, fuel);
    return;
  }

  // pack: 3案
  const packType = input.packType === "B" ? "B(店舗公式用)" : "A(インフルエンサー用/ume)";
  const user = `${hearingBlock(input)}${fuel}\n\nこの店の${packType}の3案を作って。3案すべてフックの型を変える。\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`;
  const pack = await generateJson<{ strategy_summary?: string; cases?: PackCase[] }>(key, model, PACK_SYSTEM, user, false, 3500);
  const cases = pack.cases ?? [];
  if (cases.length === 0) throw new Error("packのcasesが空です");

  let variant = 0;
  for (const c of cases) {
    variant++;
    await env.DB.prepare(
      `INSERT INTO scripts (id, job_id, variant, case_label, account_type, body_json, syntax_pattern, model, prompt_version, knowledge_rule_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid("script"), jobId, variant, c.label ?? null, c.type ?? input.packType ?? null,
      JSON.stringify(c), c.pattern ?? null, model, PROMPT_VERSION, KNOWLEDGE_RULE_VERSION
    ).run();
  }
  await env.DB.prepare(
    "UPDATE script_jobs SET status = 'done', result_json = ?, finished_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify({ strategy_summary: pack.strategy_summary ?? "" }), jobId).run();
}

// ---------- multi: AIが5型を選定し並列生成 ----------

interface SelectResult {
  strategy_summary?: string;
  patterns?: { name?: string; reason?: string }[];
}

async function processMulti(
  jobId: string,
  input: JobRequest["input"],
  env: Env,
  model: string,
  key: string,
  fuel: string
): Promise<void> {
  const at = input.accountType === "B" ? "B(店舗公式用)" : "A(インフルエンサー用/ume)";
  const canon = PATTERN_CANON as readonly string[];

  // 使う構文パターンを決める。フロントで選ばれた型(input.patterns)を最優先。
  // 未指定のときだけAIが相性で選定(後方互換)。
  let patterns: string[];
  let strategy = "";
  const chosen = (input.patterns ?? []).map(p => (p || "").trim()).filter(Boolean);
  if (chosen.length > 0) {
    patterns = [...new Set(chosen)].slice(0, 5);
  } else {
    const selUser = `${hearingBlock(input)}\nアカウントタイプ: ${at}\n\nこの店に最も合う構文パターンを相性順に3つ選んでJSONで返す。`;
    const sel = await generateJson<SelectResult>(key, model, MULTI_SELECT_SYSTEM, selUser, false, 800);
    strategy = sel.strategy_summary ?? "";
    let pats = (sel.patterns ?? []).map(p => (p.name ?? "").trim()).filter(name => canon.includes(name));
    pats = [...new Set(pats)];
    for (const p of canon) {
      if (pats.length >= 3) break;
      if (!pats.includes(p)) pats.push(p);
    }
    patterns = pats.slice(0, 3);
  }

  // 2) 各型を生成(単発台本と同じ品質。失敗した型はスキップ)。
  //    一斉に投げるとAPI過負荷で全滅するため、2本ずつの小分けで実行する。
  const genOne = async (pat: string): Promise<{ pat: string; script: Record<string, unknown> } | null> => {
    const user = `${hearingBlock(input)}\nアカウントタイプ: ${at}\n構文パターン: ${pat}${fuel}\n\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`;
    try {
      const script = await generateJson<Record<string, unknown>>(key, model, SINGLE_SYSTEM, user, false, 2500);
      return { pat, script };
    } catch {
      return null;
    }
  };

  // APIティアが低い間は同時実行でレート制限に当たり全滅するため、1本ずつ順番に生成する。
  // (ティアが上がれば数値を上げて高速化可能)
  const CONCURRENCY = 1;
  const results: ({ pat: string; script: Record<string, unknown> } | null)[] = [];
  for (let i = 0; i < patterns.length; i += CONCURRENCY) {
    const chunk = patterns.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(genOne));
    results.push(...chunkResults);
  }

  const ok = results.filter((r): r is { pat: string; script: Record<string, unknown> } => r !== null);
  if (ok.length === 0) throw new Error("multiの生成がすべて失敗しました");

  // 3) scriptsへ保存(pack互換のcase形状。既存レビューUIがそのまま使える)
  const accountType = input.accountType === "B" ? "B" : "A";
  let variant = 0;
  for (const { pat, script } of ok) {
    variant++;
    const label = `型${variant}`;
    // 単発台本の全情報を保持しつつ、pack UIが読むフィールド(label/type/hook)を付与
    const hooks = script.hooks;
    const hook = Array.isArray(hooks) && typeof hooks[0] === "string" ? hooks[0] : "";
    const caseObj = { ...script, label, type: accountType, pattern: (script.pattern as string) || pat, hook };
    await env.DB.prepare(
      `INSERT INTO scripts (id, job_id, variant, case_label, account_type, body_json, syntax_pattern, model, prompt_version, knowledge_rule_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid("script"), jobId, variant, label, accountType,
      JSON.stringify(caseObj), (script.pattern as string) || pat, model, PROMPT_VERSION, KNOWLEDGE_RULE_VERSION
    ).run();
  }
  await env.DB.prepare(
    "UPDATE script_jobs SET status = 'done', result_json = ?, finished_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify({ strategy_summary: strategy }), jobId).run();
}

// ---------- Cron ----------

async function handleCron(env: Env): Promise<void> {
  const stale = await env.DB.prepare(
    `SELECT id, retry_count FROM script_jobs
     WHERE status = 'running' AND started_at < datetime('now', '-15 minutes')`
  ).all<{ id: string; retry_count: number }>();

  for (const job of stale.results ?? []) {
    if (job.retry_count < 3) {
      await env.DB.prepare(
        "UPDATE script_jobs SET status = 'queued', retry_count = retry_count + 1 WHERE id = ?"
      ).bind(job.id).run();
      await env.SCRIPT_QUEUE.send({ job_id: job.id });
    } else {
      await env.DB.prepare(
        "UPDATE script_jobs SET status = 'failed', error = 'timeout after 3 retries', finished_at = datetime('now') WHERE id = ?"
      ).bind(job.id).run();
    }
  }
}

// ---------- entrypoints ----------

export default {
  fetch: handleFetch,

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processJob(msg.body.job_id, env);
        msg.ack();
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        await env.DB.prepare(
          "UPDATE script_jobs SET error = ?, retry_count = retry_count + 1 WHERE id = ?"
        ).bind(message, msg.body.job_id).run();
        const job = await env.DB.prepare("SELECT retry_count FROM script_jobs WHERE id = ?")
          .bind(msg.body.job_id).first<{ retry_count: number }>();
        if ((job?.retry_count ?? 0) >= 3) {
          await env.DB.prepare(
            "UPDATE script_jobs SET status = 'failed', finished_at = datetime('now') WHERE id = ?"
          ).bind(msg.body.job_id).run();
          msg.ack();
        } else {
          msg.retry();
        }
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleCron(env);
  },
};
