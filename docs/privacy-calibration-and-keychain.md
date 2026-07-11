# 隐私校准与系统凭据库

## 明确同意

真实结果校准默认关闭。用户必须在 AI 连接设置中主动勾选，应用才会从之后的新反馈生成样本。开启不追溯历史；关闭立即停止新增。

每条校准样本只包含：

- 规划模式
- 取整后的信念、方差和置信度
- 假设概率
- 活跃模式 ID
- 证据类型计数
- 不确定性
- 策略类型和预测分数
- 结果标签、回复时延分箱和布尔行动信号

明确不包含：姓名、档案 slug、聊天原文、截图、实际回复文案、对方回复或 API Key。

用户可以通过设置导出完整 JSON 检查，也可以一键删除本机校准集。数据不会自动上传。只有真实用户主动开启并记录反馈后，样本才属于“consented real-world”；测试与仓库示例始终标记为 synthetic。

## 校准指标

当样本存在时，本机报告计算：样本数、Brier score、平均预测、平均观察结果、五分箱 Expected Calibration Error。小样本只显示趋势，不用于宣称现实效果。

## API Key

桌面主进程提供一个只接受固定供应商名的凭据 CLI。Bun sidecar 通过标准输入把新 Key 交给该进程：

- macOS：Keychain
- Windows：Credential Manager
- Linux：Secret Service

读取到的 Key 只进入 sidecar 内存，不写入 `config.json`。配置文件仅保存 `hasKey: true`。旧版本的明文 Key 会在首次成功写入系统凭据库后从配置删除；迁移失败时保留旧值并报告问题，避免静默丢失。

在非桌面开发模式下，macOS 可直接使用 `security`，Linux 可直接使用 `secret-tool`。没有安全后端时，界面明确提示 Key 只在本次运行中有效。
