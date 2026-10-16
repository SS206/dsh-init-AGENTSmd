# dsh-init-command

DeepSeek Harness（DSH）的宿主端斜杠命令插件：在输入框注册 `/init`，执行时把一份面向 DSH 环境改写的工作区初始化（init）提示词作为用户消息注入当前会话，模型随即开始为该工作区创建或更新 `AGENTS.md`。

纯 host 端 cordis 插件：不携带客户端半边，命令通过宿主命令目录自动出现在 `/` 菜单的"指令"组。

## 安装

1. 将本仓库 clone 到任意位置（下称 `<repo>`）。
2. 在目标 profile（如 `$DSH_HOME/profiles/desktop`）的 `package.json` 中：
   - `dependencies` 增加 `"@local/init-command": "link:<repo>"`；
   - `dsh.profile.bundles` 追加 `"@local/init-command"`。
3. 建立链接：

   ```powershell
   New-Item -ItemType Junction -Path "$DSH_HOME/profiles/<name>/node_modules/@local/init-command" -Target "<repo>"
   ```

4. 重启 DSH（该 profile 无 HMR 时必须重启）。

## 使用

- 输入 `/init`（或 `/` 菜单"指令"组选择 init）：提示词全文以用户消息注入当前会话并立即执行；`{{cwd}}` 占位符替换为该会话的工作区路径（来自 `session.header.cwd`）。
- 带参数（如 `/init xx`）返回 Usage 错误，不注入。
- 会话运行中执行时排队至下一轮；空闲会话立即开新轮。

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
package.json       插件清单（dsh.bundle.patch 指向 cordis.patch.yml）
cordis.patch.yml   组合树挂载行（insert: id: init-command）
lib/index.js       插件本体（零 @deepseek-ai/* 依赖，消息构造对齐 createUserMessage 输出形状）
```

## 相关

- 上游机制参考：`@deepseek-ai/dsh-plan-mode`（命令注册 + systemPrompt section 注入的官方范例）、`@deepseek-ai/dsh-commands`（命令运行时校验规则）。
