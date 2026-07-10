# 电子军师 App

技能版之外的图形界面：本地起一个小服务，浏览器里聊。支持 Claude、DeepSeek、GLM（智谱）和任意 OpenAI 兼容端点，不配 key 也能用演示模式先看流程。

## 跑起来

装好 [Bun](https://bun.sh)（`curl -fsSL https://bun.sh/install | bash` 或 `brew install bun`），然后：

```bash
cd app
bun start        # 启动并自动打开浏览器（http://localhost:5177）
```

首次进去点右下角「演示模式」胶囊 → 选 Claude / DeepSeek / GLM → 填 API key → 保存。数据（key、对象档案、聊天记录）都存在本机 `~/.dianzi-junshi/`，不会进仓库。

## 打成单文件应用

```bash
cd app
bun run build:app
# 产物：app/dist/dianzi-junshi-app（单个可执行文件，双击或命令行运行即可）
```

技能的 references/ 指令文件和整个前端都在构建期内嵌进了可执行文件——拷去别的机器也能直接跑，不需要仓库、不需要装 Bun。

## 里面怎么工作的

- **梗扫描**：你输入时服务端就用 `references/glossary.md` 做确定性匹配，命中的条目注入 prompt（右侧面板可见），没命中的词典整本不进上下文——省 token。
- **车道分诊**：按消息内容路由（日常/情绪/冲突/邀约/拉扯），只加载这次用得上的 reference 模块。
- **人话门禁**：模型输出的每条可复制回复由服务端跑 voice_lint（与 `tools/voice_lint.py` 同词表），FAIL 的标红并提供「一键修」——一次低成本小调用定向改写。
- **Prompt 缓存**：技能层（几万 token）作为稳定前缀，Claude 走 cache_control 显式缓存，DeepSeek 吃自动前缀缓存；连续使用时只为增量付费。
- **零依赖**：没有 node_modules。Bun 原生跑 TypeScript，`--compile` 出单文件应用。

## 供应商说明

| 供应商 | 默认模型 | 看图 | 备注 |
| --- | --- | --- | --- |
| Claude | claude-sonnet-5 | 支持 | 也可选 claude-fable-5 / claude-opus-4-8 / claude-haiku-4-5 |
| DeepSeek | deepseek-chat | 不支持 | deepseek-reasoner 可选，思考过程不显示 |
| GLM（智谱） | glm-4.6 | glm-4v-plus 支持 | |
| 自定义 | 自填 | 视端点 | 任何 OpenAI 兼容 `/chat/completions` |
| 演示模式 | - | - | 不联网，内置示例，仅供体验 UI |

端口：默认 5177，可用 `PORT=xxxx bun start` 改。数据目录可用 `DIANZI_JUNSHI_HOME` 覆盖。
