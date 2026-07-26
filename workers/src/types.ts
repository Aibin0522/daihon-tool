export interface Env {
  DB: D1Database;
  SCRIPT_QUEUE: Queue<JobMessage>;
  ANTHROPIC_API_KEY: string;
  API_AUTH_TOKEN: string;
  LLM_MODEL: string;
}

export interface JobMessage {
  job_id: string;
}

export type TaskType = "hearing" | "script" | "pack" | "multi";

/** 現行UIの api(task, input) と同じ入力(互換維持) */
export interface JobRequest {
  task: TaskType;
  input: {
    // hearing
    query?: string;
    // script / pack 共通
    hearing?: Record<string, unknown>;
    accountType?: string; // script: A / B
    packType?: string; // pack: A / B
    pattern?: string;
    patterns?: string[]; // multi: ユーザーが選んだ構文パターン(未指定ならAIが選定)
    duration?: string;
    material?: string;
    seasonal?: string;
    extraRules?: string;
  };
}

export interface ReviewRequest {
  decision: "adopted" | "revised" | "rejected";
  before_text?: string;
  after_text?: string;
  reason_tags: string[];
  reason_note?: string;
  reviewer: string;
}

export const REASON_TAGS = [
  "hook_weak",
  "fact_error",
  "generic",
  "tone_mismatch",
  "structure_bad",
  "cta_weak",
  "compliance_risk",
  "good_pattern",
] as const;

export interface PackCase {
  label?: string;
  type?: string;
  pattern?: string;
  [key: string]: unknown;
}
