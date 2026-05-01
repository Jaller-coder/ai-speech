# 灵芽口播助手

纯静态前端：AI 口播选题与文案工作台。数据存 **Supabase**，生成 / 对话 / 爆款分析走 **DeepSeek**，可部署在 **Netlify** 等静态托管，无需自建 Node 后端。

## 功能概览

- **AI 对话**：Agent 批量生成口播包、Ask 答疑；侧栏 **爆款参考** 按关键词拉选题与标题并可注入对话
- **选题库**：分页、筛选、行内编辑，数据直连 Supabase
- **生成偏好**：人设与语气等设置，存 `app_settings`

## 技术栈

| 部分 | 说明 |
|------|------|
| 页面 | `index.html` + `app.js` + `styles.css` |
| 数据库 | Supabase（PostgreSQL），见 `supabase/schema.sql` |
| AI | DeepSeek Chat Completions API（浏览器 `fetch`） |
| 部署 | Netlify；构建时用 `scripts/netlify-inject.mjs` 注入密钥 |

## 目录结构

```
├── index.html              # 入口（NETLIFY_CONFIG 占位，构建时被替换）
├── app.js                  # 业务逻辑
├── styles.css              # 样式
├── netlify.toml            # 发布目录与构建命令
├── package.json            # npm run inject
├── scripts/
│   └── netlify-inject.mjs  # 构建：把环境变量写入 index.html
└── supabase/
    └── schema.sql          # 建表与 RLS（需在控制台执行）
```

## Supabase 准备

1. 新建项目，打开 **SQL Editor**。
2. 执行仓库中的 `supabase/schema.sql`（创建 `topics`、`app_settings`、`generation_logs` 等）。
3. 在 **Project Settings → API** 获取：
   - **Project URL**（形如 `https://xxx.supabase.co`，不要带 `/rest/v1`）
   - **anon public** 或 **publishable** 密钥
4. 按业务收紧 **RLS**；浏览器会使用 anon 密钥访问数据库。

## Netlify 部署

1. 将仓库连接到 Netlify，使用默认分支构建。
2. 在 **Site configuration → Environment variables** 添加（Production / Preview 按需勾选）：

   | 变量 | 说明 |
   |------|------|
   | `DEEPSEEK_API_KEY` | DeepSeek API Key（**必填**，缺则构建失败） |
   | `SUPABASE_URL` | Supabase 项目 URL |
   | `SUPABASE_ANON_KEY` | anon 公钥；也可使用 `SUPABASE_PUBLISHABLE_KEY` |

3. `netlify.toml` 已配置：

   ```toml
   [build]
     publish = "."
     command = "node scripts/netlify-inject.mjs"
   ```

4. 触发部署。构建成功后，页面内的 `window.__speakSupabase` 与 `window.__DEEPSEEK_API_KEY` 由注入脚本写入。

**注意：** 不要将「已注入真实密钥」的 `index.html` 提交到 Git；仓库中应始终保持占位空串。

## 本地开发

需要 **Node.js**（用于注入脚本）。

1. 复制环境变量（勿提交）：

   ```bash
   # 在项目根创建 .env（已被 .gitignore 忽略），例如：
   # DEEPSEEK_API_KEY=sk-...
   # SUPABASE_URL=https://xxx.supabase.co
   # SUPABASE_ANON_KEY=eyJ... 或 sb_publishable_...
   ```

2. 生成带密钥的 `index.html`（可选，用于本地联调）：

   ```bash
   npm run inject
   ```

3. 用静态服务器打开站点（避免 `file://` 带来的限制）：

   ```bash
   npx serve .
   ```

若未配置完整变量，注入脚本会告警，页面可能以「离线示例」运行 DeepSeek 相关能力。

## 安全说明

- 部署后的 HTML **可见** Supabase anon 与 DeepSeek Key，访客可在开发者工具中看到；这是静态站「全员共用一把钥匙」模式的固有风险。
- 务必配置 **RLS**、监控 **DeepSeek 用量与费用**；更高安全需 **服务端或 Edge 函数** 代理 AI 与敏感操作。

## 脚本说明

- `npm run inject`：等价于 `node scripts/netlify-inject.mjs`，读取 `process.env` 与可选的 `.env`，替换 `index.html` 中 `<!-- NETLIFY_CONFIG_START -->` … `<!-- NETLIFY_CONFIG_END -->` 整块；并对全文中 `DEEPSEEK_API_KEY_PLACEHOLDER` 做全局替换（若存在）。

## 许可证

Private（见 `package.json`）。
