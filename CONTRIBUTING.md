# 贡献指南

> Contributing guide (Chinese). 本文档以中文为准。

感谢你有兴趣为 `@deepseek-ai/dsh-i-am-rich` 做贡献。这是一个 DeepSeek Harness
的恶搞（novelty）插件，它的唯一功能就是**真的花掉两倍的钱**，然后**诚实地**
把浪费掉的数字显示出来。请先读完这份指南再动手。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | `^22.19.0 \|\| >=24.0.0`（见 `package.json` 的 `engines`） |
| 包管理器 | pnpm，`packageManager` 字段锁定为 `pnpm@11.7.0` |

仓库提交的锁文件是 **`pnpm-lock.yaml`**，它是权威锁文件。提交前请确认它
已随依赖变更一起更新，且不要引入第二份锁文件（例如 `package-lock.json`）。

## 搭建开发环境

```sh
pnpm install
```

> 注意：`package.json` 声明 `packageManager: pnpm@11.7.0`。如果你的环境启用了
> Corepack，pnpm 会自动切到该版本，无需手动安装。

## 检查流水线

提交 PR 之前，请在本地跑通完整检查：

```sh
pnpm run check
```

`check` 是以下五个脚本的串联，全部通过才算通过：

| 脚本 | 命令 | 作用 |
| --- | --- | --- |
| `lint` | `oxlint src tests tsdown.config.ts` | 静态检查 `src/`、`tests/` 与构建配置 |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | 类型检查源码，不产出文件 |
| `typecheck:tests` | `tsc -p tsconfig.test.json` | 用测试专用配置单独检查 `tests/` |
| `test` | `vitest run tests` | 运行 `tests/` 下的全部测试 |
| `build` | `tsc -p tsconfig.json && tsdown` | 编译出 `lib/`：`lib/index.js`（Host, ESM）与 `lib/client.js`（浏览器, CJS） |

单独跑某一步也是允许的，例如只跑测试：

```sh
pnpm run test
```

## 最重要的约定

### 数 adapter 的调用次数

`tests/i-am-rich.spec.ts` 里的 **`invokes the underlying adapter twice`**
是整个仓库**最承重的一条测试**。它数的是 **adapter 被调用的次数**：

```ts
let adapterCalls = 0
const adapter = () => { adapterCalls += 1; /* ... */ }
// ...
expect(adapterCalls).toBe(2)
```

**只有这个断言能证明真的发出了第二份请求。** 数下游监听器的数量、
数事件条数、断言状态条上出现了数字，都**证明不了**第二份请求真的发出去过——
它们只证明了「某段代码被调用」或「某条记录被写入」。修改重复请求逻辑时，
不要弱化或删除这条测试。

### 代码风格

- **注释写「为什么」，不是「写什么」。** 注释解释取舍、约束和反直觉的原因；
  能从代码直接读出来的东西不要复述。带参数的函数使用 JSDoc 风格的
  `@param` / `@returns`。
- **每个导出符号都要有文档注释。** 类型、接口、函数、常量一视同仁，
  包括各字段的含义（见 `src/waste.ts`、`src/types.ts`）。
- **纯逻辑放进 `src/waste.ts`。** 凡是能写成纯函数的计算都放这里，
  这样测试**不需要 Host、不需要 cordis 上下文**就能覆盖
  （`tests/waste.spec.ts` 即为此而设）。需要上下文的编排逻辑留在 `src/index.ts`。
- **客户端用内联样式，不用 CSS Modules。** 因为 `tsc` 不会把 `.css`
  拷贝到产物目录，样式表 import 无法在构建后存活。存在 `--dsw-*` 主题变量时
  优先复用以跟随主题。
- **客户端半边必须保持 `react`、`react/jsx-runtime`、`@deepseek-ai/cordis`
  为 external。** 浏览器内核提供这些模块，把它们打进产物会破坏模块解析。
  该清单由 `tsdown.config.ts` 的 `CLIENT_EXTERNALS` 与
  `deps.neverBundle` 强制，请勿移除。

### 双语文档

- **`README.md`（中文）是唯一事实来源。**
- `README.en.md` 必须与中文版**保持相同的章节结构**：改动中文版某个小节时，
  请同步更新英文版的对应小节。

## 提交 PR

1. 从最新的主分支切出特性分支。
2. 修改代码，**行为变更必须附带测试**。
3. 在本地跑通 `pnpm run check`，确保五项全部通过。
4. 提交 PR，并在描述里说明「为什么」这么做，以及你验证了什么。

CI 会运行 `pnpm run check`（见 `.github/workflows/ci.yml`），并在
Node `22.19.0` 与 `24.x` 两个版本上分别跑一遍，这正是 `engines.node`
声明的两个区间。在本地跑通它，是让 PR 顺利通过的最省事办法。

## 把插件装进 DSH profile（供手工验证用）

安装走的是 pnpm 透传语法，注意动词是 **`add`** 而不是 `install`：

```sh
dsh plugin --profile <profile> add link:/path/to/dsh-i-am-rich
```

一个已知限制：内置的 `desktop` profile **不能**用这种方式管理——对它会报
`profile "desktop" is managed exclusively by the Electron application`。
需要改它时，请用应用自带的 `runtime/cli/bin/dsh`，或直接编辑
`~/.dsh/profiles/desktop/package.json`。

## 报告问题

- 普通 bug 与功能建议：请开 GitHub issue。
- 安全相关问题：请**不要**开公开 issue，改用
  [SECURITY.md](SECURITY.md) 里说明的渠道。

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## License

以 MIT 协议贡献，详见 [LICENSE](LICENSE)。
