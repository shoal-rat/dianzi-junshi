# 电子军师后端

这是 v4 桌面 App 的 Bun sidecar。普通用户不需要单独运行这里；Tauri 安装包会自动启动它，并分配随机的 `127.0.0.1` 端口。

主项目说明见 [README](../README.md)，桌面构建见 [desktop](../desktop/README.md)。

## 开发启动

```bash
bun install
bun start
```

默认地址是 `http://127.0.0.1:5177`。开发时可以设置：

```bash
PORT=5180 DIANZI_JUNSHI_HOME=/path/to/test-data bun start
```

不要在没有访问认证的情况下把 `HOST` 改为 `0.0.0.0`。

## 模块

| 文件 | 作用 |
| --- | --- |
| `server.ts` | HTTP、SSE 和 API 路由 |
| `store.ts` | 档案、原始记录、附件和文字上下文 |
| `materials.ts` | 可恢复截图队列、记忆卡和混合检索 |
| `adaptive.ts` | SQLite、sqlite-vec、结果反馈和时间画像 |
| `providers.ts` | Codex、Claude Code、Anthropic 和兼容 API |
| `junshi.ts` | 场景路由、证据上下文和提示词组装 |

## SQLite

数据库位于 `DIANZI_JUNSHI_HOME/memory.sqlite3`，启用 WAL、`synchronous=NORMAL`、外键和 busy timeout。

主要表：

- `material_memories`：截图记忆卡和 384 维 Float32 向量；
- `feedback_events`：用户记录的真实后续；
- `trait_observations`：带时间、来源和置信度的观察；
- `schema_migrations`：结构版本。

`sqlite-vec` 0.1.9 能加载时建立 `vec0` 虚拟表并使用 profile partition KNN。无法加载时，普通表中的向量仍由 TypeScript 做精确余弦检索。

旧 `material-memories.jsonl` 第一次读取时会自动导入 SQLite。JSONL 继续作为可读的恢复日志。

## 结果反馈 API

```http
POST /api/partners/:slug/feedback
Content-Type: application/json

{
  "replyText": "周末一起去看展？",
  "partnerResponse": "好呀，我来订票",
  "outcome": "positive",
  "responseDelayHours": 1,
  "signals": {
    "continued": true,
    "initiated": true,
    "followedThrough": true,
    "rememberedDetail": true
  }
}
```

读取当前时间画像：

```http
GET /api/partners/:slug/adaptive-profile
```

画像分别使用 21 天和 240 天半衰期表示近期与长期；策略后验使用 120 天衰减和 `Beta(1.5, 1.5)` 先验。所有学习 multiplier 都有界，不会覆盖当前事实。

## 批量截图 API

1. `POST /api/partners/:slug/materials/upload`：请求体是单个原始图片流。
2. `POST /api/partners/:slug/material-jobs`：用上传返回的附件对象创建任务。
3. `GET /api/partners/:slug/material-jobs/:id`：查询进度。
4. `POST /api/partners/:slug/material-jobs/:id/resume`：继续或重试失败项。

前端逐个上传；后台逐张分析。产品不设置固定图片张数上限，实际边界是磁盘和 AI 额度。

## AI 连接

| `provider` | App 内填 Key | 图片 |
| --- | --- | --- |
| `codex` | 否，复用本机登录 | `--image`，只读沙箱 |
| `claude-code` | 否，复用本机登录 | 仅开放档案目录 `Read` |
| `claude` | 是 | 支持 |
| `deepseek` | 是 | 当前文本模型不支持 |
| `glm` | 是 | `glm-4v*` 支持 |
| `custom` | 是 | 默认关闭 |
| `demo` | 否 | 不分析真实内容 |

## 验证

```bash
bun run verify
node --check public/app.js
bun run build:app
```

测试覆盖 CLI 事件解析、路径校验、长上下文、旧截图召回和人物近期变化检测。
