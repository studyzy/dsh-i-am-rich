# Changelog

本文件记录 `@deepseek-ai/dsh-i-am-rich` 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

分组标签沿用 Keep a Changelog 的英文标准标题（Added / Changed / Fixed /
Removed），正文用中文书写，与仓库的提交信息风格保持一致。

## [Unreleased]

尚未发布的工作树改动。包版本自创建以来一直是 `0.0.1`，且从未正式发布，
因此这里不虚构版本号与发布日期。

### Fixed

- **状态条改为常驻渲染。** 此前在没有任何浪费记录时组件返回 `null`，
  而 `shell.bottom` 对空内容不预留任何空间，导致「插件已正确安装」和
  「插件加载失败」在界面上完全一样——这是早期版本让人误以为「装了没反应」
  的根因。现在状态条从挂载那一刻起就渲染今日 / 本月 / 累计三个数字，
  没有记录时如实显示三个 `0`，空状态用 `data-i-am-rich-waste="empty"` 标记。
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
