# dsh-init-command

DeepSeek Harness（DSH）的 `/init` 斜杠命令插件（双面插件）：在输入框注册一个**带图标**的 `/init` 命令行，执行时把一份面向 DSH 环境改写的工作区初始化（init）提示词**原文**直接放进当前会话的上下文块，并让模型立刻开始为该工作区创建或更新 `AGENTS.md`。

注入的就是提示词本体：没有额外的提醒文案，也没有用户气泡。命令可以附加自定义要求，注入内容会带上“用户附加要求”段落。

## 工作原理（对齐内置命令与 BTW 插件的做法）

1. **host 半边**（`lib/index.js`）注册宿主命令 `init`，带 `input: { hint }`：
   - 因此菜单行来自**内置命令源**，选中（点击 / Tab）时由官方 `leadingClaim` 处理——输入框自动填入 **`/init `（token + 一个空格）** 并显示 hint，等待补充要求；回车即提交；
   - 手打 `/init`、`/init 要求…`、`/init` + 空格，全部走同一条官方路径；
   - handler 拿到参数（`rawInput`）后，用 `agent.followup()` 下发一条**内部** KICKOFF 消息。
2. **client 半边**（`lib/client.js`）只做**行装饰**：包住 `commandUi.candidates`，给 name 为 `init` 的目录行补上本地化 label“初始化”与图标（可逆 restore）。宿主命令保留其目录行、参数 claim 与生命周期记账，这一点与 `@michengai/dsh-btw` 的做法一致。
   - 之所以要打补丁：宿主目录行本身不携带 label/icon（只有六个内置命令有内置 face），而客户端 contribution 与同名宿主命令会 fail loudly 冲突。
3. **注入**：同一轮 `agent/pre-step` 把 KICKOFF（及其后的附加要求）**整体替换为完整提示词**——`{{cwd}}` 替换为 `session.header.cwd`，附加要求以 `## 用户附加要求` 段落追加；KICKOFF 不会到达模型。
4. 替换后的消息带 `form: "notice"` 的上下文形态（`/plan` 的 narration 用同一种形态）：Web GUI 渲染在上下文块而非聊天气泡；`summary` 仅作折叠行标题。模型在**首轮请求**即拿到完整指示。

## 安装

1. 将本仓库 clone 到任意位置（下称 `<repo>`）。
2. 在目标 profile（如 `$DSH_HOME/profiles/desktop`）的 `package.json` 中：
   - `dependencies` 增加 `"@local/init-command": "link:<repo>"`；
   - `dsh.profile.bundles` 追加 `"@local/init-command"`（client 半边随之自动发现，无需额外配置）。
3. 建立链接：

   ```powershell
   New-Item -ItemType Junction -Path "$DSH_HOME/profiles/<name>/node_modules/@local/init-command" -Target "<repo>"
   ```

4. 重启 DSH（该 profile 无 HMR 时必须重启）。

## 使用

| 操作 | 结果 |
| --- | --- |
| `/` 打开菜单 | 出现“初始化 init”行（带图标，排在命令目录内） |
| 选中该行（点击 / Tab） | claim：输入框变成 `/init `（含空格）并显示 hint，不发送 |
| 输入要求后回车 | 提交并注入提示词 + “用户附加要求”段 |
| 直接回车（不输入） | 提交并注入裸提示词 |
| `/init 要包括所有的模块` 回车 | 同上（带附加要求） |

hint 文案由 host 半边的 `HINT` 常量控制（默认“可选补充要求”）。

## 配置

提示词默认内置（`lib/index.js` 的 `DEFAULT_PROMPT`）。可在更高优先级 patch 层覆盖：

```yaml
- id: init-command
  name: "@local/init-command"
  config:
    prompt: |
      自定义提示词全文，{{cwd}} 为工作区占位符。
```

## 结构

```
package.json        清单：dsh.bundle.patch + dsh.client（platform/inject）+ exports["./client"]
cordis.patch.yml    组合树挂载行（insert: id: init-command）
lib/index.js        host 半边：注册 init 命令（input.hint）+ pre-step 用完整提示词替换 KICKOFF
lib/client.js       client 半边：给宿主目录行补 label/icon（可逆的行装饰）
```

## 实现备注（上游契约）

- 宿主目录行**没有 face**：非内置命令的菜单行只由 `{ name, description }` 组成，label/icon 必须由客户端补齐（BTW 插件同样如此）。
- 客户端自建 `registerSource` 返回的 claim **落不进输入框**：`beginCommand` 会校验 `span.draftRev` 与当前 revision、并要求 phase 为 plain/claimed，自建源在此路径下无法可靠通过（本插件早期版本因此出现“选中后无 token”）。带 `input` 的宿主命令由官方 `leadingClaim` 处理，是唯一稳妥的 claim 路径。
- `candidates()` **必须返回 Promise**：管线执行 `.then(...)`，返回非 thenable 会中断整轮菜单加载（所有源停在骨架屏）。
- `matchSpace()` 由管线**同步取值**；`matchEnter()` 与 claim 的 `submit()` 会被 `await`。

## 相关

- 参考实现：`@michengai/dsh-btw`（宿主命令 + 客户端行装饰的第三方范例）。
- 上游机制：`@deepseek-ai/dsh-plan-mode`（pre-step 消息替换与 narration 上下文形态）、`@deepseek-ai/dsh-client-ui-commands`（目录行结构、claim 与 dispatch 决策表）、`@deepseek-ai/dsh-client-ui-input-trigger`（触发管线与候选契约）、`@deepseek-ai/dsh-client-modules`（双面包的 `dsh.client` 发现与浏览器端 bundle 格式）。
