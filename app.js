// 纯静态站点（Netlify）：数据与设置走 Supabase；AI 走 DeepSeek（见 index.html）

const pageTitleMap = {
  generate: "AI 对话工作台",
  library: "选题库",
  settings: "设置"
};

const state = {
  chatMode: "agent",
  settings: {
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
    bodyTitleStyle: ""
  },
  topics: [],
  page: 1,
  pageSize: 10,
  total: 0,
  generated: [],
  latestViral: {
    topics: [],
    titles: [],
    note: ""
  },
  chatAbortController: null
};

function viralInspiration() {
  const v = state.latestViral;
  return [...(v.topics || []), ...(v.titles || [])];
}

/** 统一接口里的选题/标题列表（兼容旧版 API 的 angles、keywords） */
function coerceViralApiPayload(data) {
  const d = data && typeof data === "object" ? data : {};
  const toList = (v) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === "string") {
      return v
        .split(/[,，、\n；;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof v === "object") {
      return Object.values(v)
        .filter((x) => x != null && String(x).trim())
        .map((x) => String(x).trim());
    }
    return [];
  };
  let topics = toList(d.topics);
  let titles = toList(d.titles);
  if (!topics.length) topics = toList(d.angles);
  if (!titles.length) titles = toList(d.keywords);
  return {
    ...d,
    topics,
    titles,
    note: d.note != null ? String(d.note) : ""
  };
}

const menuItems = document.querySelectorAll(".menu-item");
const pages = document.querySelectorAll(".page");
const pageTitle = document.getElementById("page-title");
const generatedList = document.getElementById("generated-list");
const chatMessages = document.getElementById("chat-messages");
const chatTaskInput = document.getElementById("chat-task-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const modePills = document.querySelectorAll(".mode-pill");
const saveGeneratedBtn = document.getElementById("save-generated");
const addTopicRowButton = document.getElementById("add-topic-row");
const topicTableBody = document.getElementById("topic-table-body");
const prevPageBtn = document.getElementById("prev-page-btn");
const nextPageBtn = document.getElementById("next-page-btn");
const pageInfo = document.getElementById("page-info");
const librarySearch = document.getElementById("library-search");
const platformFilter = document.getElementById("library-platform-filter");
const statusFilter = document.getElementById("library-status-filter");
const hotSeedInput = document.getElementById("hot-seed-input");
const fetchHotBtn = document.getElementById("fetch-hot-btn");
const injectHotBtn = document.getElementById("inject-hot-btn");
const hotResultsPanel = document.getElementById("hot-results-panel");
const saveSettingsBtn = document.getElementById("save-settings-btn");

const settingFields = {
  platform: document.getElementById("setting-platform"),
  personaName: document.getElementById("setting-persona-name"),
  audienceProfile: document.getElementById("setting-audience-profile"),
  toneStyle: document.getElementById("setting-tone-style"),
  toneDetails: document.getElementById("setting-tone-details"),
  riskBlacklist: document.getElementById("setting-risk-blacklist")
};

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setButtonLoading(button, loadingText, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function syncSettingsToUI() {
  Object.entries(settingFields).forEach(([key, node]) => {
    if (!node) return;
    node.value = state.settings[key] ?? "";
  });
}

function readSettingsFromUI() {
  Object.entries(settingFields).forEach(([key, node]) => {
    if (!node) return;
    state.settings[key] = node.value.trim();
  });
}

function showToast(button, text, resetText, ms = 1000) {
  if (!button) return;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = resetText;
  }, ms);
}

function switchPage(pageId) {
  menuItems.forEach((item) => item.classList.remove("active"));
  pages.forEach((page) => page.classList.remove("active"));
  document.querySelector(`.menu-item[data-page="${pageId}"]`)?.classList.add("active");
  document.getElementById(pageId)?.classList.add("active");
  pageTitle.textContent = pageTitleMap[pageId];
}

/** 口播/文案里常见序号前换行，便于阅读 */
function prettifyForReading(text) {
  let s = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!s.trim()) return s;
  // 中文「第一、」「第二，」「第3.」等
  s = s.replace(/([^\n])(\s*)(第[一二三四五六七八九十百零两0-9]+[、，,.．])/g, "$1\n\n$3");
  // 句号/分号后接「首先、其次…」
  s = s.replace(/([。！？；;])\s*(首先|其次|再次|最后|总之|另外|还有|再者)[、，,]/g, "$1\n\n$2");
  // 中文后接「1. 」「2、」列表（避免小数：前一字须为非数字汉字或标点）
  s = s.replace(/([\u4e00-\u9fff。！？；：])\s*(\d{1,2}([、，]|\.\s+[\u4e00-\u9fff]))/g, "$1\n$2");
  // 合并过多空行
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 模型可能返回字符串或 JSON 字符串，统一成 string[] */
function normalizeSearchKeywords(v) {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        return normalizeSearchKeywords(JSON.parse(t));
      } catch {
        /* 按逗号拆 */
      }
    }
    return t.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof v === "object") {
    return Object.values(v)
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim());
  }
  return [];
}

/* ---------- Supabase 选题库 + 设置 ---------- */

function getSpeakSupabase() {
  const client = window.__speakSupabase;
  if (!client) {
    throw new Error(
      "Supabase 未初始化：请在 index.html 中先加载 @supabase/supabase-js，并设置 window.__speakSupabase = supabase.createClient(项目URL, anon密钥)"
    );
  }
  return client;
}

function sanitizeIlikeFragment(s) {
  return String(s)
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, " ");
}

function mapTopicFromDB(row) {
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

async function fetchNextListSeq(sb) {
  const { data, error } = await sb
    .from("topics")
    .select("list_seq")
    .order("list_seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const m = data?.list_seq;
  return (typeof m === "number" && Number.isFinite(m) ? m : 0) + 1;
}

async function insertTopicViaSupabase(topic) {
  const sb = getSpeakSupabase();
  const nextSeq = await fetchNextListSeq(sb);
  const kw = Array.isArray(topic.search_keywords) ? topic.search_keywords : [];
  const row = {
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
  const { error } = await sb.from("topics").insert(row);
  if (error) throw new Error(error.message);
}

async function updateTopicViaSupabase(id, topic) {
  const sb = getSpeakSupabase();
  const kw = Array.isArray(topic.search_keywords) ? topic.search_keywords : [];
  const { error } = await sb
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

async function deleteTopicViaSupabase(id) {
  const sb = getSpeakSupabase();
  const { error } = await sb.from("topics").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------- 设置（app_settings）与 DeepSeek ---------- */

function defaultSettingsShape() {
  return {
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
}

function mapSettingsRowFromDb(row) {
  const d = defaultSettingsShape();
  if (!row) return { ...d };
  return {
    platform: row.platform ?? d.platform,
    personaName: row.persona_name ?? "",
    audienceProfile: row.audience_profile ?? "",
    toneStyle: row.tone_style ?? d.toneStyle,
    toneDetails: row.tone_details ?? "",
    hookStyle: row.hook_style ?? "",
    bodyFramework: row.body_framework ?? "",
    ctaTemplate: row.cta_template ?? "",
    riskBlacklist: row.risk_blacklist ?? "",
    coverTitleStyle: row.cover_title_style ?? "",
    bodyTitleStyle: row.body_title_style ?? "",
    apiKey: ""
  };
}

function mergeClientSettings(storedSettings, bodySettings) {
  const { apiKey: _a, ...restStored } = storedSettings || {};
  const { apiKey: _b, ...restBody } = bodySettings || {};
  return { ...defaultSettingsShape(), ...restStored, ...restBody };
}

function getDeepseekApiKey() {
  return String(window.__DEEPSEEK_API_KEY || "").trim();
}

/* ---------- DeepSeek（浏览器） ---------- */

function createMockItem(seed = "职场") {
  return {
    topic: `${seed}里最容易被低估的一件事：不是你不努力，是顺序错了`,
    hook: `你有没有发现，同一件事别人做起来更轻松，不是你差，而是你一上来就卡在最难的那一步？`,
    body: `先说结论：想把${seed}做出结果，先别急着硬扛，先把「顺序」调对，比盲目加时长有用得多。

第一块，先搞清楚你到底卡在「不会做」还是「不想做」。很多人把拖延当成懒，其实是任务太大、入口太陡，大脑本能想逃。把第一步砍到 5 分钟能启动，比喊一百句自律都管用。

第二块，再做减法，而不是再加技巧。同时追三个目标，等于一个都追不到。每周只留一个主目标，其它全部降级成「有空再说」，你的专注力会立刻不一样。这不是躺平，是给自己留赢面。

第三块，用小步验证代替空想。想全是问题，做才有答案。每 3 天复盘一次：哪一步有效、哪一步纯属自我感动，把无效动作砍掉，有效动作加倍。你会发现进步比想象中快。

这三块连起来，就是一条可照着念的口播骨架：先给结论，再分三层讲清楚，每层都要展开，别用一句话糊弄过去。`,
    ending_cta: `如果你也在${seed}里反复内耗，先把顺序调一版试试。觉得有用就点赞收藏，关注我，后面继续拆更细的实操。`,
    cover_title: `你不是不努力，是顺序一直错了`,
    body_title: `${seed}提效｜先做减法再加速｜口播脚本结构`,
    search_keywords: [`${seed}内耗怎么办`, `${seed}效率低`, `${seed}自律`, `口播脚本结构`]
  };
}

function parseModelJsonContent(content) {
  if (content == null || typeof content !== "string") {
    throw new Error("模型返回内容为空");
  }
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error(`模型返回非合法 JSON：${s.slice(0, 160)}${s.length > 160 ? "…" : ""}`);
  }
}

async function callDeepSeek({
  apiKey,
  systemPrompt,
  userPrompt,
  temperature = 0.8,
  max_tokens = 4000,
  jsonMode = true,
  signal
}) {
  const body = {
    model: "deepseek-chat",
    temperature,
    max_tokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  if (jsonMode) return parseModelJsonContent(content);
  return String(content).trim();
}

function asStringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        return asStringArray(JSON.parse(t));
      } catch {
        /* 按分隔符拆 */
      }
    }
    return t
      .split(/[,，、\n；;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.values(value)
      .filter((v) => v != null && String(v).trim())
      .map((v) => String(v).trim());
  }
  return [];
}

function normalizeGenerateItems(items) {
  return (items || []).map((item) => ({
    ...item,
    search_keywords: asStringArray(item?.search_keywords)
  }));
}

function normalizeViralPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { topics: [], titles: [], note: "" };
  }
  const base = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw;
  const raw2 = base.result && typeof base.result === "object" ? base.result : base;
  const topics = asStringArray(
    raw2.topics ??
      raw2.Topics ??
      raw2.topic_ideas ??
      raw2.topic_list ??
      raw2.选题 ??
      raw2.选题方向 ??
      raw2.angles ??
      raw2.content_angles ??
      raw2.ideas
  );
  const titles = asStringArray(
    raw2.titles ??
      raw2.Titles ??
      raw2.viral_titles ??
      raw2.hot_titles ??
      raw2.title_list ??
      raw2.爆款标题 ??
      raw2.爆款标题列表 ??
      raw2.keywords ??
      raw2.search_keywords
  );
  const note = raw2.note != null ? String(raw2.note) : raw.note != null ? String(raw.note) : "";
  return { topics, titles, note };
}

function mockViralAnalyze(seedTerm, sampleText) {
  const topics = [
    `为什么你越努力越焦虑：${seedTerm}里的认知陷阱`,
    `${seedTerm}新手最容易踩的 3 个坑`,
    `普通人如何把${seedTerm}做出结果：一条可复制的路径`
  ];
  const titles = [
    `${seedTerm}别再硬扛了，这样调整反而更快`,
    `我靠这 1 个习惯，把${seedTerm}从崩溃拉到稳定`,
    `说点得罪人的大实话：${seedTerm}里 90% 的人输在起点`,
    `${seedTerm}总内耗？不是你差，是方法错了`
  ];
  return {
    topics,
    titles,
    note: sampleText
      ? `已按关键词「${seedTerm}」与样本生成参考（离线示例）。`
      : `已按关键词「${seedTerm}」生成选题与标题参考（离线示例）。`
  };
}

async function runViralAnalyze({ seed, sample, signal } = {}) {
  readSettingsFromUI();
  const mergedSettings = state.settings;
  const seedTerm =
    String(seed || mergedSettings.personaName || mergedSettings.platform || "职场").trim() || "职场";
  const sampleText = String(sample || "").trim();
  const apiKey = getDeepseekApiKey();

  if (!apiKey) {
    const mock = mockViralAnalyze(seedTerm, sampleText);
    return { source: "mock", ...mock };
  }

  const systemPrompt = `你是中文口播/短视频选题策划。用户给的样本只用于理解方向，禁止输出与样本逐句相同或高度近似的标题。
必须输出纯 JSON，且只包含以下字段：
- topics：字符串数组，6-10 条「可做口播的选题方向」，每条是一句话的选题名（不要写拍摄技巧、封面风格等）。
- titles：字符串数组，10-16 条「爆款感标题」，适合抖音/小红书口播封面或标题，短、有钩子、口语化，不要夸张违禁承诺。
- note：一句中文说明（可选，简述这批选题适配的人群或场景）。
不要输出 JSON 以外的文字。不要输出封面风格、标题套路标签等元信息。`;

  const userPrompt = `关键词 / 内容方向：${seedTerm}

参考样本（可空；若有则借鉴方向，不复述原句）：
${sampleText || "（无额外样本，仅按关键词拓展）"}

请输出 topics、titles、note。`;

  const raw = await callDeepSeek({
    apiKey,
    systemPrompt,
    userPrompt,
    temperature: 0.65,
    max_tokens: 2000,
    jsonMode: true,
    signal
  });
  const normalized = normalizeViralPayload(raw);
  const fallback = mockViralAnalyze(seedTerm, sampleText);
  const topics = normalized.topics.length ? normalized.topics : fallback.topics;
  const titles = normalized.titles.length ? normalized.titles : fallback.titles;
  const note =
    normalized.note ||
    (sampleText ? `已结合样本，按「${seedTerm}」生成选题与标题。` : `已按「${seedTerm}」生成选题与标题。`);

  return { source: "deepseek", topics, titles, note };
}

async function loadSettingsFromSupabase() {
  const sb = getSpeakSupabase();
  const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  state.settings = mapSettingsRowFromDb(data);
  syncSettingsToUI();
}

async function saveSettingsToSupabase() {
  readSettingsFromUI();
  const sb = getSpeakSupabase();
  const s = mergeClientSettings(state.settings, {});
  const row = {
    id: 1,
    platform: s.platform,
    persona_name: s.personaName,
    audience_profile: s.audienceProfile,
    tone_style: s.toneStyle,
    tone_details: s.toneDetails,
    hook_style: s.hookStyle,
    body_framework: s.bodyFramework,
    cta_template: s.ctaTemplate,
    risk_blacklist: s.riskBlacklist,
    cover_title_style: s.coverTitleStyle,
    body_title_style: s.bodyTitleStyle,
    api_key: "",
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from("app_settings").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

function appendUserBubble(text) {
  if (!chatMessages) return;
  const raw = String(text ?? "");
  const bubble = document.createElement("div");
  bubble.className = "bubble user";
  const contentWrap = document.createElement("div");
  contentWrap.className = "bubble-user-text";
  const lines = raw.split("\n");
  lines.forEach((line, i) => {
    contentWrap.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) contentWrap.appendChild(document.createElement("br"));
  });
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "bubble-edit-btn";
  editBtn.title = "重新编辑并发送";
  editBtn.setAttribute("aria-label", "重新编辑并发送");
  editBtn.innerHTML = '<span class="bubble-edit-icon" aria-hidden="true">✎</span>';
  editBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!chatTaskInput) return;
    chatTaskInput.value = raw;
    chatTaskInput.focus();
    const len = raw.length;
    chatTaskInput.setSelectionRange(len, len);
    chatTaskInput.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  bubble.appendChild(contentWrap);
  bubble.appendChild(editBtn);
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatBubble(role, text) {
  if (!chatMessages) return;
  if (role === "user") {
    appendUserBubble(text);
    return;
  }
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  const raw = String(text ?? "");
  const formatted = prettifyForReading(raw);
  const lines = formatted.split("\n");
  lines.forEach((line, i) => {
    bubble.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) bubble.appendChild(document.createElement("br"));
  });
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setComposerLoading(loading, { stopMode = false } = {}) {
  const icon = chatSendBtn?.querySelector(".chat-send-icon");
  if (chatSendBtn) {
    if (loading && stopMode) {
      chatSendBtn.disabled = false;
      chatSendBtn.classList.add("is-loading", "is-stop-mode");
      chatSendBtn.title = "停止生成";
      chatSendBtn.setAttribute("aria-label", "停止生成");
      if (icon) icon.textContent = "⏹";
    } else if (loading) {
      chatSendBtn.disabled = true;
      chatSendBtn.classList.add("is-loading");
      chatSendBtn.classList.remove("is-stop-mode");
      chatSendBtn.title = "发送中…";
      if (icon) icon.textContent = "…";
    } else {
      chatSendBtn.disabled = false;
      chatSendBtn.classList.remove("is-loading", "is-stop-mode");
      chatSendBtn.title = "发送";
      chatSendBtn.setAttribute("aria-label", "发送");
      if (icon) icon.textContent = "↑";
    }
  }
  if (chatTaskInput) chatTaskInput.disabled = loading;
}

function isAbortError(err) {
  return err && (err.name === "AbortError" || err.code === 20);
}

/** 不向用户暴露模型原始 JSON / parse 细节 */
function userVisibleSendError(error) {
  const msg = String(error?.message || error || "");
  if (/非合法 JSON|JSON\.parse|Unexpected token/i.test(msg)) {
    return "回复未能完整解析，请缩短问题或稍后重试。";
  }
  return msg ? `发送失败：${msg}` : "发送失败，请稍后重试。";
}

async function submitChatMessage() {
  const task = chatTaskInput?.value?.trim() || "";
  if (!task) return;
  if (state.chatAbortController) return;
  appendChatBubble("user", task);
  chatTaskInput.value = "";
  readSettingsFromUI();
  state.chatAbortController = new AbortController();
  const signal = state.chatAbortController.signal;
  setComposerLoading(true, { stopMode: true });
  try {
    if (state.chatMode === "ask") {
      const apiKey = getDeepseekApiKey();
      if (!apiKey) {
        appendChatBubble(
          "assistant",
          "当前为离线模式：在 index.html 里配置 window.__DEEPSEEK_API_KEY 后可使用 Ask 对话。"
        );
      } else {
        const mergedSettings = state.settings;
        const systemPrompt = `你是「灵芽-口播助手」的对话顾问，帮用户解决口播选题、文案结构、表达节奏、平台习惯等问题。
回答要求：简洁、口语化、给可执行建议；不要编造数据；直接输出自然段文字，不要使用 JSON、代码块或 markdown 围栏。`;
        const userPrompt = `用户问题：
${task}

（上下文：平台 ${mergedSettings.platform || "未填"}，人设 ${mergedSettings.personaName || "未填"}，受众 ${mergedSettings.audienceProfile || "未填"}）`;
        const reply = await callDeepSeek({
          apiKey,
          systemPrompt,
          userPrompt,
          temperature: 0.7,
          max_tokens: 4096,
          jsonMode: false,
          signal
        });
        const text = String(reply ?? "").trim();
        if (!text) throw new Error("模型返回为空");
        appendChatBubble("assistant", text);
      }
    } else {
      await handleGenerate({ task, inspiration: viralInspiration(), batchSize: 5, signal });
    }
  } catch (error) {
    if (isAbortError(error)) {
      appendChatBubble("assistant", "已停止生成。");
    } else {
      appendChatBubble("assistant", userVisibleSendError(error));
    }
  } finally {
    state.chatAbortController = null;
    setComposerLoading(false);
  }
}

function renderGeneratedCards() {
  if (!generatedList) return;
  generatedList.innerHTML = "";
  if (!state.generated.length) {
    generatedList.innerHTML =
      '<p class="muted">还没有生成结果。在右侧用 <strong>Agent</strong> 模式输入需求，点 ↑ 发送。</p>';
    return;
  }

  state.generated.forEach((item, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = "topic-item generated-card";
    const t = (v) => escapeHtml(prettifyForReading(v || ""));
    const kw = escapeHtml(normalizeSearchKeywords(item.search_keywords).join(", "));
    wrapper.innerHTML = `
      <p class="gen-row"><strong>选题</strong><span class="readable-field" contenteditable="true" data-key="topic">${t(item.topic)}</span></p>
      <p class="gen-row"><strong>开头钩子</strong><span class="readable-field" contenteditable="true" data-key="hook">${t(item.hook)}</span></p>
      <p class="gen-row"><strong>正文</strong><span class="readable-field readable-field--body" contenteditable="true" data-key="body">${t(item.body)}</span></p>
      <p class="gen-row"><strong>结尾</strong><span class="readable-field" contenteditable="true" data-key="ending_cta">${t(item.ending_cta)}</span></p>
      <p class="gen-row"><strong>封面标题</strong><span class="readable-field" contenteditable="true" data-key="cover_title">${t(item.cover_title)}</span></p>
      <p class="gen-row"><strong>正文标题</strong><span class="readable-field" contenteditable="true" data-key="body_title">${t(item.body_title)}</span></p>
      <p class="gen-row"><strong>搜索词</strong><span class="readable-field readable-field--inline" contenteditable="true" data-key="search_keywords">${kw}</span></p>
      <div class="item-actions">
        <button class="primary" data-action="save-one" data-index="${index}">保存到选题库</button>
        <button class="secondary" data-action="rewrite" data-index="${index}">重写这条</button>
        <button class="secondary" data-action="copy" data-index="${index}">复制</button>
      </div>
    `;
    generatedList.appendChild(wrapper);
  });
}

function syncGeneratedFromDOM() {
  const cards = document.querySelectorAll(".generated-card");
  cards.forEach((card, index) => {
    if (!state.generated[index]) return;
    card.querySelectorAll("[data-key]").forEach((node) => {
      const key = node.dataset.key;
      const value = node.textContent.trim();
      if (key === "search_keywords") {
        state.generated[index][key] = value.split(",").map((k) => k.trim()).filter(Boolean);
      } else {
        state.generated[index][key] = value;
      }
    });
  });
}

function syncSingleGeneratedFromDOM(index) {
  const cards = document.querySelectorAll(".generated-card");
  const card = cards[index];
  if (!card || state.generated[index] == null) return;
  card.querySelectorAll("[data-key]").forEach((node) => {
    const key = node.dataset.key;
    const value = node.textContent.trim();
    if (key === "search_keywords") {
      state.generated[index][key] = value.split(",").map((k) => k.trim()).filter(Boolean);
    } else {
      state.generated[index][key] = value;
    }
  });
}

const PLATFORM_OPTIONS = ["小红书", "抖音", "公众号"];
const STATUS_OPTIONS = ["待拍", "已拍", "草稿"];

function platformOptionsHtml(selected) {
  const opts = [...PLATFORM_OPTIONS];
  if (selected && !opts.includes(selected)) opts.unshift(selected);
  return opts.map(
    (p) => `<option value="${p}"${p === selected ? " selected" : ""}>${p}</option>`
  ).join("");
}

function statusOptionsHtml(selected) {
  const opts = [...STATUS_OPTIONS];
  if (selected && !opts.includes(selected)) opts.unshift(selected);
  return opts.map(
    (s) => `<option value="${s}"${s === selected ? " selected" : ""}>${s}</option>`
  ).join("");
}

function renderLibraryTable() {
  if (!topicTableBody) return;

  topicTableBody.innerHTML = "";
  state.topics.forEach((item) => {
    const row = document.createElement("tr");
    row.dataset.id = item.id;
    const plat = item.platform || state.settings.platform || "小红书";
    const stat = item.status || "待拍";
    const seq = item.list_seq != null && item.list_seq !== "" ? item.list_seq : "—";
    row.innerHTML = `
      <td class="library-seq">${seq}</td>
      <td><select data-key="platform" class="cell-select">${platformOptionsHtml(plat)}</select></td>
      <td><select data-key="status" class="cell-select">${statusOptionsHtml(stat)}</select></td>
      <td contenteditable="true" data-key="topic" class="library-cell-scroll">${item.topic || ""}</td>
      <td contenteditable="true" data-key="hook" class="library-cell-scroll">${item.hook || ""}</td>
      <td contenteditable="true" data-key="body" class="library-col-body library-cell-scroll library-cell-scroll--body">${item.body || ""}</td>
      <td contenteditable="true" data-key="ending_cta" class="library-cell-scroll">${item.ending_cta || ""}</td>
      <td contenteditable="true" data-key="cover_title" class="library-cell-scroll">${item.cover_title || ""}</td>
      <td contenteditable="true" data-key="body_title" class="library-cell-scroll">${item.body_title || ""}</td>
      <td contenteditable="true" data-key="search_keywords" class="library-cell-scroll">${normalizeSearchKeywords(item.search_keywords).join(", ")}</td>
      <td><button class="secondary" data-action="delete-topic">删除</button></td>
    `;
    topicTableBody.appendChild(row);
  });

  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  pageInfo.textContent = `第 ${state.page} / ${totalPages} 页`;
  prevPageBtn.disabled = state.page <= 1;
  nextPageBtn.disabled = state.page >= totalPages;
}

async function upsertTopicFromRow(row) {
  const id = row.dataset.id;
  const payload = {};
  row.querySelectorAll("[data-key]").forEach((node) => {
    const key = node.dataset.key;
    const value =
      node.tagName === "SELECT" ? String(node.value).trim() : node.textContent.trim();
    payload[key] = key === "search_keywords" ? value.split(",").map((k) => k.trim()).filter(Boolean) : value;
  });
  await updateTopicViaSupabase(id, payload);
}

function renderHotViralPanel(data) {
  if (!hotResultsPanel) return;
  const coerced = coerceViralApiPayload(data);
  const topics = coerced.topics;
  const titles = coerced.titles;
  const note = (coerced.note || "").trim();
  const source = coerced.source || "";

  hotResultsPanel.innerHTML = "";
  if (!topics.length && !titles.length && !note) {
    const p = document.createElement("p");
    p.className = "hot-results-placeholder muted";
    p.textContent = "暂无结果，可换个关键词再试。";
    hotResultsPanel.appendChild(p);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "hot-results-inner";

  const addSection = (title, items, listType = "ul") => {
    if (!items || !items.length) return;
    const sec = document.createElement("section");
    sec.className = "hot-result-section";
    const h = document.createElement("h4");
    h.textContent = title;
    sec.appendChild(h);
    if (listType === "chips") {
      const div = document.createElement("div");
      div.className = "chip-list hot-result-chips";
      items.forEach((t) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = t;
        div.appendChild(chip);
      });
      sec.appendChild(div);
    } else {
      const ul = document.createElement("ul");
      ul.className = "trend-list hot-result-list";
      items.forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    }
    wrap.appendChild(sec);
  };

  addSection("选题", topics, "ul");
  addSection("爆款标题", titles, "chips");

  if (note) {
    const sec = document.createElement("section");
    sec.className = "hot-result-section hot-result-note";
    const h = document.createElement("h4");
    h.textContent = "说明";
    sec.appendChild(h);
    const p = document.createElement("p");
    p.className = "muted note-body";
    p.textContent = note;
    sec.appendChild(p);
    wrap.appendChild(sec);
  }

  if (source === "mock") {
    const hint = document.createElement("p");
    hint.className = "muted hot-source-hint";
    hint.textContent = "当前为离线示例。在 index.html 中配置 window.__DEEPSEEK_API_KEY 后可拉取真实分析。";
    wrap.appendChild(hint);
  }

  hotResultsPanel.appendChild(wrap);
}

async function loadTopicsFromServer() {
  const sb = getSpeakSupabase();
  const page = Math.max(state.page, 1);
  const pageSize = Math.max(state.pageSize, 1);
  const query = (librarySearch?.value || "").trim();
  const platform = platformFilter?.value || "";
  const status = statusFilter?.value || "";

  let qb = sb.from("topics").select("*", { count: "exact" });

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

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await qb.order("updated_at", { ascending: false }).range(from, to);

  if (error) throw new Error(error.message);

  state.topics = (data || []).map(mapTopicFromDB);
  state.total = count ?? 0;
  renderLibraryTable();
}

async function handleGenerate({ task, inspiration = [], batchSize = 5, replaceIndex = null, signal } = {}) {
  readSettingsFromUI();
  const mergedSettings = mergeClientSettings(state.settings, {});
  const seed = mergedSettings.personaName || mergedSettings.platform || "内容";
  const apiKey = getDeepseekApiKey();
  let items;

  if (!apiKey) {
    items = normalizeGenerateItems(
      Array.from({ length: batchSize }, () => createMockItem(seed))
    ).map((item) => ({
      ...item,
      id: randomId(),
      search_keywords: normalizeSearchKeywords(item.search_keywords)
    }));
  } else {
    const systemPrompt = `你是中文口播/小红书图文双栖的策划与撰稿人。输出必须原创，可借鉴结构节奏，禁止复刻他人原句。
每条结果输出 JSON：{"items":[{topic,hook,body,ending_cta,cover_title,body_title,search_keywords}]}。

标题与正文硬性要求（对标优质口播稿，拒绝短、空、清单式一笔带过）：
1) cover_title（封面标题）：负责「让人在信息流里停一下」。多用戳痛点、给结果、做反差；禁止「今日感悟」「我的一点经验」「最近想明白了一件事」等自我、空洞概括；禁止纯文艺中心思想句。要像短视频封面一样，一眼让人感知「这和我有关」。
2) body_title（正文标题）：负责「给系统分发、给搜索」。必须写清主题领域，嵌入可搜的核心词与长尾词（用户真实会搜的短语），避免「终于想通了」「真的会谢」等纯情绪、系统无法识别的标题。
3) hook：口语化开场，提问/反常识/场景代入均可，要能接得住后面正文。
4) body：口播正文，至少三大段，须明确标注「第一块」「第二块」「第三块」（或「第一，」「第二，」「第三，」）。每一段都要「展开讲透」：每段不少于 130 汉字，包含具体场景、对比、反例或mini案例中的至少一类，禁止每段只写一两句敷衍。全文 body 总字数建议 650～950 汉字（仅 body 字段）。可先有一句「先说结论」再分块。
5) ending_cta：收束金句 + 引导点赞收藏关注，自然不尬。
6) search_keywords：3～8 个，偏用户真实搜索用语的长尾词。`;

    const userPrompt = `
平台: ${mergedSettings.platform || ""}
人设: ${mergedSettings.personaName || ""}
目标用户: ${mergedSettings.audienceProfile || ""}
语气: ${mergedSettings.toneStyle || ""}
语气细节: ${mergedSettings.toneDetails || ""}
开头偏好: ${mergedSettings.hookStyle || ""}
正文结构: ${mergedSettings.bodyFramework || ""}
结尾模板: ${mergedSettings.ctaTemplate || ""}
禁用词: ${mergedSettings.riskBlacklist || ""}
封面标题风格(补充): ${mergedSettings.coverTitleStyle || ""}
正文标题风格(补充): ${mergedSettings.bodyTitleStyle || ""}
灵感输入: ${JSON.stringify(inspiration)}
需求: ${task}

请生成 ${batchSize} 条结果，每条含 topic, hook, body, ending_cta, cover_title, body_title, search_keywords。
再次强调：body 必须三大块且每块充分展开，总字数达标；cover_title 与 body_title 各司其职，勿写成同一种空泛标题。`;

    const result = await callDeepSeek({
      apiKey,
      systemPrompt,
      userPrompt,
      max_tokens: 8192,
      jsonMode: true,
      signal
    });
    items = normalizeGenerateItems(result.items || []).map((item) => ({
      ...item,
      id: randomId(),
      search_keywords: normalizeSearchKeywords(item.search_keywords)
    }));
    if (!items.length) {
      throw new Error("模型未返回任何 items，请重试或缩短需求描述");
    }
  }

  if (!items.length) {
    throw new Error("模型未返回选题包，请重试或换种说法");
  }
  if (replaceIndex !== null && replaceIndex >= 0 && items.length > 0) {
    state.generated[replaceIndex] = items[0];
  } else {
    state.generated = items;
  }
  renderGeneratedCards();
  const summaries =
    replaceIndex !== null && replaceIndex >= 0 && items.length > 0
      ? [{ idx: replaceIndex + 1, item: items[0] }]
      : items.map((item, i) => ({ idx: i + 1, item }));
  summaries.forEach(({ idx, item }) => {
    const summary = `【选题${idx}】${item.topic}\n\n${item.hook}\n\n${item.body}\n\n${item.ending_cta}`;
    appendChatBubble("assistant", summary);
  });
}

function initEvents() {
  menuItems.forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });

  modePills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const mode = pill.dataset.mode;
      if (!mode) return;
      state.chatMode = mode;
      modePills.forEach((p) => {
        const on = p.dataset.mode === mode;
        p.classList.toggle("active", on);
        p.setAttribute("aria-selected", on ? "true" : "false");
      });
    });
  });

  chatSendBtn?.addEventListener("click", () => {
    if (chatSendBtn.classList.contains("is-stop-mode") && state.chatAbortController) {
      state.chatAbortController.abort();
      return;
    }
    submitChatMessage();
  });

  chatTaskInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChatMessage();
    }
  });

  saveGeneratedBtn?.addEventListener("click", async () => {
    syncGeneratedFromDOM();
    const mapped = state.generated.map((item) => ({
      ...item,
      id: randomId(),
      platform: state.settings.platform || "小红书",
      status: "待拍"
    }));
    try {
      await Promise.all(mapped.map((item) => insertTopicViaSupabase(item)));
      await loadTopicsFromServer();
      showToast(saveGeneratedBtn, "已保存到选题库", "保存全部到选题库", 1200);
    } catch (error) {
      appendChatBubble("assistant", `保存失败：${error.message}`);
    }
  });

  generatedList?.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === "save-one") {
      if (Number.isNaN(index)) return;
      readSettingsFromUI();
      syncSingleGeneratedFromDOM(index);
      const item = state.generated[index];
      if (!item) return;
      setButtonLoading(button, "保存中...", true);
      try {
        await insertTopicViaSupabase({
          ...item,
          id: randomId(),
          platform: state.settings.platform || "小红书",
          status: "待拍"
        });
        await loadTopicsFromServer();
        showToast(button, "已保存", "保存到选题库", 1200);
      } catch (error) {
        appendChatBubble("assistant", `单条保存失败：${error.message}`);
      } finally {
        setButtonLoading(button, "保存中...", false);
      }
      return;
    }
    if (button.dataset.action === "copy") {
      const item = state.generated[index];
      const text = `选题：${item.topic}\n开头钩子：${item.hook}\n正文：${item.body}\n结尾：${item.ending_cta}\n封面标题：${item.cover_title}\n正文标题：${item.body_title}\n搜索词：${normalizeSearchKeywords(item.search_keywords).join(", ")}`;
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制";
      setTimeout(() => (button.textContent = "复制"), 1000);
    }
    if (button.dataset.action === "rewrite") {
      syncGeneratedFromDOM();
      const topic = state.generated[index]?.topic || "该选题";
      const task = `请围绕「${topic}」重写一整条选题包（含 topic、hook、body、ending_cta、cover_title、body_title、search_keywords），主题不变但表达全新，更口语化、更贴近真实场景。`;
      appendChatBubble("user", task);
      setButtonLoading(button, "重写中...", true);
      switchPage("generate");
      try {
        await handleGenerate({
          task,
          inspiration: viralInspiration(),
          batchSize: 1,
          replaceIndex: index
        });
      } catch (error) {
        appendChatBubble("assistant", `重写失败：${error.message}`);
      } finally {
        setButtonLoading(button, "重写中...", false);
      }
    }
  });

  addTopicRowButton?.addEventListener("click", async () => {
    const newItem = {
      id: randomId(),
      platform: state.settings.platform || "小红书",
      status: "待拍",
      topic: "新选题（点击编辑）",
      hook: "开头钩子",
      body: "正文内容",
      ending_cta: "结尾升华 + 一键三连",
      cover_title: "封面标题",
      body_title: "正文标题",
      search_keywords: ["用户搜索词"]
    };
    await insertTopicViaSupabase(newItem);
    await loadTopicsFromServer();
  });

  topicTableBody?.addEventListener("input", async (event) => {
    const row = event.target.closest("tr");
    if (row) await upsertTopicFromRow(row);
  });

  topicTableBody?.addEventListener("change", async (event) => {
    const target = event.target;
    if (!target?.matches?.("[data-key]")) return;
    const row = target.closest("tr");
    if (row) await upsertTopicFromRow(row);
  });

  topicTableBody?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='delete-topic']");
    if (!button) return;
    const row = button.closest("tr");
    if (!row?.dataset.id) return;
    await deleteTopicViaSupabase(row.dataset.id);
    await loadTopicsFromServer();
  });

  [librarySearch, platformFilter, statusFilter].forEach((node) => {
    node?.addEventListener("input", async () => {
      state.page = 1;
      await loadTopicsFromServer();
    });
    node?.addEventListener("change", async () => {
      state.page = 1;
      await loadTopicsFromServer();
    });
  });

  prevPageBtn?.addEventListener("click", async () => {
    if (state.page <= 1) return;
    state.page -= 1;
    await loadTopicsFromServer();
  });

  nextPageBtn?.addEventListener("click", async () => {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page >= totalPages) return;
    state.page += 1;
    await loadTopicsFromServer();
  });

  saveSettingsBtn?.addEventListener("click", async () => {
    try {
      await saveSettingsToSupabase();
      showToast(saveSettingsBtn, "已保存", "保存");
    } catch (e) {
      appendChatBubble("assistant", `保存设置失败：${e.message}`);
    }
  });

  fetchHotBtn?.addEventListener("click", async () => {
    readSettingsFromUI();
    const seed = hotSeedInput.value.trim();
    if (!seed) {
      renderHotViralPanel({ topics: [], titles: [], note: "请先输入关键词。" });
      return;
    }
    setButtonLoading(fetchHotBtn, "获取中...", true);
    try {
      const raw = await runViralAnalyze({ seed, sample: seed });
      const data = coerceViralApiPayload(raw);
      state.latestViral.topics = data.topics;
      state.latestViral.titles = data.titles;
      state.latestViral.note = data.note || "";
      renderHotViralPanel(data);
    } catch (error) {
      renderHotViralPanel({
        topics: [],
        titles: [],
        note: `获取失败：${error.message}`
      });
    } finally {
      setButtonLoading(fetchHotBtn, "获取中...", false);
    }
  });

  hotSeedInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fetchHotBtn?.click();
    }
  });

  injectHotBtn?.addEventListener("click", () => {
    const v = state.latestViral;
    const parts = [];
    if (v.topics?.length) parts.push(`可参考选题：${v.topics.join("；")}`);
    if (v.titles?.length) parts.push(`可参考爆款标题：${v.titles.join("；")}`);
    if (!parts.length) return;
    const summary = `${parts.join("。")}。请据此生成内容。`;
    chatTaskInput.value = chatTaskInput.value ? `${chatTaskInput.value}\n${summary}` : summary;
  });
}

async function bootstrap() {
  if (!window.__speakSupabase) {
    appendChatBubble(
      "assistant",
      "未初始化 Supabase：请在 index.html 中先引入 @supabase/supabase-js，并设置 window.__speakSupabase = supabase.createClient(项目URL, anon密钥)。"
    );
  }

  try {
    await loadSettingsFromSupabase();
  } catch (error) {
    if (window.__speakSupabase) {
      appendChatBubble("assistant", `加载设置失败：${error.message}`);
    }
  }

  renderGeneratedCards();

  try {
    await loadTopicsFromServer();
  } catch (e) {
    if (window.__speakSupabase) {
      appendChatBubble("assistant", `选题库加载失败：${e.message}`);
    }
  }

  if (!getDeepseekApiKey()) {
    console.info("[灵芽口播] 未配置 window.__DEEPSEEK_API_KEY：生成 / Ask / 爆款分析使用离线示例。");
  }

  initEvents();
}

bootstrap().catch((error) => {
  appendChatBubble("assistant", `初始化失败：${error.message}`);
});
