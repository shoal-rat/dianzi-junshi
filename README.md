<div align="center">

# 电子军师

### 贴张微信截图，给你三条能直接发的回复。

不会聊、怕翻车、看不懂 ta 什么意思。把聊天丢给它就行。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/装在-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/装在-Codex-0F766E)](platforms/codex.md)
[![ChatGPT](https://img.shields.io/badge/装在-ChatGPT-10A37F)](platforms/chatgpt-instructions.md)
[![English](https://img.shields.io/badge/English-README__EN-lightgrey)](README_EN.md)

</div>

![贴一张截图，出三条能直接发的回复](assets/demo-reply.svg)

---

追人最难的地方，常常不是不会说话。

是你拿不准 ta 这句到底有没有戏，是该接着撩还是先停一下，是那句发出去会不会把人吓跑。朋友圈那点暗示该不该接、约成了之后餐厅和花怎么办，又是另一摊事。

电子军师就管这一摊：读你的聊天，告诉你 ta 什么意思、有没有意思，再给你几句拿来就能发、像人话的回复。

它的路子很轴：

> 先把你这个人聊出来，再低油腻地撩。
> ta 接球，就往前走；ta 不接，别硬舔；明显没戏，体面撤。

## 三步就能用上

![三步：装一次、聊两句、发截图](assets/workflow.svg)

1. **装一次**。复制一行命令，装进你常用的 Claude Code、Codex 或 ChatGPT。
2. **聊两句**。跟它说句「帮我追个人」，它问你几个小问题，自己把档案建好。
3. **发截图**。之后把微信截图或聊天记录丢进去，回复就出来了。

没有一堆命令要背。你正常说话，它知道你要干嘛。

## 它能帮你什么

**看一眼聊天，给三条能发的回复**

拆完 ta 那句话的字面、情绪和真实需求，给你三种说法：稳妥版、会撩版、展示自己版。每条都标了油腻度，也就是这段关系现在能甜到几分；超了它自己会压回来，省得你一脚踩进尴尬里。

**ta 到底有没有意思**

![兴趣度评分，加分减分证据，反舔狗模式止损](assets/demo-interest.svg)

主动找你、记得你说过的话、接得住你的梗、愿意见面，加分；长期只回「嗯嗯」「哈哈」、约了又拖、只在需要帮忙时冒头，减分。开了反舔狗模式，这段明显不值得加码的时候，它会直接拉住你，不陪你自我感动。

**约到了，话和提醒分开放**

![左边是能发给对方的话，右边是只给你看的旁白](assets/demo-dateplan.svg)

左边是照着发就行的话，右边是只给你看的旁白：哪天订位、送不送花、西餐怎么点、聊到什么程度可以提下次。两栏分开，省得你手滑把「记得订餐厅」发出去。

**同时追几个？各记各的，不串戏**

![每次打开先问你这次聊谁，可以选已有对象或新建一个](assets/demo-switch.svg)

不是只能盯着一个人。每个对象一份独立档案，阶段、聊天习惯、什么招对 ta 管用，全分开记。每次打开它先问你这次聊谁，选一个或者新建一个，绝不会把小美的事安到阿强头上。

**还顺手帮你**

- **看朋友圈**：截图丢进去，看妆容、穿搭、滤镜、评论区，帮你找切入点。要用能看图的环境，朋友圈一半信息都藏在图里。
- **换窗口也记得 ta**：每个对象一份本地档案，聊得越多越准。新开一个窗口它自己接上，不用你从头解释一遍。
- **资料自动分类**：聊天记录、截图、自拍、备注，丢一个文件夹给它，它自己分好，不用你先整理。

## 油腻度是什么

不是不让你甜，也不是不让你撩。它只是提醒你：现在这段关系，信号给太满会不会把人吓跑。

| 阶段 | 大概上限 | 感觉 |
| --- | --- | --- |
| 初识 / 暧昧 | 0–1.5 / 5 | 有意思，但别露底 |
| 追求 / 确认 | 2–2.5 / 5 | 可以主动，别逼问 |
| 热恋 / 稳定 | 3–3.5 / 5 | 可以甜，别腻成复读机 |
| 磨合 / 危机 | 0.5–1.5 / 5 | 先降温，别上头 |

## 装一次

macOS / Linux 上的 Claude Code、Codex：

```bash
curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
```

不想跑脚本，手动一行也行（装进 Claude Code 的个人技能目录）：

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME/.claude/skills/dianzi-junshi"
```

ChatGPT 读不到你的本地文件，配置方式另见 [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)。

## 之后怎么用

装好以后打开 Claude Code 或 Codex，它先问你这次聊谁（选已有的，或新建一个），然后正常说话就行：

```text
帮我追个人，先建个档
（贴一张微信截图）这条我该怎么回
ta 这么说是什么意思，我还有戏吗
我想发「你是不是不想理我了」，行不行
ta 答应周末见面了，帮我安排一下
再追一个，帮我新建个对象
```

它会自己判断该分析、该给回复、还是该拉住你。习惯敲命令的话，`/reply`、`/interest`、`/moments`、`/date-plan` 这些它也都认，记不住也无所谓。

## 它的路子

它帮你做的是把你最好的一面亮出来，话说清楚，节奏拿稳。不玩套路和拉扯，那些既掉价又没用。你才是主角，它只是个参谋。

## 你的数据

每个对象一份档案，都存在本地 `partners/`，默认不上传（`.gitignore` 已经排除）。删掉某个对象的文件，它的记忆就跟着没了。

## 许可证

MIT，见 [LICENSE](LICENSE)。
