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
