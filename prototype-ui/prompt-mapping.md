# 人设驱动生成：Prompt 参数映射

这份文档把页面上的设置项，映射到 DeepSeek 请求中的可控参数，目标是：

- 输出稳定
- 风格统一
- 可追踪可调优

---

## 1) 设置项到 Prompt 字段映射

| 设置页字段 | Prompt 字段名 | 用途 |
|---|---|---|
| 默认平台 | `platform` | 控制内容平台语境、长度、表达方式 |
| 账号人设名称 | `persona_name` | 固定输出口吻和立场 |
| 目标用户画像 | `audience_profile` | 控制痛点、案例和表达颗粒度 |
| 默认语气风格 | `tone_style` | 统一全局风格（朋友式/干货/犀利/陪伴） |
| 语气细节词 | `tone_details` | 微调句式与词汇偏好 |
| 开头钩子偏好 | `hook_style` | 控制开头写法（提问/痛点/反常识） |
| 正文结构模板 | `body_framework` | 固定正文组织逻辑 |
| 结尾 CTA 模板 | `cta_template` | 统一“结尾升华+一键三连” |
| 禁用词与风险词 | `risk_blacklist` | 安全过滤，规避违规表达 |
| 封面标题风格 | `cover_title_style` | 控制封面标题长度与情绪度 |
| 正文标题风格 | `body_title_style` | 控制正文标题稳健度 |
| 爆款灵感来源 | `inspiration_inputs` | 只借鉴角度和结构，不复刻内容 |

---

## 2) 系统提示词模板（建议固定）

```text
你是中文内容策划与文案助手，服务于自媒体创作者。

硬性要求：
1. 输出内容必须原创，禁止复刻或改写为近似于输入样本的文案。
2. 允许借鉴：选题方向、看问题角度、结构节奏、标题表达方式。
3. 禁止借鉴：原句、特定表达组合、连续关键词串。
4. 封面标题可以更有情绪，但不得包含夸大承诺、绝对化措辞或风险词。
5. 正文标题要简洁、稳健、信息清晰。
6. 文案口语化、可直接发布，符合用户日常表达习惯。
7. 必须遵守 risk_blacklist，不输出其中词语或其明显变体。

输出必须是 JSON，且字段完整，不要额外解释文本。
```

---

## 3) 用户提示词模板（动态注入）

```text
请基于以下参数生成内容：

【平台】{{platform}}
【人设】{{persona_name}}
【目标用户】{{audience_profile}}
【语气风格】{{tone_style}}
【语气细节】{{tone_details}}
【开头钩子偏好】{{hook_style}}
【正文结构模板】{{body_framework}}
【结尾 CTA 模板】{{cta_template}}
【禁用词】{{risk_blacklist}}
【封面标题风格】{{cover_title_style}}
【正文标题风格】{{body_title_style}}
【灵感输入（仅借鉴角度）】{{inspiration_inputs}}
【本次需求】{{user_task}}

请生成 {{batch_size}} 条内容，每条必须包含：
1) topic
2) hook
3) body
4) ending_cta
5) cover_title
6) body_title
7) search_keywords (3-8个)
```

---

## 4) 输出 JSON Schema（前后端约定）

```json
{
  "items": [
    {
      "topic": "string",
      "hook": "string",
      "body": "string",
      "ending_cta": "string",
      "cover_title": "string",
      "body_title": "string",
      "search_keywords": ["string"]
    }
  ]
}
```

---

## 5) 生成流程建议（稳定版）

1. `灵感解析阶段`
   - 输入：爆款标题/封面描述/链接摘要
   - 输出：角度、结构、情绪关键词（不含可抄袭原句）

2. `结构化生成阶段`
   - 先生成 `topic + cover_title + body_title + search_keywords`
   - 再补写 `hook + body + ending_cta`

3. `质检阶段`
   - 风险词检查（命中 blacklist 则重写）
   - 重复度检查（同批次相似度过高则重写）
   - 可读性检查（过长句、AI腔）后微调

---

## 6) DeepSeek 请求体示例（可直接改）

```json
{
  "model": "deepseek-chat",
  "temperature": 0.8,
  "max_tokens": 2200,
  "response_format": {
    "type": "json_object"
  },
  "messages": [
    {
      "role": "system",
      "content": "你是中文内容策划与文案助手...（系统提示词模板）"
    },
    {
      "role": "user",
      "content": "请基于以下参数生成内容...（用户提示词模板）"
    }
  ]
}
```

---

## 7) 字段调优建议

- 结果太像别人：提高“原创约束”，并减少 `inspiration_inputs` 原文长度，只保留结构标签。
- 语气不稳定：降低 `temperature`（0.65~0.75）并增强 `tone_details`。
- 标题不够吸引：放宽 `cover_title_style` 情绪强度，保留 `risk_blacklist`。
- 文案太空：在 `audience_profile` 增加真实场景词（如“加班后焦虑、绩效面谈前紧张”）。
