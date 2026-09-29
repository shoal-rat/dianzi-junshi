/**
 * 演示模式：不联网，用写好的几段示范回答把界面走一遍。
 * 格式和真模型完全一样（judge / 锦囊 / 推荐），方便没配 AI 的人先看效果。
 */

import type { Mode } from "../shared/domain";

const TAIL = "\n\n（这是演示模式的示范回答，没有真的读你的内容。去「连接」里选一个 AI，军师就能真的帮你看了。）";

function pick(text: string): "meme" | "invite" | "tired" | "general" {
  if (/那咋了/.test(text)) return "meme";
  if (/鸽|周六|周末|约|见面|订/.test(text)) return "invite";
  if (/累|加班|烦|困|emo/.test(text)) return "tired";
  return "general";
}

const REPLY: Record<ReturnType<typeof pick>, string> = {
  meme: `\`\`\`judge
判断：这是理直气壮的撒娇嘴硬，心情不错，在等你接梗
批：那咋了｜梗：可爱地硬刚，意思是「就爱睡怎么了」，不是不耐烦
表面：她承认自己睡到中午
情绪：放松、带点炫耀——在玩
需要：被逗——想看你怎么接
\`\`\`

### 稳 · 认怂接梗 · 油0.5
\`\`\`reply
没咋 羡慕的声音大了点
\`\`\`
秒怂加自嘲，接成她赢了，话题轻松续命。

### 撩 · 顺梗埋钩 · 油1.5
\`\`\`reply
挺好 记住了
以后约你只敢约下午场
\`\`\`
「以后会约你」藏在玩笑里，她接不接都不尴尬。

### 奇 · 同款回敬 · 油1
\`\`\`reply
那咋了 我也爱赖床
咱俩谁也别笑话谁
\`\`\`
镜像她的句式，同频感最强。

推荐：奇｜镜像她自己的梗最安全，还显得你俩一个频道
别这样回：睡懒觉对身体不好｜一句话杀死一个梗，爹味拉满`,
  invite: `\`\`\`judge
判断：她已经在安排你们的周六了，这是明牌的好感，稳稳接住
批：我们｜她说的是「我们」，已经把你算进去了
批：别放我鸽子｜半开玩笑的在意：她怕你不当回事
批：哈哈｜两个哈是缓冲，把「在意」说得轻一点
表面：她订好了周六那家店的位子
情绪：期待——带一点点怕你不来
需要：被认真对待——要一个确定的回应
阶段：暧昧期（她主动订位，行动证据很硬）
兴趣：甜度7 主动8 承诺5 行动8 总体7 置信中
\`\`\`

### 稳 · 给个准话 · 油0.5
\`\`\`reply
收到 周六准时到
鸽谁也不鸽你
\`\`\`
她要的就是确定感，先给准话。

### 撩 · 反将一军 · 油1.5
\`\`\`reply
你订的位子 我哪敢鸽
倒是你 别到时候睡过头
\`\`\`
接住在意，再把玩笑抛回去，暧昧感拉满。

### 奇 · 顺手加戏 · 油1
\`\`\`reply
行 那吃完我带你去附近那家甜品
算我回请
\`\`\`
把一顿饭延长成一段约会，推进自然。

推荐：撩｜她给的信号够明确，可以撩一点回去
别这样回：好的 到时候见｜太像回工作消息，把她的期待浇凉了

\`\`\`aside
预约：她已经订好位了，你提前查一下路线，别迟到
现场：她说「别放鸽子」是在意，当天早点到、发一句「我到了」
下一步：吃完顺势提下一次，别当场逼确认
\`\`\``,
  tired: `\`\`\`judge
判断：她累坏了在找人接住，这时候陪着比出主意重要
批：好累｜要的是被心疼，不是被指导
表面：加班到很晚
情绪：疲惫、有点委屈
需要：被陪伴——有人站她这边
\`\`\`

### 稳 · 先接住 · 油0.5
\`\`\`reply
累成这样
先瘫着 什么都别想
\`\`\`
不给建议，先让她觉得被看见。

### 撩 · 给点甜 · 油1.5
\`\`\`reply
这么累还回我
感动住了
\`\`\`
轻调侃里带在乎，不索取回应。

### 奇 · 给个实在的 · 油1
\`\`\`reply
给你点了杯热的
十分钟后到楼下 记得拿
\`\`\`
比一百句「辛苦了」都管用，前提是你知道她的地址。

推荐：稳｜她现在需要的是被接住，撩可以留到她缓过来
别这样回：早点休息 多喝热水｜标准的敷衍关怀，她只会更累`,
  general: `\`\`\`judge
判断：普通的日常分享，接住细节、顺手展示一下自己就好
表面：她在跟你说今天的事
情绪：平常心，带点分享欲
需要：被回应——有来有回
\`\`\`

### 稳 · 接细节 · 油0
\`\`\`reply
然后呢
后来咋样了
\`\`\`
追问细节是最稳的续话方式。

### 撩 · 留个钩子 · 油1
\`\`\`reply
你这么一说我有点好奇
改天当面讲给我听
\`\`\`
把线上聊天往线下引一点点。

### 奇 · 展示自己 · 油0.5
\`\`\`reply
我今天也遇到个离谱的事
等你忙完讲给你听
\`\`\`
给她一个反过来问你的理由。

推荐：稳｜信息还少，先多接几轮看看她的热度
别这样回：哦 挺好的｜「哦」是聊天终结者`,
};

const READ = `\`\`\`judge
判断：她在用玩笑包着在意，接住在意，别只接玩笑
批：别放我鸽子｜半开玩笑的在意，真实意思是「你要当回事」
表面：她订好了位子，提醒你别爽约
情绪：期待——带一点点不安
需要：被认真对待——一个确定的回应
阶段：暧昧期（她主动订位，行动证据很硬）
\`\`\`

- 类型：分享喜悦 + 轻度试探——她把安排做好了，在看你的态度
- 风险：有——回得太随意，她会觉得只有她在当真
- 回复方向：先给准话，接着接住她的玩笑，别只回一个「好」`;

const POLISH = `\`\`\`judge
判断：意思没问题，就是太急了，一句话把底全交了
表面：你想问她是不是对你没兴趣了
情绪：她收到会有压力——这是一道必答题
\`\`\`

\`\`\`verdict
结论：需要调整
适配：4
油腻：3（上限1.5）
需求感：高
撩感：压迫感强
翻车点：把不确定变成必答题，她只能说「没有啊」然后更想躲
时机：适合她主动找你的时候；别在她已读不回之后
\`\`\`

### 稳 · 轻松版 · 油0.5
\`\`\`reply
你消失得有点彻底
我还以为把天聊死了
\`\`\`
意思一样，但给了她一个笑着回来的台阶。

### 撩 · 把球推回去 · 油1
\`\`\`reply
最近很忙嘛
忙完记得来找我玩
\`\`\`
不追问原因，只留一个邀请。

推荐：稳｜先让对话恢复热度，再看她的反应`;

const ODDS = `\`\`\`judge
判断：甜话不少，但一到见面就打太极——现在是「会聊」，不是「有戏」
阶段：暧昧期（聊得甜，但约了两次都没落地）
兴趣：甜度7 主动4 承诺2 行动2 总体4 置信中
海王：45
追法：高选择权型 · 拉扯2
气质：偏痞
\`\`\`

- 加分证据：会接梗、会主动分享日常
- 减分证据：两次邀约都说「下次」，没给替代时间；深夜才热
- 模仿度：开始用你的「救命」了，但表情包还是各用各的
- 近期玩家信号：画饼——「等忙完一定」出现两次
- 下一步测试：低成本邀约测试——给两个具体时间，看她选不选

\`\`\`strategy
回复间隔：1-4 小时
消失建议：本轮收尾
拉扯动作：邀约测试
看反馈：她会不会给一个具体时间
\`\`\`

### 奇 · 邀约测试 · 油1
\`\`\`reply
周四晚上或者周六下午
你挑一个 我请你喝那家咖啡
\`\`\`
两个选项、有具体地方，她选不选一眼就知道。`;

// ---------------------------------------------------------------------------
// English demo — written for English-language chats, not translated.
// {they}/{them}/{their}/{They} are filled from the profile's gender.

const TAIL_EN = "\n\n(This is a demo answer — it didn't actually read your message. Pick an AI connection in Settings and Junshi will read it for real.)";

function pickEn(text: string): "banter" | "plans" | "tired" | "general" {
  if (/\b(cooked|delulu|no cap|mid|down bad|rent free|lowkey)\b/i.test(text)) return "banter";
  if (/flake|bail|saturday|friday|weekend|reservation|table|booked|dinner|drinks/i.test(text)) return "plans";
  if (/tired|exhausted|long day|rough day|stressed|work/i.test(text)) return "tired";
  return "general";
}

const REPLY_EN: Record<ReturnType<typeof pickEn>, string> = {
  banter: `\`\`\`judge
Verdict: {They}'re being dramatic on purpose — it's a bit, and {they} want{s} you to play along
Note: cooked | slang for "doomed" — a joke, not an actual crisis
Surface: {They} slept through {their} alarm and called {themself} cooked
Emotion: playful — performing the chaos
Need: to be played with — see if you'll join the bit
\`\`\`

### Steady · Join the bit · thirst 0.5
\`\`\`reply
respectfully you were cooked the second you hit snooze
\`\`\`
Plays along and teases back — easy, fun, keeps it going.

### Flirt · Tease with a hook · thirst 1.5
\`\`\`reply
tragic
guess I'll have to supervise your mornings
\`\`\`
The hook is hidden in the joke — they can pick it up or laugh it off.

### Wildcard · Same energy back · thirst 1
\`\`\`reply
we're both cooked
I've been awake for 20 minutes and I'm already tired
\`\`\`
Mirroring the bit is the safest, strongest move.

Pick: Wildcard | matching {their} bit is the fastest way to feel like the same wavelength
Don't send: you should set two alarms | turns a joke into a lecture`,
  plans: `\`\`\`judge
Verdict: {They} already booked the table — that's a real move, lock it in and have fun with it
Note: don't flake on me | half-joking, but {they} actually care{s} that you show up
Note: lol | softens the ask so it doesn't sound needy
Surface: {They} made a reservation for Saturday and told you not to bail
Emotion: excited — with a tiny worry you won't take it seriously
Need: reassurance — a clear yes
Stage: Talking stage ({they} set up the date — strong action signal)
Interest: sweet 7 initiative 8 commitment 5 action 8 overall 7 confidence med
\`\`\`

### Steady · Clear yes · thirst 0.5
\`\`\`reply
wouldn't miss it
what time should I be there?
\`\`\`
{They} want{s} certainty — give it, then lock the time.

### Flirt · Throw it back · thirst 1.5
\`\`\`reply
flake on a table you booked? never
you're the one I'm worried about
\`\`\`
Takes the care seriously, then hands the joke back.

### Wildcard · Extend the night · thirst 1
\`\`\`reply
I'm in
dessert after is on me
\`\`\`
Turns dinner into a whole date without making it a big deal.

Pick: Flirt | {they} gave a clear signal — you can flirt back
Don't send: ok sounds good | reads like a work calendar invite and deflates {their} excitement

\`\`\`aside
Book: {they} already did — check the address and how long it takes to get there
On the day: arrive a few minutes early and text "here, grabbed us a spot"
After: float a second date naturally at the end, don't pin it down on the spot
\`\`\``,
  tired: `\`\`\`judge
Verdict: {They}'re wiped and want company, not advice
Note: so tired | wants sympathy, not a to-do list
Surface: {They} had a long day at work
Emotion: drained, a little fed up
Need: company — someone on {their} side
\`\`\`

### Steady · Be there · thirst 0.5
\`\`\`reply
that sounds exhausting
do nothing tonight, that's an order
\`\`\`
No advice, just on {their} side.

### Flirt · A little sweet · thirst 1.5
\`\`\`reply
and you still texted me back
I'm honored
\`\`\`
Light tease with some warmth, asks for nothing.

### Wildcard · Do something small · thirst 1
\`\`\`reply
sent you something for dinner
don't cook tonight
\`\`\`
Worth more than "feel better" — if you know where {they} live{s}.

Pick: Steady | right now {they} need{s} to be heard; flirting can wait
Don't send: you should go to bed early | reads like a parent`,
  general: `\`\`\`judge
Verdict: Normal day-to-day sharing — pick up a detail and show a bit of yourself
Surface: {They}'re telling you about {their} day
Emotion: relaxed, wants to share
Need: a real reply, back-and-forth
\`\`\`

### Steady · Pick up a detail · thirst 0
\`\`\`reply
wait then what happened
\`\`\`
Asking for the rest is the easiest way to keep it going.

### Flirt · Leave a hook · thirst 1
\`\`\`reply
ok I need the full story
in person, obviously
\`\`\`
Nudges the chat toward meeting up.

### Wildcard · Show your life · thirst 0.5
\`\`\`reply
my day was also unhinged
tell you later
\`\`\`
Gives {them} a reason to ask about you.

Pick: Steady | there's not much to go on yet — keep the back-and-forth going
Don't send: nice | a conversation killer`,
};

const ODDS_EN = `\`\`\`judge
Verdict: Sweet texts, zero plans — right now {they}'re a great texter, not a sure thing
Stage: Talking stage (lots of flirting, two plans dodged)
Interest: sweet 7 initiative 4 commitment 2 action 2 overall 4 confidence med
Player: 45
Pursuit: high-options · pacing 2
Vibe: playful
\`\`\`

- Good signs: plays along, shares {their} day
- Bad signs: dodged two plans with "we'll see", no new time; warmest after midnight
- Mirroring: started using your "lowkey", but still sends {their} own memes
- Recent player signals: future-faking — "we should totally go to that place" twice, no date
- Next test: low-cost ask — two specific times, see if {they} pick{s} one

\`\`\`strategy
Reply timing: whenever you see it
Go quiet?: close the loop
Move: ask them out
Watch for: whether {they} name{s} a time
\`\`\`

### Wildcard · Specific ask · thirst 1
\`\`\`reply
thursday night or saturday afternoon
your pick, I'll bring you to that taco place
\`\`\`
Two options and a real place — you'll know right away.`;

const POLISH_EN = `\`\`\`judge
Verdict: The feeling's fair, but this hands {them} a guilt trip instead of a reason to reply
Surface: you want to ask why {they} went quiet
Emotion: {they}'d feel cornered — it's a question with only bad answers
\`\`\`

\`\`\`verdict
Call: Tweak it
Fit: 4
Thirst: 3 (cap 1.5)
Neediness: high
Flirt: too intense
Risk: {they} can only say "no I'm not" and then pull back further
Timing: good after {they} reach{es} out; bad right after being left on read
\`\`\`

### Steady · Light version · thirst 0.5
\`\`\`reply
you went fully off the grid lol
thought I'd killed the convo
\`\`\`
Same meaning, but it gives {them} an easy way back in.

### Flirt · Hand the ball back · thirst 1
\`\`\`reply
you've been busy huh
come find me when you surface
\`\`\`
No interrogation, just an open door.

Pick: Steady | get the energy back first, then see what {they} do{es}`;

const READ_EN = `\`\`\`judge
Verdict: {They}'re wrapping real care in a joke — respond to the care, not just the joke
Note: don't flake on me | half-joking — {they} want{s} you to take it seriously
Surface: {They} booked the table and told you not to bail
Emotion: excited, a little unsure
Need: to be taken seriously — a clear yes
Stage: Talking stage ({they} made the plan — strong action signal)
\`\`\`

- Type: sharing good news + a light test — {they} set it up and want{s} to see how you respond
- Risk: yes — a too-casual answer makes {them} feel like the only one who cares
- Direction: open with a clear yes, then play with the joke, and skip the one-word "ok"`;

const PRONOUNS: Record<string, Record<string, string>> = {
  he: { they: "he", them: "him", their: "his", themself: "himself", They: "He" },
  she: { they: "she", them: "her", their: "her", themself: "herself", They: "She" },
  they: { they: "they", them: "them", their: "their", themself: "themself", They: "They" },
};

function fillEn(text: string, pronoun: string): string {
  const p = PRONOUNS[pronoun] ?? PRONOUNS.they;
  // they/They + verb agreement: the demo text is written to read fine with he/she/they,
  // except contractions like "{They}'re" which become "He's"/"She's".
  return text
    .replace(/\{They\}'re/g, pronoun === "they" ? "They're" : `${p.They}'s`)
    .replace(/\{they\}'re/g, pronoun === "they" ? "they're" : `${p.they}'s`)
    .replace(/\{(They|they|them|their|themself)\}/g, (_, k: string) => p[k])
    .replace(/\{s\}/g, pronoun === "they" ? "" : "s")
    .replace(/\{es\}/g, pronoun === "they" ? "" : "es");
}

/** 示范回答：中文默认写成「她」（ta 是男生换成「他」，没写用「ta」）；英文按 he / she / they 填。 */
export function demoAnswer(mode: Mode, text: string, pronoun = "她", lang: "zh" | "en" = "zh"): string {
  if (lang === "en") {
    const body = mode === "read" ? READ_EN : mode === "polish" ? POLISH_EN : mode === "odds" ? ODDS_EN : REPLY_EN[pickEn(text)];
    return fillEn(body + TAIL_EN, ["he", "she", "they"].includes(pronoun) ? pronoun : "they");
  }
  const body = mode === "read" ? READ : mode === "polish" ? POLISH : mode === "odds" ? ODDS : REPLY[pick(text)];
  return (body + TAIL).replaceAll("她", pronoun);
}
