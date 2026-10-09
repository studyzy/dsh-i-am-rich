# dsh-rich-person 有钱人插件

> 每次模型请求都发送两份，把第二份直接扔掉，然后如实告诉你今天又浪费了多少 Token。

一个 DeepSeek Harness 插件。它的唯一功能就是**真的花掉两倍的钱**，并且**诚实地**把浪费掉的数字显示出来。

## 它做什么

```
一次模型请求
    ├─ 第 1 份 ──> 正常返回给 agent loop（你真正在用的回复）
    └─ 第 2 份 ──> 完整收到，然后扔掉
                     │
                     └─> 记录 provider 为此报告的真实用量
                              │
                              └─> 状态条：「咱今天又浪费了 1,200 Token」
```

两份都是**真实的、被计费的 provider 请求**。这不是模拟，也不是估算——第二份请求通过网络发出，provider 为它计费，然后它的内容被丢弃。

## 安装

```sh
npm install @deepseek-ai/dsh-rich-person
```

或把 `cordis.patch.yml` 合进你的 profile：

```yaml
- insert:
    - id: rich-person
      name: '@deepseek-ai/dsh-rich-person'
```

## 配置

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否重复发送请求。关掉后插件仍加载、状态条仍在，但不再花钱。 |
| `discardedCopies` | number | `1` | 每次请求额外丢弃几份。`1` 表示发两份扔一份。 |

```yaml
- id: rich-person
  name: '@deepseek-ai/dsh-rich-person'
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

## 已知代价

诚实地说清楚这个插件的代价：

1. **账单是真的两倍。** 这是插件的全部意义，不是 bug。
2. **它和 harness 的 `model-visible ⟺ logged` 约定存在张力。** 重复请求产生了真实的 provider 计费，但它在 session log 里没有对应的 `assistant/attempt`，因为结果是扔掉的。本插件用一条 **non-surface** 的 `llm/waste` 事件把这件事**如实记下来**，而不是假装没发生。因此「模型可见的输入」这一侧仍然完全可重建；被额外记录的是**支出**，不是模型上下文。
3. **延迟与速率压力更高。** 重复请求和原请求并发发出，会占用额外的并发额度。

## 为什么状态条只显示一份

`discardedCopies: 2` 时会发三份（一份真的 + 两份扔的），状态条只统计**被扔掉的那两份**。它统计的是「浪费」，不是「总量」——用掉的 Token 不算浪费。

## 开发

```sh
npm install
npm run check     # lint + typecheck + typecheck:tests + test + build
npm test
```

测试里最关键的一条是 `tests/rich-person.spec.ts` 的 `invokes the underlying adapter twice`：它数的是 **adapter 被调用的次数**。只有这个断言能证明真的发出了第二份请求——测下游监听器数量是证明不了的。

## 文件结构

```
src/index.ts        Host 插件：挂 llm/stream，发重复请求，记录 llm/waste
src/waste.ts        纯函数：把丢弃用量折叠成每天的总数
src/projection.ts   wasteToday 投影：把每天的账本发布给 Web 客户端
src/types.ts        llm/waste 事件类型（non-surface）
src/client/         浏览器半边：状态条
```

## License

MIT