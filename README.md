# 电子军师

<div align="center">

**帮不会恋爱的人，把自己展示出来，低油腻地撩，清醒判断有没有戏。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/platform-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/platform-Codex-0F766E)](platforms/codex.md)
[![ChatGPT](https://img.shields.io/badge/platform-ChatGPT-10A37F)](platforms/chatgpt-instructions.md)
[![EN](https://img.shields.io/badge/English-README__EN.md-lightgrey)](README_EN.md)

</div>

---

你不是不会聊天，你只是经常不知道：

- ta 这句话到底是有意思、礼貌，还是在敷衍？
- 我该继续追，还是该收手？
- 怎么展示自己，才不像查户口，也不像舔？
- 怎么撩一下，但油腻度别爆表？
- ta 的朋友圈看起来是什么类型，应该从哪里切入？
- ta 答应见面以后，520/七夕/周末要不要订餐厅、送花、准备礼物？

**电子军师**是一个面向中文聊天场景的恋爱辅助 skill。它运行在 Claude Code、Codex 或 ChatGPT 里，帮你分析聊天、判断兴趣度、生成自然回复，并把每次反馈写进本地档案，越用越懂你们。

它不是 PUA 脚本。核心策略是：

> 先展示自己，再适当撩；对方接球再推进，不接就降温；明显没戏就体面止损。

---

## 核心能力

### 1. 三层消息解读

每条消息都拆成：

```text
表面：ta 字面上说了什么
情绪：ta 当下可能是什么状态
需要：ta 真正想从你这里得到什么
```

同时标注证据和置信度，避免 AI 一上来就读心过头。

### 2. 油腻度控制

保留中文互联网最有用的那个梗：**油腻度**。

| 阶段 | 上限 | 建议 |
| --- | --- | --- |
| 初识/暧昧 | 0-1.5/5 | 展示自己，轻轻给信号，别露底 |
| 追求/确认 | 2-2.5/5 | 可以主动，但别逼对方表态 |
| 热恋/稳定 | 3-3.5/5 | 可以甜，可以撩，但别重复腻 |
| 磨合/危机 | 0.5-1.5/5 | 先降温，有边界，有尊严 |

### 3. 默认三方案

每次 `/reply` 默认给：

- **稳妥版**：不翻车，不尬聊。
- **会撩版**：有点暧昧，但油腻度不超标。
- **展示自己版 / 真诚版 / 降温版**：根据场景选择，让你不是一直围着 ta 转。

### 4. 兴趣度判断

`/interest` 会根据聊天证据给 `0-10` 兴趣分：

- 主动找你、问你问题、接梗、记得细节、愿意见面：加分。
- 只礼貌回复、长期不主动、拒约不给替代时间、只找你帮忙：减分。

不是看单次秒回，也不是靠玄学。看的是连续反馈。

### 5. 反舔狗模式

首次建档可以开启，也可以之后运行：

```text
/anti-simp on
```

开启后，如果 ta 明显没兴趣，军师会直接告诉你：

```text
这段目前不值得继续加码。
建议：停止追问，收回注意力，体面撤退，换下一个。
```

不羞辱你，也不骂 ta。就是清醒。

### 6. 朋友圈/截图画像

`/moments` 支持用多模态模型分析朋友圈、社交动态、截图和照片：

- ta 在展示什么：生活、审美、成就、情绪、社交、神秘感？
- 外貌展示、妆容特点、穿搭风格、滤镜和拍照审美是什么？
- 评论区/点赞/回复互动方式是什么？
- 可能是什么聊天类型？
- 哪些话题能聊，哪些别碰？
- 你应该怎么展示自己，怎么低油腻地切入？
- MBTI、星座态度、口头禅、忌口、礼物偏好等微信息怎么记？

上传前建议遮住真实姓名、头像、学校、公司、定位等隐私。

### 7. 文件夹自动导入

你不需要自己分类材料。

```text
/import-folder C:\Users\你\Desktop\ta资料
```

系统会自动扫描并分类：

- 聊天记录
- 朋友圈/社交动态截图
- 自拍/穿搭/妆容/头像图片
- 备注和对象画像
- 未分类文件

朋友圈和照片类会提示使用多模态模型看图，不只靠 OCR。

### 8. 邀约/约会旁白栏

当你发起邀约或 ta 接受邀约时，`/date-plan` 会把内容分成两栏：

- **可复制回复**：只包含能发给 ta 的话。
- **旁白提醒（不要复制给 ta）**：订餐厅、节日、花/礼物、穿搭、礼仪、现场节奏。

例如 520/七夕/周末热门餐厅要提前订，西餐点菜顺序、花材选择、要不要礼物都会放在旁白栏，不会混进可复制回复。

### 9. 长期记忆

所有对象档案默认存在本地 `partners/`：

- ta 的沟通风格
- 潜台词字典
- 兴趣度变化
- 朋友圈画像
- 妆容/穿搭/外貌展示风格
- MBTI/星座态度/忌口/礼物偏好/口头禅
- 约会偏好
- 哪些策略有效/无效
- 你的真实说话风格

`partners/` 已被 `.gitignore` 排除，不会默认提交。

---

## 快速开始

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git
cd dianzi-junshi
```

### Claude Code

在 Claude Code 中打开项目，然后输入：

```text
/junshi
```

按引导建档，之后可以用：

```text
/reply 你最近忙什么呢
/ask 我想说“你是不是不想理我了”
/interest
/moments
/date-plan
```

### Codex

见 [platforms/codex.md](platforms/codex.md)。推荐安装到：

```text
$HOME/.agents/skills/dianzi-junshi
```

调用示例：

```text
Use $dianzi-junshi to analyze this message and give me a low-oiliness flirting reply.
```

### ChatGPT

见 [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)。

如果要做自定义 GPT，可以先生成单文件知识包：

```bash
python tools/build_chatgpt_pack.py
```

然后上传 `dist/dianzi-junshi-chatgpt-pack.md`。

---

## 命令速查

```text
/junshi               建立对象档案
/import-folder [路径] 自动导入并分类资料文件夹
/reply [消息]         分析并生成回复
/analyze [消息]       只分析，不生成回复
/ask [我想说...]      判断这句话能不能发
/interest             判断 ta 对你有没有意思
/anti-simp on/off     开关反舔狗模式
/moments              分析朋友圈/社交动态截图
/date-plan            邀约/约会回复和旁白提醒
/upload-followup      上传后续聊天，分析效果并写入记忆
/stage [0-7]          更新关系阶段
/memory               查看记忆
/stats                查看策略效果统计
/update-partner       更新对象档案
/my-style             更新你的风格
/list-partners        查看所有档案
```

---

## 工具

### 聊天记录分析

```bash
python tools/wechat_parser.py \
  --file chat_log.txt \
  --target "她的名字" \
  --output partners/xiaomei/materials/analysis.txt
```

会提取消息长度、语气词、低质量短回复比例、主动分享比例、问句比例、邀约线索等。

### 文件夹导入

```bash
python tools/import_folder.py \
  --path "C:\Users\你\Desktop\ta资料" \
  --output partners/xiaomei/materials/import_manifest.json
```

会生成 JSON 和 Markdown 清单，后续用多模态模型分析图片类材料。

### 档案管理

```bash
python tools/profile_manager.py --action init --slug xiaomei --name 小美 --stage 1 --anti-simp
python tools/profile_manager.py --action list
```

### 对话记录

```bash
python tools/session_log.py --action log --slug xiaomei --strategy 会撩版 --outcome good --interest-delta +1 --caught-flirt
python tools/session_log.py --action stats --slug xiaomei
```

### 项目自检

```bash
python tools/skill_check.py
```

---

## 项目结构

```text
dianzi-junshi/
├── SKILL.md
├── agents/openai.yaml
├── prompts/
│   ├── interest_detector.md
│   ├── moments_analyzer.md
│   ├── date_planner.md
│   ├── folder_importer.md
│   ├── message_analyzer.md
│   ├── reply_generator.md
│   └── ...
├── references/
│   └── evidence_frameworks.md
├── platforms/
│   ├── codex.md
│   └── chatgpt-instructions.md
├── tools/
└── partners/       # 本地档案，不提交
```

---

## 原则

- 保留“油腻度”“会撩”“反舔狗模式”这些中文互联网好用的词。
- 判断有没有戏，以聊天证据和人类经验为主，不拿论文套人。
- 不生成 PUA、胁迫、冷暴力、查岗、欺骗、诱导嫉妒或隐私刺探建议。
- 所有建议只是选项，你始终是主角。

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
