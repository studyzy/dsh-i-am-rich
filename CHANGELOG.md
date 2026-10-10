# Changelog

本文件记录 `@deepseek-ai/dsh-i-am-rich` 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

分组标签沿用 Keep a Changelog 的英文标准标题（Added / Changed / Fixed /
Removed），正文用中文书写，与仓库的提交信息风格保持一致。

## [Unreleased]

尚未发布的工作树改动。包版本自创建以来一直是 `0.0.1`，且从未正式发布，
因此这里不虚构版本号与发布日期。

### Added

- **状态条加上金币图标，并把数值按数量级显示为「亿 / 万」。**
  状态条以一枚金币（`🪙`）开头，三个口径的数值不再打印完整整数，
  而是缩放到读者一眼能读懂的数量级：不足 1 万原样显示，1 万 ~ 1 亿显示「万」，
  1 亿及以上显示「亿」（两位小数），例如 `🪙 今日浪费 2249万 本月浪费 2249万 累计浪费 2249万`。
  规则是**选能装得下的最大单位**，不写成「亿 + 万」的组合——
  否则 2249 万会被写成读起来别扭的 `0亿2249万`；四舍五入只在最后做一次，
  并可能把一个数进位到上一级（`99,999,999` → `1亿`，而不是 `10000万`）。
  缩放只作用于状态条：tooltip 仍给出**精确整数**（含千分位），
  因为缩放是呈现选择、账本才是记录。
  新增纯函数 `toMagnitude()`（`src/waste.ts`），刻度族按字典选取：
  `zh` 用万/亿，`en` 用 K/M/B，因为英文读者不按万/亿分组；
  当前刻度可从状态条上的 `data-i-am-rich-scale` 读出。
  文案单位拆成 `unit.plain` / `unit.wan` / `unit.yi` / `unit.thousand` /
  `unit.million` / `unit.billion` 六个键，中英字典键集保持一致。
- **三个口径的标签补全为「今日浪费 / 本月浪费 / 累计浪费」。**
  只写「今日」不合格：状态条报的是**被倒掉的那一份**，不是花掉的总量，
  而 `今日 2249万` 会被读成消费额——正好是这个插件要区分的反面。
  英文同步为 `Wasted today` / `Wasted this month` / `Wasted all time`，
  tooltip 也一并改为「今日浪费 …」。新增两条测试逐个口径断言
  「浪费」/「Wasted」必须在场，防止文案被简化回去。

### Changed

- **状态条从输入框下方移到侧边栏左下角、用户名正上方。**
  位置从 `conversation.composer.dock`（输入框下方的 dock 行）改为
  `sidebar.footer.action`（`kind: list`，由 `ui-sidebar` 声明）。
  侧边栏在 `footArea` 这一列里先渲染 `footerActions`、再渲染 `settingsArea`，
  而左下角的账号按钮（头像 + 用户名）正是 `settingsArea` 里的
  `sidebar.settings` 条目，所以这一格在版面上**天然落在用户名上面**，
  且是 list 槽位里的新格子——不改动、不替换账号按钮本身。
  该槽位已有的占用者是 `cordis-panel`，用新 `id` 即与之共存。
  同步把 `package.json` 的 `dsh.client.inject` 从 `ui-conversation`
  改为 `ui-sidebar`（槽位的声明方），并把
  `tests/client-registration.spec.ts` 的声明集合换成 `ui-sidebar` 的
  `children` 表，新增一条断言钉住「必须挂在用户名上方那一格」。
- **状态条默认只显示「今日浪费」，鼠标悬停展开为竖排三行，每行各带一枚金币。**
  侧边栏宽度是 264～420px（默认 280），三个带标签的口径排在**一行**
  约需 330px，静止态放不下，所以**默认只渲染今日一个口径，
  悬停时展开为今日 / 本月 / 累计三个**。
  展开是**竖排三行而非一行三列**，这是宽度决定的：每行只有一个口径，
  面板只需「最长那一行」的宽度即可待在侧边栏列内；若并排成一行，
  就得按内容宽度（约 330px）铺开并压到侧边栏外面。
  展开面板因此为 `flex-direction: column` + `width: 100%`，
  只是从文档流里抬起（`position: relative` + 背景 + 阴影）
  盖住下方账号按钮，避免悬停时把它顶来顶去。
  **金币按行重复渲染**（三行三枚），而不是整个面板共用一枚——
  三行各有各的金币才读得出是三个独立数字，而非一句被折行的句子。
  悬停用 React state（`onMouseEnter` / `onMouseLeave`）而非 CSS `:hover`：
  渲染几个口径是**渲染决定**，选择器能把样式改掉，但没法把本月与累计
  两个节点变出来；这也与 shell 自己的底部控件（账号菜单）做法一致。
  为此把组件拆成无状态的 `WasteStatusBarView`（接收显式 `expanded`）
  与只负责悬停状态的 `WasteStatusBar`，两种形态因此都能作为纯函数断言，
  测试无需引入 DOM 环境。
  侧边栏**收起**时（`wide: false`，仅 56px）这一宽度约束悬停也解不开，
  故收起态**始终**只渲染 `🪙 2249万`（标签也去掉），三个口径的
  **精确整数**始终在 tooltip 里。
  宽 / 收起由 `data-i-am-rich-wide` 标记，展开 / 收起由
  `data-i-am-rich-expanded` 标记。
  新增用例钉住：静止态恰为 1 行 1 枚金币、展开态恰为 3 行且顺序正确、
  **每行恰有 1 枚金币**、容器 `flexDirection` 随状态在 `row` / `column`
  间切换、`flexWrap: 'nowrap'` 在两种形态与两种宽度下都成立、
  展开态确实抬起、悬停回调各触发一次、静止态仍保留「浪费」标签。
  测试侧新增 `coinsOf` 辅助函数，并让 `periodText` 跳过行首金币，
  使文案断言与金币断言彼此独立。
- **`sidebar.footer.action` 是根作用域槽位，shell 不传 `sessionId`。**
  状态条改为自己从 store 选当前会话：`retainedBy.mainView > 0`。
  这正是 shell 自己的判定方式——`ui-layout` 选文档标题用的是同一条件——
  因此复用它而不是另立一套「当前会话」定义；store 里没有任何会话被
  主视图保留时，如实折叠为三个 `0`。
  新增 4 条会话选择用例。

### Fixed

- **账本文件句柄在并发写入时泄漏，可致命终止进程（`ERR_INVALID_STATE`）。**
  这是一个**真实且已独立复现**的崩溃路径，但**不是**那条
  `JavaScript heap out of memory` 的根因——见下方「尚未定论」一节，
  两者的证据不要混为一谈。

  `appendLedgerEntry` 先查缓存、再 `await open()`，但**丢弃记录是即发即忘的**
  （`burn(...).then(appendLedgerEntry)`），同一 tick 里会有多个 append 同时到达：
  它们**都**看到缓存为空、**都**打开了文件。第二个 `handles.set(path, ...)`
  覆盖了第一个，于是**第一个句柄被孤立**——不再有任何引用指向它，
  `closeLedgerHandles` 永远够不到它。

  孤立的**打开中**句柄由 Node 的 GC finalizer 关闭，而 Node 24 把这种情况
  当作**硬错误**（`A FileHandle object was closed during garbage collection` /
  `ERR_INVALID_STATE`）直接终止进程，不是警告。实测一次 12 路并发写入会泄漏
  **11 个**描述符。

  修复：新增 `pendingOpens` 去重进行中的 open，使并发 append 共享同一个句柄；
  另加 `closing` 标志，让「关闭过程中才完成的 open」自己关掉句柄而不是发布一个
  无人拥有的句柄。`closeLedgerHandles` 改用 `Promise.allSettled` 并聚合错误，
  避免第一个 close 失败就让其余句柄继续泄漏进这条致命路径。

  回归由 `tests/ledger-file.spec.ts` 锁住，**断言的是打开的描述符数**
  （pre-fix 为 12、修复后为 1；dispose 后必须为 0）——只断言行数看不见这个 bug，
  因为写入其实全都成功了，这正是它得以漏出的原因。

- **尚未定论：`JavaScript heap out of memory` 的根因仍在排查。**
  诚实记录边界，避免把上面那条句柄泄漏当成答案：

  - 崩溃日志显示 OOM 发生在启动后约 **32 秒**（≈113 MB/s 的分配速度），
    且 GC 是 `last resort`、`mu=0.001`，即堆里几乎全是**活对象**。
  - 但**句柄泄漏撑不起这个量级**：实测 2000 个泄漏句柄只占约 **8 MB**；
    而且泄漏会**先**触发 GC finalizer 的硬错误直接杀进程，
    根本来不及慢慢涨到 3.6 GB。
  - 本地已排除：`burn()` 的 `seen` 缓冲（20 万 chunk ≈ 41 MB）、
    客户端 15s 轮询（服务端 1s 缓存）、插件反复加载（200 次循环 +0.16 MB）、
    并发请求（8 路 × 25 轮堆平稳）。
  - 因此 OOM 另有原因，需在真实进程中观测（host RSS + 堆快照）才能定论。

  后续补充（2026-10-10）：用户的现场判别实验确认 **`billionaire` 档才崩、
  切回 `millionaire` 后不再崩**（三次崩溃 13:47 / 13:48 / 14:33 均在使用
  billionaire 期间，RSS 峰值 3.36–3.67 GB）。此后又排除了一整轮：

  - 第二份流的 `finally` 清理未执行 —— 实测 200/200 全部执行，**零泄漏**
  - 请求对象被强引用累积 —— `AGENT_LOOP_REQUESTS` 是 `WeakSet`
  - 下游中间件被请求量放大 —— 该 profile 里 hindsight 与 onesuite-pilot
    **都不挂** `llm/stream`
  - 账本文件体积 —— 653 行 / 154 KB，读一次 5 ms

  仍未确证「cache miss → JS 堆 OOM」这一环，故**不声称根因已找到**。
  但下述改动移除了 billionaire 路径上**唯一一处随会话规模线性增长的内存开销**，
  是目前最合理的候选。

### Changed

- **亿万富翁档改为在 system prompt 开头写入时间戳，不再插入前缀消息。**
  原来的实现在 `messages` 最前面**插入**一条前缀消息，代价是每次派发都要重建
  整个 `messages` 数组——而那个数组装着**整段会话**，长会话里它是一次请求中
  最大的单个对象（实测 3000 条消息约 11.6 MB，且与真实会话同为线性规模）。

  新实现只在**已有 system 消息的文本块头部加一行**
  （`[i-am-rich] <ISO 时间戳>`，由新导出的纯函数 `billionaireStamp()` 生成）：

  - 消息条数与原请求**完全一致**，除该条消息外其余消息**连对象引用都原样复用**
    （有测试断言 `duplicate.messages[1]` 与原对象是同一个引用）；
  - 同一负载下 200 次派发构造耗时从 **3.6ms 降到 0.6ms**；
  - 时间戳**每次都不同**，所以两份重复请求之间也不会互相蹭到缓存——
    固定前缀做不到这一点。

  硬约束照旧：**必须克隆**。loop 构造的 `messages` 是 deep-freeze 的，
  原地写会抛异常且会污染真实那一轮；克隆后原请求 bit-for-bit 不变（有测试断言）。
  system 消息的 `id`/`source` 与其余非文本块一并保留，只重写开头那个文本块
  （有测试断言）。

  一处**如实降级**：system 角色必须是带 `id`/`source` 的持久 `Message`
  （只有 `role: 'user'` 才能是不带身份的一次性 `RequestUserInput`），
  给用完即弃的副本伪造持久身份正是本插件不能做的事。所以没有 system 消息的请求
  回落为「照发第二份、不改前缀」，**仍是一次真实计费调用**。loop 构造的请求
  总是带 system 消息，这是手搓一次性调用的形状。

  测试同步：`tests/fortune.spec.ts` 由断言「插入的消息」改为断言
  「system 头部被盖章 + 条数不变 + 原请求未变 + 消息身份复用 + 无 system 时降级」；
  `tests/i-am-rich.spec.ts` 新增 `SYSTEM_OPTIONS` 夹具，因为旧的 `OPTIONS`
  没有任何消息，在新语义下本就无法携带前缀。

- **启用插件后整个回合失败：`cannot get property "llm" without inject`。**
  这是「`fortune: billionaire` 一启用就直接报错、根本不敢开」的**根因**，
  与上面那条状态条 bug 是**同一个机制**——cordis 在**已激活**的插件 fiber 上
  读取一个既没 `inject` 也没 `provide` 的属性时**抛异常**，而不是返回
  `undefined`。`dispatchDuplicate` 当时写成：

  ```ts
  const llm = (ctx as { llm?: ... }).llm
  if (dispatchingDuplicate || llm?.stream === undefined) return next()
  ```

  `?.` 只防 `undefined`，**防不住会抛异常的 getter**：属性读取本身先抛出来，
  降级分支永远到不了，异常一路冒泡成「本轮运行失败」。
  之所以只有 `billionaire` 档中招，是因为 `millionaire` 档直接复用 `next()`，
  根本不会走到这段读取。

  修复为 `resolveLlm()`：先走**不抛异常**的服务查询 `ctx.get('llm')`，
  再对直接赋值的裸 context 做一次 `try/catch` 兜底读取——
  两种 context 存服务的方式不同（注册表 vs 自有属性），只读一种会漏。
  `llm` 仍**不**写进 `inject`：注入会让 cordis 等到 LLM 运行时就绪才调用
  `apply`，没有该服务的宿主会连「烧钱 + 记账」一起失去，而这只是丢了前缀。

  回归由新增的 `tests/fiber-context.spec.ts` 锁住：它把 `apply` 跑在**真实
  cordis fiber** 里（只 provide `connection`、不 provide `llm`），
  断言不抛异常、且 `billionaire` 档仍然真的发出两次调用。
  关键在于旧用例是**结构性看不见**这个 bug 的：它们用裸 `new Context()`
  再手工赋值 `ctx.llm`，裸 context 不是代理，读取既不抛也不进注册表，
  所以一直绿灯。

- **状态条永远显示 0：路由因缺少 `inject` 声明而从未注册。**
  这是「账本文件明明在长大，状态条却一直是 `今日浪费 0`」的**根因**。
  cordis 在一个**已激活**的插件 fiber 上读取一个从未声明 `inject` 的服务，
  行为是**抛异常**（`cannot get property "connection" without inject`），
  而不是返回 `undefined`。`registerWasteLedgerRoute` 当时用 `try/catch`
  把这个异常当成「宿主没有 Web 客户端」的受支持降级形态吞掉了，
  于是 `/api/i-am-rich/waste` **根本没注册**，而 Host 半边的重复请求与
  账本写入一切正常。
  两种情况的界面表现完全一样——状态条一个数字都不涨——所以这个 bug 长期静默，
  排查时一度被误判为客户端缓存陈旧或取数失败。
  修复为显式声明依赖：

  ```ts
  export const inject = ['connection']
  ```

  这同时解决两件事：服务读取变为合法操作，且 cordis 会等 `connection`
  就绪后才调用 `apply`，消除了插件 `insert` 位置带来的启动时序竞争。
  同时**移除那个吞异常的 `catch`**：它把「配置错误」伪装成「正常降级」，
  正是让根因难以定位的原因；真正缺失的服务仍走同一条告警降级路径。
  回归由 `tests/ledger-server.spec.ts` 新增的两条用例锁住：一条用真实
  cordis fiber 复现 `without inject` 异常并断言路由确实抵达
  `connection.fetch.register`，另一条断言 headless（确实没有 connection）
  时仍返回 `undefined` 并保持降级。

- **写坏整个会话日志：`llm/waste` 是未注册事件，且没有 `ignorable` 标记。**
  这是「重启 dsh desktop 后某条历史 Session 打不开」的**根因**，报错为
  `contains event type "llm/waste" (seq 707) unknown to this harness and not
  marked ignorable; refusing to interpret the log`。原因有两层：
  1. `declare module '@deepseek-ai/dsh-session/types'` 扩展
     `SessionEventMap` **只是编译期声明**，它让本包的 TypeScript 认为该事件
     存在，却**没有**向任何 harness 注册这个名字。harness 读日志时不认识
     `llm/waste`，又看不到 `ignorable: true`，于是按设计**拒绝解释整份日志**
     ——拒绝比静默跳过更安全，因为漏读一个事件可能重建出错误的会话。
  2. harness 的 `Session.append()` 自己构造事件信封
     （`{type, seq, time, data, ...surfaceMetadata}`），**没有任何途径**写入
     `ignorable`。也就是说在旧实现下，本插件**无法**写出一个合法的事件。
  现在改用 harness 官方为「实验性插件记录」提供的
  `appendPluginRecord(session, type, data)`：它自动打上 `ignorable: true`，
  并要求事件名符合 `plugin:` 命名空间语法。记录名相应改为
  **`plugin:i-am-rich/waste`**（`src/types.ts` 的 `WASTE_RECORD_TYPE`）。
  新增 `src/records.ts` 作为**唯一写入口**：它在运行时探测
  `appendPluginRecord` 是否存在，**旧 harness 上宁可不记账**，
  也绝不回退到裸 `Session.append` 写一个未标记的事件——
  丢一个统计数字可以恢复，丢一整个会话不行。探测结果按插件加载缓存一次，
  不支持时只告警一次（而不是每次丢弃都刷屏）。
  `projection` 同时继续折叠旧的 `llm/waste` 记录（`LEGACY_WASTE_RECORD_TYPE`
  仅用于读取，永不写入），这样已被修复的历史会话仍能如实显示当天浪费。
  **注意**：`appendPluginRecord` 出现在 `dsh-v0.2.1-alpha.2`，
  而 desktop app 当前是 `0.2.0-rc.2`（`grep -c appendPluginRecord` 在
  已安装的 `dsh-session` 中为 **0**）。因此在升级 harness 之前，
  本插件会告警「不记账」并保持状态条为 0——这是刻意的降级，不是故障。

- **同源问题：`@studyzy/dsh-suggest-prompt` 也在写未标记的未知事件。**
  修复本插件时发现，`suggest-prompt/request` 与 `suggest-prompt/suggested`
  同样是**不在 harness 词表内、且没有 `ignorable`** 的事件
  （该插件 `lib/index.js` 里既没有 `ignorable`，也没有
  `KNOWN_SESSION_EVENT_TYPES` / `SessionEventMap` / `appendPluginRecord`）。
  之所以此前只有 `llm/waste` 报错，是因为 `validateStoredEvents`
  按**顺序**遍历并在**第一个**违规事件上抛出：本会话里 `llm/waste` 出现在
  seq 707，而 `suggest-prompt/*` 在 seq 1953，所以只报出了前者。
  验证：只修 `llm/waste` 之后，同一条会话的报错会变成
  `suggest-prompt/request (seq 1953)`——**问题并没有消失，只是换了个名字**。
  这两个插件需各自修复；本仓库只负责自己那一个。
  修复工具 `scripts/repair-session-log.mjs` 因此做成**通用**的：
  它按 harness 的真实词表判断，而不是只认 `llm/waste`，
  于是能一次修好两种事件（`scripts/verify-session-log.mjs` 可复核结果）。

- **状态条此前根本没有被挂载：注册的槽位 `shell.bottom` 并不存在。**
  这是「装了但界面上看不到浪费了多少 Token」的**真正根因**。
  `ui-layout` 的 `root` 槽位只声明了 `sidebar`、`main`、`rightbar`、
  `shell.overlay`、`shell.leading` 五个子槽位，全应用没有任何 bundle
  声明过 `shell.bottom`。而 `slots.inject(key, cb)` 的实现里有一句
  `if (spec === undefined) return`——槽位未被声明时回调**永不执行**，
  于是组件既不注册、也不报错，与「插件加载失败」在界面上无法区分。
  现在改挂 `conversation.composer.dock`（`kind: list`，由
  `ui-conversation` 声明，位于输入框正下方的 dock 行），并补上
  `id` / `order` 使其作为 list 条目参与排序。
  同步把 `package.json` 的 `dsh.client.inject` 从 `ui-layout` 改为
  `ui-conversation`（槽位的声明方）。
  新增 `tests/client-registration.spec.ts` 钉住这条约束：注册必须真正
  抵达 `slots.register`，且目标槽位必须是 `ui-conversation` 实际声明的名字。
- **状态条改为常驻渲染。** 此前在没有任何浪费记录时组件返回 `null`，
  而一个什么都不渲染的 dock 条目与「插件加载失败」在界面上完全一样。
  现在状态条从挂载那一刻起就渲染今日 / 本月 / 累计三个数字，
  没有记录时如实显示三个 `0`，空状态用 `data-i-am-rich-waste="empty"` 标记。
  说明：这一条曾被误记为「看不到状态条」的根因；实际根因是上面的槽位名错误，
  常驻渲染只是让「未挂载」不再伪装成「空数据」的加固措施。
- **`llm/waste` 归属在请求发出时解析，并优先采用继承的 initiator。**
  归属现在于请求发起时同步解析（`ctx.agents.currentInitiator()`），
  而不是等重复请求排空之后再解析。重复请求的生命周期比原请求长，
  若期间有兄弟 agent 注册进来，事后解析会退化成「有歧义」，
  于是一笔**真实花掉的钱**被静默丢弃。旧实现在
  `agents.list().length !== 1` 时直接不记录，这使多 agent 部署下
  **每一次都记不上账**；现在多 agent 不再是「有歧义」，
  只有在既没有 initiator、活跃 agent 又不恰好是一个时才真正放弃记录
  （此时 burn 照做，但不冒充归属）。

- **重入保护从模块级标志位改为 `WeakSet` 对象身份标记。**
  billionaire 档的嵌套派发需要一个「自己派发的那份直接穿透」的守卫，
  原实现用模块级布尔标志（`dispatchingDuplicate`），
  其正确性完全依赖一个时序假设：**嵌套派发必然同步进入监听器、
  标志位在 `finally` 里同步清除**。真实 harness 里这恰是最脆弱的一环，
  也是 billionaire 档现场崩溃排查中无法排除的候选。
  现改为派发前把克隆请求登记进模块级 `WeakSet<GenerateOptions>`，
  监听器入口按**对象身份**放行（`stampedDuplicates.has(options)`）：
  身份标记没有任何时序依赖——克隆无论何时、以何种异步方式重入
  waterfall 都能被认出；并发请求各自标记各自的克隆、互不干扰；
  原件因身份唯一永不误匹配。克隆只在真正经 `ctx.llm.stream()`
  派发时才登记，回退到 `next()` 的降级路径不登记（那份请求不会重入）。
  新增 `tests/fiber-dispatch.spec.ts`：在「真实形态」下
  （`llm` 经服务注册表 `provide`、其 `stream` 会重跑 `llm/stream` waterfall，
  此前所有用例都未覆盖这条路径）断言带前缀的副本恰好到达内层派发一次、
  消息条数不变、原请求对象未被篡改；千万富翁档仍走 `next()` 续接。

- **状态条的「浪费」只统计两个数字：缓存未命中的输入 + 生成的输出。**
  `totalTokens()` 原本是四桶之和；现在缓存两个桶（`cacheReadTokens` 与
  `cacheWriteTokens`）都不计入显示。原因：缓存命中部分按 provider 的折扣价
  计费，往往比全价输入低一个数量级——蹭到暖缓存的副本
  （`millionaire` 档的全部意义）每个 token 几乎不花钱；缓存写入则是输入
  前缀本身入仓，不是副本新「说」出来的东西。把这两类算进「浪费」会虚捧
  数字而不代表真实的挥霍。
  账本里四个桶**照常完整落盘**，这只是呈现口径的选择，记录本身仍是
  provider 报告的完整真实用量；直接读账本或将来想改回全量口径都不丢数据。
  测试同步：`tests/waste.spec.ts` 的合计断言改为 126
  （105 输入 + 21 输出，剔除 30 个 cache read 与 7 个 cache write），
  并新增一条「纯缓存 token 的丢弃显示为 0」的用例把这个口径钉住。

### Fixed

- **「富豪程度」选择器的三处状态机缺陷与账本降级路径的误读**（均为
  `src/client/StatusBar.tsx`，现有 41 条状态条测试只直接渲染无状态 View、
  从未挂载有状态外壳，因此全部漏测）：
  1. **确认档位存在第二份事实来源。** `confirmed` ref 在渲染期读取、在 poll
     稳态（`status` 已是 `ok`）下更新——React 对未变化 state 直接 bail out，
     ref 的变更不触发重渲染，单选框可能显示陈旧档位最长一个轮询周期；
     且 poll 与写入的完成顺序没有守卫，先于写入起飞的 poll 可以把单选框
     悄悄拉回旧档。修复：档位改为 state，配**写入代数（`writeSeq`）守卫**——
     每个 poll 在起飞时记下代数，只有代数未变才采纳 Host 报告的档位；
     写入在**开始时**递增代数，在途 poll 的回答因此作废。
  2. **`fortuneStatus` 永不复位。** 一次保存成功或失败后，「已保存 /
     保存失败」一行会在整个标签页生命周期内驻留每次展开面板，违反其自身
     「仅在有事可说时出现」的设计注释。修复：面板折叠时把终态复位为
     `idle`（`saving` 保留——写入仍在途，单选框的禁用依赖它）。
  3. **畸形响应被当作空账本。** `asLedger` 返回 `undefined` 时原实现
     `setLedger(undefined)` 并标记 `ok`——上一份好账本被清成 0/0/0，
     tooltip 显示「还没浪费 Token」，恰是失败态本该避免的误读。修复：
     narrowing 失败按 **poll 失败**处理，保留最后一份好账本并显示冻结提示。
  4. **day 桶不经校验直接进 fold。** `null` 桶会在渲染中抛 TypeError 打穿
     整条状态条（客户端没有 error boundary），字符串/NaN 桶会被静默压成 0。
     修复：`asLedger` 逐桶校验 fold 消费的全部字段为有限数字，任一非法
     拒绝整个响应体（走上一条的失败路径）。
  另修 `sumPeriods` 的月份匹配：`startsWith(month)` 过宽，
  `2026-100`、`2026-01-15T00:00:00Z` 这类共享前缀的键会被计入当月；
  现要求**键长为 10 且前 7 字符等于当月**。`asLedger` 相应导出为纯函数
  并新增直接测试；外壳状态机（#1/#2）需挂载真实 DOM 才可测，
  现有测试环境为纯 React 元素断言，暂以实现注释与回归用例钉住纯函数部分。

## [0.0.1]

首次发布。以下三条提交共同构成 `0.0.1` 的内容。

### Added

- **有钱人插件本体：每次模型请求真正发送两份，完整收到第二份后丢弃。**
  在公开的 `llm/stream` waterfall 上挂钩，两份都是被 provider 实际计费的请求。
  状态条上的每一个数字都来自 **provider 自己报告的 `usage`**，没有任何估算：
  只有报告了用量的丢弃请求才计入 token；未报告用量的丢弃单独计数、
  不冒充 token；中途失败但失败前已报过用量的重复请求，其用量仍然计入。
  按本地日历日分桶，日期在 Host 写入时盖戳，因此重放结果与实时一致。
  丢弃记为 **non-surface** 的 `llm/waste` 事件，不污染模型可见上下文。
- **状态条显示今日 / 本月 / 累计三个口径。**
  此前只显示「最新一天」的浪费量，现在并排显示今日、本月、累计三个数字，
  每个都带调用次数（tooltip）。投影的 `view(state)` 拿不到时钟，
  而「今天」和「本月」取决于读取时的日期，因此 Host 只发布按天的账本
  （`wasteLedger`），区间选取放在拥有时钟的客户端（`sumPeriods`）。
  这样持久化的 fold 保持无时钟依赖、重放严格可复现，而区间仍然按日历正确。
  测试从 21 增至 38，新增覆盖跨月、跨年、非法日期键只计入累计，
  以及三个口径的中英文渲染。

### Changed

- **改名为 `dsh-i-am-rich`。** 仓库、包名、插件 id 统一改名：

  | 项目 | 旧 | 新 |
  | --- | --- | --- |
  | npm 包 | `@deepseek-ai/dsh-rich-person` | `@deepseek-ai/dsh-i-am-rich` |
  | 目录 | `dsh-rich-person` | `dsh-i-am-rich` |
  | 插件 id | `rich-person` | `i-am-rich` |
  | locale | `richPerson` | `iAmRich` |
  | 类型 | `RichPersonInternals` / `RichPersonKey` | `IAmRichInternals` / `IAmRichKey` |
  | DOM 属性 | `data-rich-person-waste` | `data-i-am-rich-waste` |

  **破坏性变更：运行时插件 id 一并改了。** 已有的 profile 配置需要同步更新
  `cordis.patch.yml` 里的 `id` 字段，否则插件不会被加载：

  ```yaml
  - insert:
      - id: i-am-rich   # 旧值：rich-person
        name: '@deepseek-ai/dsh-i-am-rich'
  ```

<!-- 链接引用 -->
[Unreleased]: https://github.com/studyzy/dsh-i-am-rich/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/studyzy/dsh-i-am-rich/releases/tag/v0.0.1
