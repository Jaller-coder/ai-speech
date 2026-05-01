const pageTitleMap = {
  generate: "AI 对话工作台",
  viral: "爆款灵感",
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
const viralAnalyzeBtn = document.getElementById("viral-analyze-btn");
const viralGenerateCopyBtn = document.getElementById("viral-generate-copy-btn");
const viralSampleInput = document.getElementById("viral-sample-input");
const viralSeedInput = document.getElementById("viral-seed-input");
const viralPatterns = document.getElementById("viral-patterns");
const viralAngles = document.getElementById("viral-angles");
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
      const data = await postJSON(
        "/api/chat",
        { message: task, settings: state.settings },
        { signal }
      );
      appendChatBubble("assistant", data.reply || "（无回复）");
    } else {
      await handleGenerate({ task, inspiration: viralInspiration(), batchSize: 5, signal });
    }
  } catch (error) {
    if (isAbortError(error)) {
      appendChatBubble("assistant", "已停止生成。");
    } else {
      appendChatBubble("assistant", `发送失败：${error.message || error}`);
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
  await putJSON(`/api/topics/${id}`, payload);
}

function renderChipList(container, items) {
  container.innerHTML = "";
  items.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = value;
    container.appendChild(chip);
  });
}

function renderTrendList(container, items) {
  container.innerHTML = "";
  items.forEach((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    container.appendChild(li);
  });
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
    hint.textContent = "当前为离线示例。在服务器环境变量中配置 DEEPSEEK_API_KEY 后可拉取真实分析。";
    wrap.appendChild(hint);
  }

  hotResultsPanel.appendChild(wrap);
}

async function postJSON(url, payload, options = {}) {
  const { signal } = options;
  const fetchOpts = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  };
  if (signal) fetchOpts.signal = signal;
  const response = await fetch(url, fetchOpts);
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { message: text || "请求失败" };
  }
  if (!response.ok) {
    throw new Error(result.message || `请求失败 (${response.status})`);
  }
  return result;
}

async function putJSON(url, payload) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { message: text || "请求失败" };
  }
  if (!response.ok) throw new Error(result.message || `请求失败 (${response.status})`);
  return result;
}

async function deleteJSON(url) {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    const maybe = await response.text();
    throw new Error(maybe || "删除失败");
  }
}

async function getJSON(url) {
  const response = await fetch(url);
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { message: text || "请求失败" };
  }
  if (!response.ok) throw new Error(result.message || `请求失败 (${response.status})`);
  return result;
}

async function loadSettingsFromServer() {
  state.settings = await getJSON("/api/settings");
  syncSettingsToUI();
}

async function loadTopicsFromServer() {
  const params = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize),
    query: (librarySearch?.value || "").trim(),
    platform: platformFilter?.value || "",
    status: statusFilter?.value || ""
  });
  const data = await getJSON(`/api/topics?${params.toString()}`);
  state.topics = data.items || [];
  state.total = data.total || 0;
  renderLibraryTable();
}

async function handleGenerate({ task, inspiration = [], batchSize = 5, replaceIndex = null, signal } = {}) {
  readSettingsFromUI();
  const reqOpts = signal ? { signal } : {};
  const data = await postJSON(
    "/api/generate",
    {
      settings: state.settings,
      task,
      inspiration,
      batchSize
    },
    reqOpts
  );
  const items = (data.items || []).map((item) => ({
    ...item,
    id: randomId(),
    search_keywords: normalizeSearchKeywords(item.search_keywords)
  }));
  if (!items.length) {
    throw new Error("模型未返回选题包，请重试或换种说法");
  }
  if (replaceIndex !== null && replaceIndex >= 0 && items.length > 0) {
    state.generated[replaceIndex] = items[0];
  } else {
    state.generated = items;
  }
  renderGeneratedCards();
  const summaries = replaceIndex !== null && replaceIndex >= 0 && items.length > 0
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
      await Promise.all(mapped.map((item) => postJSON("/api/topics", item)));
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
        await postJSON("/api/topics", {
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
    await postJSON("/api/topics", newItem);
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
    await deleteJSON(`/api/topics/${row.dataset.id}`);
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
    readSettingsFromUI();
    await putJSON("/api/settings", state.settings);
    showToast(saveSettingsBtn, "已保存", "保存");
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
      const raw = await postJSON("/api/viral/analyze", {
        seed,
        sample: seed,
        settings: state.settings
      });
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

  viralAnalyzeBtn?.addEventListener("click", async () => {
    readSettingsFromUI();
    const payload = {
      seed: viralSeedInput.value.trim(),
      sample: viralSampleInput.value.trim(),
      settings: state.settings
    };
    setButtonLoading(viralAnalyzeBtn, "分析中...", true);
    try {
      const raw = await postJSON("/api/viral/analyze", payload);
      const data = coerceViralApiPayload(raw);
      renderChipList(viralPatterns, data.titles);
      renderTrendList(viralAngles, data.topics);
      state.latestViral.topics = data.topics;
      state.latestViral.titles = data.titles;
      state.latestViral.note = data.note || "";
    } finally {
      setButtonLoading(viralAnalyzeBtn, "分析中...", false);
    }
  });

  viralGenerateCopyBtn?.addEventListener("click", async () => {
    readSettingsFromUI();
    const task = `根据这些爆款角度生成原创文案，方向：${viralSeedInput.value.trim() || "职场成长"}`;
    switchPage("generate");
    chatTaskInput.value = task;
    appendChatBubble("user", task);
    setButtonLoading(viralGenerateCopyBtn, "生成中...", true);
    try {
      await handleGenerate({ task, inspiration: viralInspiration(), batchSize: 3 });
    } catch (error) {
      appendChatBubble("assistant", `生成失败：${error.message}`);
    } finally {
      setButtonLoading(viralGenerateCopyBtn, "生成中...", false);
    }
  });
}

async function bootstrap() {
  let apiReachable = false;
  try {
    const r = await fetch("/api/health");
    apiReachable = r.ok;
  } catch {
    apiReachable = false;
  }
  if (!apiReachable) {
    appendChatBubble(
      "assistant",
      "未连接到后端。请在本项目目录执行 npm start，按终端里打印的地址打开（默认 http://localhost:3040，可在 .env 里改 PORT）。勿用本地文件 file:// 打开。"
    );
  }

  try {
    await loadSettingsFromServer();
  } catch (error) {
    if (apiReachable) appendChatBubble("assistant", `加载设置失败：${error.message}`);
  }

  renderGeneratedCards();

  try {
    await loadTopicsFromServer();
  } catch {
    /* 无后端时忽略选题库 */
  }

  initEvents();
}

bootstrap().catch((error) => {
  appendChatBubble("assistant", `初始化失败：${error.message}`);
});
