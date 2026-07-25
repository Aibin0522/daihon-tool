import type { Env, JobMessage, JobRequest, ReviewRequest, PackCase } from "./types";
import { REASON_TAGS } from "./types";
import { callClaude, parseJson } from "./adapters/llm";
import {
  SINGLE_SYSTEM,
  PACK_SYSTEM,
  HEARING_SYSTEM,
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

// ---------- API (fetch) ----------

async function handleFetch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.API_AUTH_TOKEN}`) return err("unauthorized", 401);

  try {
    // POST /api/jobs — ジョブ発行のみ。LLMは呼ばない
    if (req.method === "POST" && path === "/api/jobs") {
      const b = (await req.json()) as JobRequest;
      if (!["hearing", "script", "pack"].includes(b.task)) return err("unknown task", 400);
      if (b.task === "hearing" && !b.input?.query?.trim()) {
        return err("店舗URLまたは店名が空です", 400);
      }
      if ((b.task === "script" || b.task === "pack") && !b.input?.hearing) {
        return err("ヒアリングデータがありません", 400);
      }
      const jobId = uid("job");
      await env.DB.prepare(
        "INSERT INTO script_jobs (id, task, store_name, request_json, status) VALUES (?, ?, ?, ?, 'queued')"
      ).bind(jobId, b.task, storeNameOf(b.input), JSON.stringify(b)).run();
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

  if (task === "hearing") {
    let query = (input.query ?? "").trim();
    const gm = query.match(/[?&]q=([^&]+)/);
    if (gm) { try { query = decodeURIComponent(gm[1].replace(/\+/g, " ")); } catch { /* keep */ } }
    const user = `この店を特定してヒアリング下書きを作って:\n${query}\n※広島県の店の可能性が高い。同名店に注意。Web検索は2回までに抑え、分かったら速やかにJSON出力。`;
    const raw = await callClaude(key, model, HEARING_SYSTEM, user, true, 3000);
    const hearing = parseJson<Record<string, unknown>>(raw);

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
    const user = `${hearingBlock(input)}\nアカウントタイプ: ${at}\n構文パターン: ${pt}\n\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`;
    const raw = await callClaude(key, model, SINGLE_SYSTEM, user, false, 2500);
    const script = parseJson<Record<string, unknown>>(raw);

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

  // pack: 3案
  const packType = input.packType === "B" ? "B(店舗公式用)" : "A(インフルエンサー用/ume)";
  const user = `${hearingBlock(input)}\n\nこの店の${packType}の3案を作って。3案すべてフックの型を変える。\n重要: 説明文やコードブロック記号を付けず、{で始まり}で終わるJSONだけを出力。`;
  const raw = await callClaude(key, model, PACK_SYSTEM, user, false, 3500);
  const pack = parseJson<{ strategy_summary?: string; cases?: PackCase[] }>(raw);
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
