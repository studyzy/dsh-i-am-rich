# dsh-i-am-rich 有钱人插件

> 每次模型请求都发送两份，把第二份直接扔掉，然后如实告诉你今天、本月、累计各浪费了多少 Token。

一个 DeepSeek Harness 插件。它的唯一功能就是**真的花掉两倍的钱**，并且**诚实地**把浪费掉的数字显示出来。

## 设计灵感

这个插件来自一个关于「有钱」的经典段子：

> 等咱有了钱，喝豆浆吃油条。
> 想蘸白糖蘸白糖，想蘸红糖蘸红糖。
> 豆浆买两碗，喝一碗，倒一碗！
> 油条买两根，吃一根，扔一根！

段子的笑点不在「有钱」，而在**浪费被摆到明面上**——买两碗就是为了倒一碗，倒掉的那碗才是重点。

`dsh-i-am-rich` 就是把这个段子原样搬进 LLM 调用里：

| 段子 | 插件 |
| --- | --- |
| 豆浆买两碗 | 每次模型请求真的发两份 |
| 喝一碗 | 第一份正常返回给 agent loop，是你真正在用的回复 |
| **倒一碗** | **第二份完整收完，然后直接扔掉** |
| 想蘸白糖蘸白糖，想蘸红糖蘸红糖 | `discardedCopies` 想扔几份扔几份 |
| —— | 状态条如实显示「倒掉了多少」，今日 / 本月 / 累计 |
| —— | `enabled: false`：今天不想摆阔，豆浆只买一碗 |

两处刻意的对应：

- **倒掉的那碗是真的倒了。** 第二份请求真的通过网络发出、真的被 provider 计费、内容真的被丢弃。不模拟、不估算、不假装——段子的笑点建立在「真花了钱」之上，插件也必须是真花钱。
- **倒掉的那碗要数清楚。** 段子里没人统计倒了多少，这个插件偏要统计，而且只用 provider 自己报告的 `usage`，一个 token 都不编。**这是整个插件唯一严肃的地方**：既然钱真的花了，账就得是真的。

换句话说：**行为是段子，账本是账本。** 花两倍的钱是玩笑，把这两倍的钱如实记下来不是。

## 它做什么

```
一次模型请求
    ├─ 第 1 份 ──> 正常返回给 agent loop（你真正在用的回复）
    └─ 第 2 份 ──> 完整收到，然后扔掉
                     │
                     └─> 记录 provider 为此报告的真实用量
                              │
                              └─> 侧边栏左下角（用户名上方）：🪙 今日浪费 120 / 本月浪费 1200 / 累计浪费 8400
```

两份都是**真实的、被计费的 provider 请求**。这不是模拟，也不是估算——第二份请求通过网络发出，provider 为它计费，然后它的内容被丢弃。

## 安装

> 这个包目前是 `private: true`，**尚未发布到 npm**。从源码安装：

```sh
git clone https://github.com/studyzy/dsh-i-am-rich.git
cd dsh-i-am-rich
pnpm install
pnpm run build
```

然后把它装进你的 DSH profile。`dsh plugin` 是 pnpm 的透传，所以用 `add` 加一个 `link:` 依赖指向仓库：

```sh
dsh plugin --profile <你的 profile> add link:/path/to/dsh-i-am-rich
```

注意：内置的 `desktop` profile 由 Electron 应用独占管理，`dsh plugin --profile desktop ...` 会被拒绝（`profile "desktop" is managed exclusively by the Electron application`）。要装进 `desktop`，请用应用自带的 `runtime/cli/bin/dsh`，或直接编辑 `~/.dsh/profiles/desktop/package.json` 并跑一次收敛。

最后把 `cordis.patch.yml` 合进你的 profile：

```yaml
- insert:
    - id: i-am-rich
      name: '@deepseek-ai/dsh-i-am-rich'
```

`id` 必须是 `i-am-rich`：插件改名后运行时 id 变了，旧配置里的 `rich-person` 不会再匹配，禁用开关之类的配置会静默失效。

## 配置

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否重复发送请求。关掉后插件仍加载、状态条仍在，但不再花钱。 |
| `discardedCopies` | number | `1` | 每次请求额外丢弃几份。`1` 表示发两份扔一份。 |

```yaml
- id: i-am-rich
  name: '@deepseek-ai/dsh-i-am-rich'
  config:
    enabled: true
    discardedCopies: 1
```

## 数字是怎么算的

状态条上的每一个数字都是**provider 自己报告的用量**，没有任何估算、放缩或编造：

- 只有 provider 报告了 `usage` 的丢弃请求才计入 Token 数
- provider 没报告用量的丢弃请求，单独计入「未报告用量的调用」，**不冒充 Token**
- 重复请求中途失败，但失败前已经报过用量——那份用量仍然计入，因为钱确实花了

按本地日历日分桶。日期在 Host 写入记录时就盖好戳，所以**重放（replay）得出的数字和当时实时看到的完全一致**，不依赖读取时的时钟。

### 三个口径

状态条并排显示三个数字：

| 口径 | 含义 |
| --- | --- |
| 今日 | 本地日历「今天」这一个自然日 |
| 本月 | 本地日历当前月份的整月合计 |
| 累计 | 全部有记录的日期之和 |

**为什么是客户端算的：** 投影的 `view(state)` 只接收 state，**拿不到时钟**。「今天」和「本月」取决于读取时的日期，所以 Host 只发布**按天的账本**，由拥有时钟的客户端去选取区间。这样做的直接好处是：持久化的投影 fold 保持无时钟依赖，重放结果因此严格可复现，而区间仍然正确。

边界行为都有测试覆盖：跨月（`2025-12-31` 不计入本月）、跨年（去年同月同日不算「今日」）、以及格式非法的日期键——非法键只计入「累计」，不会污染任何区间。

### 显示格式：金币 + 亿 / 万

状态条以一枚金币开头，每个口径都按数量级缩写，单位随数值大小自动选取。

**默认只显示今日一个口径；鼠标移上去展开成三行，每行都有自己的金币：**

```
默认：  🪙 今日浪费 2249万

悬停：  🪙 今日浪费 2249万
        🪙 本月浪费 2249万
        🪙 累计浪费 2249万
```

为什么默认只留今日：这一格在侧边栏底部、用户名上方，可用宽度是侧边栏的 **264～420px（默认 280）**，而三个带标签的口径排在**一行**约需 **330px**——默认宽度下根本放不下。所以静止态只给一个口径，把详情交给悬停。

**展开是竖排三行，不是一行三列**，这是宽度决定的：每行只有一个口径，所以面板只需要「最长那一行」的宽度就够，能老实待在侧边栏列内。若并排成一行，就得按内容宽度铺开（约 330px）并压到侧边栏外面去。展开面板因此是 `flex-direction: column` + `width: 100%`，只是从文档流里抬起（`position: relative` + 背景 + 阴影）盖住下方的账号按钮，避免悬停时把它顶来顶去。

**每行的金币是重复渲染的**，不是整个面板共用一枚：三行各有各的金币，才读得出是三个独立数字，而不是一句被折行的句子。

**每一行都设为 `flex-wrap: nowrap`**，行的内部不会再断行——「三行」就是三行，不会变成四行。

悬停展开用 React state（`onMouseEnter` / `onMouseLeave`）而不是 CSS `:hover`：**显示几个口径是渲染决定**，CSS 选择器能改样式，但没法把本月与累计两个 `span` 变出来。这也和 shell 自己的底部控件（账号菜单）做法一致。

侧边栏**收起**时只有 56px，这是宽度约束、悬停也解不开，所以收起态**始终**只显示 `🪙 2249万`（标签也去掉）；三个口径的完整信息仍在 tooltip 里。宽 / 收起状态由 `data-i-am-rich-wide` 标记，展开 / 收起由 `data-i-am-rich-expanded` 标记。

**标签写全「浪费」二字，只写「今日」不算合格。** 状态条说的是**被倒掉的那一份**，不是花掉的总量；`今日 2249万` 会被读成消费额，正好是这个插件要区分的反面。所以三个标签都是完整短语：今日浪费 / 本月浪费 / 累计浪费（英文对应 `Wasted today` / `Wasted this month` / `Wasted all time`）。有测试逐个口径断言这两个字必须在场，防止被简化回去。静止态也保留完整标签——变的只是口径个数，不是文案。收起态是唯一例外，那里连标签都放不下。

| 数值范围 | 显示 | 例子 |
| --- | --- | --- |
| < 1 万 | 原样整数 | `8421` |
| 1 万 ~ 1 亿 | 万 | `2249万` |
| ≥ 1 亿 | 亿（两位小数） | `2.25亿` |

**总是选「能装得下的最大单位」**，而不是固定写成「亿 + 万」的组合——那样 2249 万会被写成读起来别扭的 `0亿2249万`。四舍五入在最后一步做一次，并且可能把一个数**进位到上一级**：`99,999,999` 显示为 `1亿`，而不是 `10000万`。

缩放只影响状态条本身。鼠标悬停时 tooltip 给出**精确整数**（含千分位），因为缩放是呈现选择，账本才是记录：

```
今日 31,114,724 · 本月 31,114,724 · 累计 31,114,724
```

英文环境**不照搬「万 / 亿」**——英文读者不按这两个单位分组，因此 `en` 走 K/M/B（`22.49M`），而 `zh` 走万/亿。当前采用的是哪套刻度可以从 DOM 上的 `data-i-am-rich-scale`（`zh` / `en`）读出来。

### 状态条常驻显示

状态条**从插件挂载的那一刻起就显示**，还没有任何浪费记录时显示三个 `0`。

这是刻意的：状态条是这个插件**唯一**可见的证据，而一个什么都不渲染的侧边栏条目，和一个加载失败的插件在界面上**完全一样**。如果「没有记录就不渲染」，就分不清「已正确挂载」和「没挂上」——这正是早期版本让人以为「装了没反应」的原因。空状态用 `data-i-am-rich-waste="empty"` 标记，数字仍然是 `0` 而不是隐藏。

状态条挂在 `sidebar.footer.action`（`kind: list`，由 `ui-sidebar` 声明），位于侧边栏底部、**用户名（账号按钮）正上方**。侧边栏在同一列里先渲染 `footerActions`、再渲染 `settingsArea`，而账号按钮（头像 + 用户名）正是 `settingsArea` 里的 `sidebar.settings`；所以这一格在版面上就落在用户名上面。**槽位名是硬约束**：`slots.inject` 只会对「已被声明的槽位」执行回调，注册到一个没有任何 bundle 声明的槽位既不报错也不渲染——这正是本插件曾经「装了但看不见」的真正原因。

这个槽位是**根作用域**的，shell 不会传 `sessionId`。状态条因此自己从 store 里挑出当前会话：`retainedBy.mainView > 0`。这是 shell 自己的判定方式——`ui-layout` 选文档标题用的就是同一条件——所以这里复用它，而不是另立一套「当前会话」的定义。

## 请求归属

`plugin:i-am-rich/waste` 记录必须挂到**发出这次请求的那个 session** 上。归属按两级判定：

1. **继承的 initiator**（`ctx.agents.currentInitiator()`）——发起这次调用的 agent 的驱动链。这是精确的，也是**多 agent 部署下唯一正确的来源**：有队友 session、子 agent、或并发的会话时，`agents.list()` 会返回不止一个。
2. **唯一的活跃 agent**——在 initiator 边界之外、且恰好只有一个 agent 时使用。

两个关键点，都有回归测试锁定：

- **归属在「请求发出时」同步解析**，而不是等重复请求排空之后再解析。重复请求的生命周期比原请求长；如果期间有兄弟 agent 注册进来，事后解析就会变成「有歧义」，于是一笔**真实花掉的钱**被静默丢弃。
- **多 agent 不再是「有歧义」。** 旧版本在 `agents.list().length !== 1` 时直接不记录，这让多 agent 部署下**每一次都记不上账**。

只有在既没有 initiator、活跃 agent 又不是恰好一个时才真正放弃记录——此时 burn 照做，但不冒充归属。

## 已知代价

诚实地说清楚这个插件的代价：

1. **账单是真的两倍。** 这是插件的全部意义，不是 bug。
2. **它和 harness 的 `model-visible ⟺ logged` 约定存在张力。** 重复请求产生了真实的 provider 计费，但它在 session log 里没有对应的 `assistant/attempt`，因为结果是扔掉的。本插件用一条 **non-surface** 的 `plugin:i-am-rich/waste` 记录把这件事**如实记下来**，而不是假装没发生。因此「模型可见的输入」这一侧仍然完全可重建；被额外记录的是**支出**，不是模型上下文。
3. **延迟与速率压力更高。** 重复请求和原请求并发发出，会占用额外的并发额度。

## 版本要求

记账依赖 harness 的 `appendPluginRecord`（它会给记录打上 `ignorable: true`，这是写入「本 harness 不认识的事件类型」的**唯一合法途径**）。该 API 出现在 `dsh-v0.2.1-alpha.2`；在更早的 harness（例如 desktop app 当前使用的 `0.2.0-rc.2`）上，插件会**照常发重复请求，但不写任何记录**，并告警一次：

> i-am-rich: this harness has no appendPluginRecord, so discarded requests are not recorded

状态条因此会一直是 `0`。这是**刻意的降级**：旧实现用裸 `Session.append` 写未标记的 `llm/waste`，结果是 harness 拒绝解释**整份会话日志**，会话直接打不开。丢一个统计数字可以恢复，丢一整个会话不行。升级 harness 后无需改配置，记账会自动恢复。

## 为什么状态条只显示一份

`discardedCopies: 2` 时会发三份（一份真的 + 两份扔的），状态条只统计**被扔掉的那两份**。它统计的是「浪费」，不是「总量」——用掉的 Token 不算浪费。

## 开发

```sh
pnpm install
pnpm run check     # lint + typecheck + typecheck:tests + test + build
pnpm test
```

测试里最关键的一条是 `tests/i-am-rich.spec.ts` 的 `invokes the underlying adapter twice`：它数的是 **adapter 被调用的次数**。只有这个断言能证明真的发出了第二份请求——测下游监听器数量是证明不了的。

完整的开发环境与约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 文件结构

```
src/index.ts               Host 插件：挂 llm/stream，发重复请求，记录 plugin:i-am-rich/waste
src/waste.ts               纯函数：把丢弃用量折叠成每天的总数与三个口径，并把数值缩放到亿/万
src/projection.ts          wasteLedger 投影：把每天的账本发布给 Web 客户端
src/types.ts               记录类型定义（non-surface）与 plugin: / 旧 llm/waste 两个名字
src/records.ts             唯一写入口：探测 appendPluginRecord，旧 harness 上宁可不记账
src/brand.ts               WasteId 名义化包装
src/client/index.ts        浏览器半边入口：注册 sidebar.footer.action 槽位与字典
src/client/StatusBar.tsx   状态条组件（无状态视图 + 悬停展开包装）
src/client/locales.ts      zh（真值源）/ en 字典
src/client/contracts.ts    刻意收窄的浏览器内核类型面
tests/                     5 个 spec，共 78 个用例
cordis.patch.yml           插入插件行的 profile patch
tsdown.config.ts           双产物构建：lib/index.js（ESM，Node）+ lib/client.js（CJS，浏览器）
```

## License

MIT
