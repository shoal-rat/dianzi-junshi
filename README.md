# 电子军师

<div align="center">

**不会恋爱也没事。先把你这个人聊出来，再轻轻撩。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/platform-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/platform-Codex-0F766E)](platforms/codex.md)
[![ChatGPT](https://img.shields.io/badge/platform-ChatGPT-10A37F)](platforms/chatgpt-instructions.md)
[![EN](https://img.shields.io/badge/English-README__EN.md-lightgrey)](README_EN.md)

</div>

---

追人最难的地方，通常不是“不会说话”。

是你不知道 ta 回这句到底算不算有意思；不知道该继续撩，还是该停一下；不知道朋友圈里那点暗示能不能接；也不知道 ta 答应见面以后，餐厅、花、礼物、话术该怎么安排。

电子军师干的就是这件事：帮你读聊天、看反馈、判断有没有戏，然后给你几句能直接发的、人话一点的回复。

它的底层打法很简单：

> 先展示你自己，再低油腻地撩。
> ta 接球，再推进。
> ta 不接，别硬舔。
> 明显没戏，体面撤。

它不会在可复制回复里硬塞尴尬小图标。需要补语气时，会单独给“表情包建议”，告诉你这张图该表达什么、用什么风格、什么时候发、哪里别踩雷。

## 能干什么

`/reply`
看 ta 的消息，拆一下字面意思、情绪、真实需求，然后给你三种说法：稳妥版、会撩版、展示自己/降温版。

`/interest`
看 ta 到底有没有意思。主动找你、问你问题、接你的梗、愿意见面，这些加分；长期只回“哈哈”“嗯嗯”、拒约又不给替代时间，这些减分。

`/anti-simp on`
反舔狗模式。开了以后，如果这段明显不值得加码，军师会直接劝你收手，不陪你自我感动。

`/moments`
看朋友圈、社交动态、截图和照片。重点看图片里的信息：妆容、穿搭、滤镜、场景、评论区互动、文案语气。不是给人打分，是找切入点。

`表情包建议`
可复制回复和表情包建议分开。比如：抽象发疯、奶龙类、线条小狗、Chiikawa、帅气装酷、长辈图反差、沙雕文字。遇到军师不懂的梗，先上网查，查完再写进偏好记忆。

`/import-folder 路径`
你把聊天记录、朋友圈截图、自拍、备注都放进一个文件夹，军师自己分类。你不用先整理。

`/date-plan`
ta 答应见面以后用。它会分成两栏：能复制给 ta 的话，和只给你看的旁白提醒。520、七夕、周末订餐厅、送不送花、西餐怎么点，都放旁白里，避免你手滑发出去。

## 油腻度

油腻度不是不让你甜，也不是不让你撩。它只是提醒你：现在这段关系，信号给太满会不会把人吓跑。

| 阶段 | 大概上限 | 感觉 |
| --- | --- | --- |
| 初识/暧昧 | 0-1.5/5 | 有意思，但别露底 |
| 追求/确认 | 2-2.5/5 | 可以主动，别逼问 |
| 热恋/稳定 | 3-3.5/5 | 可以甜，但别腻成复读机 |
| 磨合/危机 | 0.5-1.5/5 | 先降温，别上头 |

## 开始用

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git
cd dianzi-junshi
```

在 Claude Code 里打开项目，输入：

```text
/junshi
```

建好档案以后，可以这样用：

```text
/reply 你最近忙什么呢
/ask 我想说“你是不是不想理我了”
/interest
/moments
/date-plan
```

Codex 安装见 [platforms/codex.md](platforms/codex.md)。
ChatGPT 配置见 [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)。

## 文件夹导入

把资料放一起就行：

```text
/import-folder C:\Users\你\Desktop\ta资料
```

会被分成：

- 聊天记录
- 朋友圈/社交动态截图
- 自拍、穿搭、妆容、头像
- 备注和对象画像
- 其他暂时看不出的文件

看图这件事要用能看图片的环境。只读文字不够，朋友圈很多信息都在照片里。

## 本地档案

档案在 `partners/`，默认不提交。

里面会记：

- ta 的聊天习惯和潜台词
- 兴趣度变化
- 朋友圈展示面
- 妆容、穿搭、审美、口头禅
- MBTI/星座态度、忌口、礼物偏好
- 表情包/梗偏好，比如抽象、可爱、帅气、长辈图反差，哪些能用哪些别用
- 哪些话对 ta 有用，哪些会冷场
- 你真实会怎么说话

## 命令

```text
/junshi               建档
/reply [消息]         看消息，给回复
/analyze [消息]       只分析，不给回复
/ask [我想说...]      判断这句话能不能发
/interest             看 ta 有没有意思
/anti-simp on/off     开关反舔狗模式
/moments              看朋友圈/截图
/date-plan            邀约和见面旁白
/import-folder [路径] 扫描资料文件夹
/upload-followup      看后续反馈，更新记忆
/stage [0-7]          改关系阶段
/memory               看记忆
/stats                看策略效果
/my-style             更新你的说话风格
/list-partners        看所有档案
```

## 工具

```bash
python tools/wechat_parser.py --file chat_log.txt --target "她的名字"
python tools/import_folder.py --path "C:\Users\你\Desktop\ta资料"
python tools/profile_manager.py --action init --slug xiaomei --name 小美 --stage 1 --anti-simp
python tools/session_log.py --action stats --slug xiaomei
python tools/skill_check.py
```

## 底线

不做 PUA，不教查岗，不教冷暴力，不教骗，不教诱导嫉妒。
军师只是帮你把话说清楚一点，把节奏拿稳一点。你才是主角。

## 许可证

MIT，见 [LICENSE](LICENSE)。
