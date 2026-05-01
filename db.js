import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Supabase 未配置：请在 .env 中设置 SUPABASE_URL 与 SUPABASE_ANON_KEY（服务端推荐 SUPABASE_SERVICE_ROLE_KEY）"
    );
  }
  return supabase;
}

const defaultSettings = {
  platform: "小红书",
  personaName: "",
  audienceProfile: "",
  toneStyle: "朋友式共鸣",
  toneDetails: "",
  hookStyle: "",
  bodyFramework: "",
  ctaTemplate: "",
  riskBlacklist: "",
  coverTitleStyle: "",
  bodyTitleStyle: "",
  apiKey: ""
};

function mapSettingsRow(row) {
  if (!row) return { ...defaultSettings };
  return {
    platform: row.platform,
    personaName: row.persona_name,
    audienceProfile: row.audience_profile,
    toneStyle: row.tone_style,
    toneDetails: row.tone_details,
    hookStyle: row.hook_style,
    bodyFramework: row.body_framework,
    ctaTemplate: row.cta_template,
    riskBlacklist: row.risk_blacklist,
    coverTitleStyle: row.cover_title_style,
    bodyTitleStyle: row.body_title_style,
    apiKey: row.api_key || ""
  };
}

function mapTopicRow(row) {
  if (!row) return null;
  let kw = row.search_keywords;
  if (typeof kw === "string") {
    try {
      kw = JSON.parse(kw);
    } catch {
      kw = [];
    }
  }
  if (!Array.isArray(kw)) kw = [];
  return {
    ...row,
    search_keywords: kw.map((x) => String(x).trim()).filter(Boolean)
  };
}

function sanitizeIlikeFragment(s) {
  return String(s)
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, " ");
}

/** @deprecated 保留兼容；请使用 Supabase */
export function getDb() {
  return null;
}

export async function getSettings() {
  const client = requireClient();
  const { data, error } = await client.from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return mapSettingsRow(data);
}

export async function upsertSettings(settings) {
  const payload = { ...defaultSettings, ...settings, apiKey: "" };
  const row = {
    id: 1,
    platform: payload.platform,
    persona_name: payload.personaName,
    audience_profile: payload.audienceProfile,
    tone_style: payload.toneStyle,
    tone_details: payload.toneDetails,
    hook_style: payload.hookStyle,
    body_framework: payload.bodyFramework,
    cta_template: payload.ctaTemplate,
    risk_blacklist: payload.riskBlacklist,
    cover_title_style: payload.coverTitleStyle,
    body_title_style: payload.bodyTitleStyle,
    api_key: "",
    updated_at: new Date().toISOString()
  };
  const client = requireClient();
  const { error } = await client.from("app_settings").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return getSettings();
}

export async function listTopics() {
  const client = requireClient();
  const { data, error } = await client.from("topics").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapTopicRow);
}

export async function listTopicsPaged({ page = 1, pageSize = 10, query = "", platform = "", status = "" }) {
  const client = requireClient();
  let qb = client.from("topics").select("*", { count: "exact" });

  if (query) {
    const p = `%${sanitizeIlikeFragment(query)}%`;
    qb = qb.or(
      `topic.ilike.${p},hook.ilike.${p},body.ilike.${p},ending_cta.ilike.${p},cover_title.ilike.${p},body_title.ilike.${p}`
    );
  }
  if (platform && platform !== "全部平台") {
    qb = qb.eq("platform", platform);
  }
  if (status && status !== "全部状态") {
    qb = qb.eq("status", status);
  }

  const from = (Math.max(page, 1) - 1) * Math.max(pageSize, 1);
  const to = from + Math.max(pageSize, 1) - 1;

  const { data, error, count } = await qb.order("updated_at", { ascending: false }).range(from, to);

  if (error) throw new Error(error.message);

  return {
    total: count ?? 0,
    page: Math.max(page, 1),
    pageSize: Math.max(pageSize, 1),
    items: (data || []).map(mapTopicRow)
  };
}

export async function createTopic(topic) {
  const client = requireClient();
  const { data: maxRow, error: maxErr } = await client
    .from("topics")
    .select("list_seq")
    .order("list_seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) throw new Error(maxErr.message);
  const m = maxRow?.list_seq;
  const nextSeq = (typeof m === "number" && Number.isFinite(m) ? m : 0) + 1;

  const kw = Array.isArray(topic.search_keywords) ? topic.search_keywords : [];
  const insertRow = {
    id: topic.id,
    list_seq: nextSeq,
    platform: topic.platform || "小红书",
    status: topic.status || "待拍",
    topic: topic.topic || "",
    hook: topic.hook || "",
    body: topic.body || "",
    ending_cta: topic.ending_cta || "",
    cover_title: topic.cover_title || "",
    body_title: topic.body_title || "",
    search_keywords: kw,
    updated_at: new Date().toISOString()
  };

  const { error } = await client.from("topics").insert(insertRow);
  if (error) throw new Error(error.message);
}

export async function updateTopic(id, topic) {
  const client = requireClient();
  const kw = Array.isArray(topic.search_keywords) ? topic.search_keywords : [];
  const { error } = await client
    .from("topics")
    .update({
      platform: topic.platform || "小红书",
      status: topic.status || "待拍",
      topic: topic.topic || "",
      hook: topic.hook || "",
      body: topic.body || "",
      ending_cta: topic.ending_cta || "",
      cover_title: topic.cover_title || "",
      body_title: topic.body_title || "",
      search_keywords: kw,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTopic(id) {
  const client = requireClient();
  const { error } = await client.from("topics").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function logGeneration(log) {
  try {
    const client = requireClient();
    const row = {
      id: log.id,
      task: log.task || "",
      source: log.source || "mock",
      model: log.model || "",
      batch_size: log.batchSize || 0,
      latency_ms: log.latencyMs || 0,
      request_payload: log.requestPayload || {},
      response_payload: log.responsePayload || {}
    };
    const { error } = await client.from("generation_logs").insert(row);
    if (error) console.error("[logGeneration]", error.message);
  } catch (e) {
    console.error("[logGeneration]", e.message || e);
  }
}
