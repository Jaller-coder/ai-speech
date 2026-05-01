import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  createTopic,
  deleteTopic,
  getSettings,
  isSupabaseConfigured,
  listTopicsPaged,
  logGeneration,
  upsertSettings,
  updateTopic
} from "./db.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3040;

function deepseekApiKey() {
  return process.env.DEEPSEEK_API_KEY || "";
}

function mergeClientSettings(storedSettings, bodySettings) {
  const { apiKey: _drop, ...restStored } = storedSettings || {};
  const { apiKey: _drop2, ...restBody } = bodySettings || {};
  return { ...restStored, ...restBody };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "prototype-ui")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-speech",
    supabase: isSupabaseConfigured(),
    timestamp: new Date().toISOString()
  });
});

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

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  } catch (first) {
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
  jsonMode = true
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
    body: JSON.stringify(body)
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

app.get("/api/settings", async (_req, res) => {
  try {
    const { apiKey: _omit, ...rest } = await getSettings();
    res.json(rest);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    delete body.apiKey;
    const settings = await upsertSettings(body);
    const { apiKey: _omit, ...rest } = settings;
    res.json(rest);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get("/api/topics", async (_req, res) => {
  try {
    const page = Number(_req.query.page || 1);
    const pageSize = Number(_req.query.pageSize || 10);
    const query = String(_req.query.query || "");
    const platform = String(_req.query.platform || "");
    const status = String(_req.query.status || "");
    const result = await listTopicsPaged({ page, pageSize, query, platform, status });
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post("/api/topics", async (req, res) => {
  try {
    const topic = { ...req.body, id: req.body?.id || randomId() };
    await createTopic(topic);
    res.status(201).json({ id: topic.id });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put("/api/topics/:id", async (req, res) => {
  try {
    await updateTopic(req.params.id, req.body || {});
    res.json({ id: req.params.id });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.delete("/api/topics/:id", async (req, res) => {
  try {
    await deleteTopic(req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const storedSettings = await getSettings();
  const { settings = {}, task = "", inspiration = [] } = req.body ?? {};
  const mergedSettings = mergeClientSettings(storedSettings, settings);
  const batchSize = Number(req.body?.batchSize || 5);
  const seed = mergedSettings.personaName || mergedSettings.platform || "内容";
  const apiKey = deepseekApiKey();
  const startedAt = Date.now();

  if (!apiKey) {
    const items = normalizeGenerateItems(Array.from({ length: batchSize }, () => createMockItem(seed)));
    await logGeneration({
      id: randomId(),
      task,
      source: "mock",
      model: "mock-generator",
      batchSize,
      latencyMs: Date.now() - startedAt,
      requestPayload: { settings: mergedSettings, inspiration, batchSize },
      responsePayload: { items }
    });
    return res.json({ items, source: "mock" });
  }

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

  try {
    const result = await callDeepSeek({
      apiKey,
      systemPrompt,
      userPrompt,
      max_tokens: 8192
    });
    const items = normalizeGenerateItems(result.items || []);
    await logGeneration({
      id: randomId(),
      task,
      source: "deepseek",
      model: "deepseek-chat",
      batchSize,
      latencyMs: Date.now() - startedAt,
      requestPayload: { settings: mergedSettings, inspiration, batchSize },
      responsePayload: { items }
    });
    if (!items.length) {
      throw new Error("模型未返回任何 items，请重试或缩短需求描述");
    }
    return res.json({ items, source: "deepseek" });
  } catch (error) {
    await logGeneration({
      id: randomId(),
      task,
      source: "deepseek_error",
      model: "deepseek-chat",
      batchSize,
      latencyMs: Date.now() - startedAt,
      requestPayload: { settings: mergedSettings, inspiration, batchSize },
      responsePayload: { message: error.message }
    });
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/viral/analyze", async (req, res) => {
  const { seed = "", sample = "", settings = {} } = req.body ?? {};
  const storedSettings = await getSettings();
  const mergedSettings = mergeClientSettings(storedSettings, settings);
  const seedTerm = String(seed || mergedSettings.personaName || mergedSettings.platform || "职场").trim() || "职场";
  const sampleText = String(sample || "").trim();
  const apiKey = deepseekApiKey();

  if (!apiKey) {
    const mock = mockViralAnalyze(seedTerm, sampleText);
    return res.json({ source: "mock", ...mock });
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

  try {
    const raw = await callDeepSeek({
      apiKey,
      systemPrompt,
      userPrompt,
      temperature: 0.65,
      max_tokens: 2000
    });
    const normalized = normalizeViralPayload(raw);
    const fallback = mockViralAnalyze(seedTerm, sampleText);
    const topics = normalized.topics.length ? normalized.topics : fallback.topics;
    const titles = normalized.titles.length ? normalized.titles : fallback.titles;
    const note =
      normalized.note ||
      (sampleText ? `已结合样本，按「${seedTerm}」生成选题与标题。` : `已按「${seedTerm}」生成选题与标题。`);

    return res.json({
      source: "deepseek",
      topics,
      titles,
      note
    });
  } catch (error) {
    console.error("[viral/analyze]", error.message);
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    return res.status(400).json({ message: "message 不能为空" });
  }
  const storedSettings = await getSettings();
  const mergedSettings = mergeClientSettings(storedSettings, req.body?.settings || {});
  const apiKey = deepseekApiKey();

  if (!apiKey) {
    return res.json({
      reply:
        "当前为离线模式：未配置 DEEPSEEK_API_KEY，无法回答。请在项目根目录 .env 中配置后重启服务（npm start）。",
      source: "mock"
    });
  }

  const systemPrompt = `你是「灵芽-口播助手」的对话顾问，帮用户解决口播选题、文案结构、表达节奏、平台习惯等问题。
回答要求：简洁、口语化、给可执行建议；不要编造数据；不要输出 JSON 或代码块，只输出自然段文字。
最终必须严格输出一个 JSON 对象，且仅含字段 reply（字符串），reply 里写你要对用户说的全部内容。`;

  const userPrompt = `用户问题：
${message}

（上下文：平台 ${mergedSettings.platform || "未填"}，人设 ${mergedSettings.personaName || "未填"}，受众 ${mergedSettings.audienceProfile || "未填"}）`;

  try {
    const raw = await callDeepSeek({
      apiKey,
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      max_tokens: 2500
    });
    const reply = String(raw?.reply ?? raw?.answer ?? raw?.text ?? "").trim();
    if (!reply) {
      throw new Error("模型未返回有效 reply 字段");
    }
    return res.json({ reply, source: "deepseek" });
  } catch (error) {
    console.error("[chat]", error.message);
    return res.status(500).json({ message: error.message });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    message: error.message || "服务器开小差了",
    code: error.code || "INTERNAL_SERVER_ERROR"
  });
});

app
  .listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    if (!isSupabaseConfigured()) {
      console.warn(
        "[ai-speech] 未配置 Supabase：请在 .env 中设置 SUPABASE_URL 与 SUPABASE_ANON_KEY（或服务端 SUPABASE_SERVICE_ROLE_KEY），并在控制台执行 supabase/schema.sql。"
      );
    }
    if (!deepseekApiKey()) {
      console.warn("[ai-speech] 未配置 DEEPSEEK_API_KEY：生成 / 爆款 / 对话将使用离线或受限模式。");
    }
  })
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[ai-speech] 端口 ${PORT} 已被占用：浏览器可能还在访问「旧版」服务，爆款接口字段对不上会空白。\n` +
          `请先结束旧进程，例如: kill $(lsof -t -i:${PORT})  或改用: PORT=3001 npm start\n`
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
