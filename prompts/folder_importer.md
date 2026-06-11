# 文件夹自动导入

## 任务

用户不需要自己分类聊天记录、朋友圈截图、照片和笔记。用户只要提供一个文件夹路径，系统自动扫描、分类、生成导入清单，并决定下一步该读哪些文件、看哪些图片、问哪些最少的问题。

---

## 触发方式

```text
/import-folder C:\path\to\materials
/import C:\path\to\materials
资料都在这个文件夹：...
```

---

## 流程

1. 运行 `tools/import_folder.py --path "{folder}" --output partners/{slug}/materials/import_manifest.json`。
2. 读取生成的 Markdown 摘要和 `partners/{slug}/materials/image_observations.jsonl` 模板。
3. 按类型处理：
   - 聊天记录文本：用 `tools/wechat_parser.py` 或直接分析。
   - 朋友圈/社交动态截图：必须使用多模态模型观察图片，不只做 OCR，并逐张补全结构化记录。
   - 照片/自拍/穿搭/妆容：使用多模态模型提取外貌展示、妆容风格、拍照风格、场景、审美偏好，并逐张补全结构化记录。
   - 聊天截图：必须记录谁主动、谁接球、有没有反问、有没有邀约、有没有降温信号。
   - 文档/笔记：读取文本，提取对象信息。
   - 未知文件：先列出，不强行处理。
4. 自动归类后再问用户最多 1 个问题：当前要优先分析“聊天记录”“朋友圈画像”还是“邀约策略”。

---

## 分类标准

| 类型 | 文件特征 | 后续处理 |
|------|----------|----------|
| `chat_text` | `.txt/.csv/.json/.md` 且名称含 chat/wechat/聊天/记录 | 提取对话模式、兴趣度、口头禅 |
| `moments_image` | 图片且名称含 朋友圈/moments/小红书/微博/动态 | 多模态分析展示主题和互动 |
| `appearance_image` | 图片且名称含 自拍/照片/穿搭/妆/头像 | 多模态分析外貌展示、妆容、审美 |
| `screenshot` | 图片且名称含 screenshot/截图 | 先多模态判断内容，再归类 |
| `notes` | `.md/.txt/.docx` 且名称含 note/备注/画像 | 提取用户描述和关键事实 |
| `unknown` | 无法判断 | 保留路径，等用户确认 |

---

## 多模态要求

朋友圈和照片类材料不能只靠文字：

- 直接打开原图全分辨率做视觉检查（不是缩略图），Claude Code 和 Codex 都能读本地文件、看图，不用让用户描述。`image_observations.jsonl` 里存的是原图 `path`，认这个原图；字密或图大就分区域放大看（见 SKILL.md「图片读取规则」）。
- 看图片内容：人像、妆容、穿搭、场景、构图、滤镜、同行人、食物/地点/活动。
- 看文案：语气、情绪、梗、微信内置表情、表情包痕迹、时间。
- 看互动：评论对象、评论语气、点赞/回复方式、是否有固定朋友群。
- 看连续性：同类内容是否反复出现，避免单张图过度推断。
- 看表情包和梗：遇到不确定的热梗、IP 或表情包风格，先上网查再记录到偏好记忆。
- 看行动证据：图里如果是聊天截图，要优先看主动、反问、接球、邀约和兑现，不要被文案甜度带偏。

输出所有判断时必须写“可见证据”。

---

## 图片结构化留痕

导入后，每一张图片都要在 `partners/{slug}/materials/image_observations.jsonl` 里保留一条记录。`tools/import_folder.py` 会先生成空模板；多模态分析后要更新字段，不要只在最终结论里口头概括。

每条 JSONL 至少包含：

```json
{
  "image_id": "img_0001",
  "path": "C:/path/to/image.png",
  "category": "screenshot",
  "review_status": "reviewed",
  "visible_context": "微信聊天截图/朋友圈/自拍/未知",
  "initiator": "user/partner/both/unknown/not_applicable",
  "receiver_response": "caught/partial/missed/shifted/unknown/not_applicable",
  "has_counter_question": true,
  "has_invite": false,
  "invite_detail": "",
  "action_fulfillment": "fulfilled/pending/failed/not_applicable/unknown",
  "warming_signals": ["接梗", "主动补细节"],
  "cooling_signals": ["只答不问", "拒约不给替代时间"],
  "commitment_signals": [],
  "visible_evidence": ["对方问了'你呢'", "用户发出邀约但对方未给时间"],
  "stage_evidence": "只能支持暧昧/普通聊天，不能支持热恋",
  "confidence": "high/medium/low",
  "notes": ""
}
```

如果图片不是聊天截图，也要保留记录，把不适用字段写成 `not_applicable`，并在 `visible_context` 和 `visible_evidence` 中说明看到了什么。

最终分析必须能回指到图片记录，例如“img_0012 和 img_0017 都是用户主动邀约，对方没有给替代时间，所以见面/行动兑现分低”。

## 输出格式

```markdown
## 导入摘要

文件夹：{path}

### 自动分类
- 聊天记录：{N} 个
- 朋友圈/社交动态截图：{N} 个
- 外貌/穿搭/妆容图片：{N} 个
- 笔记/描述：{N} 个
- 未分类：{N} 个

### 建议优先级
1. {先分析什么 + 理由}
2. {第二步看什么 + 理由}

### 下一步
我会先处理：{类别}
如果你想改优先级，直接说“先看朋友圈”或“先看聊天记录”。
```
