# 数据库迁移与事件回放

## 数据位置

默认数据库是 `~/.dianzi-junshi/memory.sqlite3`。可以用 `DIANZI_JUNSHI_HOME` 改变整个数据目录。数据库使用 SQLite WAL、外键、5 秒忙等待与普通同步级别，适合单机桌面应用的读写并发。

## 版本

| 版本 | 内容 |
|---|---|
| 1 | 截图记忆、反馈事件、旧版时间画像、可选 sqlite-vec 向量表 |
| 2 | 决策事件、结构化观察、时间事实、决策报告、结果关联、策略后验、证据用途、缓存和阶段指标 |
| 3 | 时间证据图、有效期关系、模式生命周期、去标识化校准样本和历史策略表现 |

迁移只使用 `CREATE TABLE IF NOT EXISTS`、索引创建和 `INSERT OR IGNORE`，因此可重复执行。首次升级时，旧 `feedback_events` 会投影为结果事件，原数据不会删除。

## 事件与投影

不可变事件包括：

- `message.observed`
- `observation.extracted`
- `fact.recorded`
- `decision.completed`
- `outcome.recorded`

`structured_observations`、`strategy_posteriors` 和 `evidence_usefulness` 是可重建投影。`decision_runs` 是不可变审计快照，保留当时看到的证据和选择理由。

`evidence_nodes` 与 `evidence_edges` 保存 observation、fact、decision、strategy 和 outcome 之间的关系。关系包括 `derived_from`、`supports`、`contradicts`、`supersedes`、`used_by`、`selected`、`produced` 与 `outcome_of`，并带有效区间、权重、置信度和来源。

`pattern_registry` 保存自动发现模式的版本和生命周期。手动标记为 `retired` 或 `rejected` 后，自动更新只刷新证据，不会擅自重新启用。

`calibration_examples` 不含档案标识和任何原文，只在用户明确同意后保存未来的新反馈。撤回操作使用软删除，导出接口只返回仍有效的样本。

## 回放

回放会：

1. 按观察时间和写入顺序读取事件。
2. 清空指定档案的可变投影。
3. 重建结构化观察。
4. 按时间重放结果，恢复带衰减的策略后验。
5. 重新计算证据用途。

它不会修改聊天原文、截图、时间事实或历史决策报告。

## 备份与恢复

关闭应用后复制整个 `~/.dianzi-junshi` 目录最简单。应用运行时备份应同时处理主数据库、`-wal` 和 `-shm` 文件，或先执行 SQLite checkpoint。不要把活动中的 WAL 数据库放在网络文件系统上。

## 测试迁移

测试使用临时 `DIANZI_JUNSHI_HOME`，关闭 SQLite 连接后删除目录。`resetAdaptiveDatabaseForTests()` 与 `resetDecisionStoreForTests()` 只用于测试环境。
