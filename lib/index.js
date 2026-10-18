// @local/init-command — host half of the /init slash command for DSH.
//
// Registers the human command `init` with an `input` hint, so the built-in
// command source gives it the official leading claim: picking the row (click
// or Tab) claims `/init ` into the composer — token plus a trailing space —
// and Enter submits it. The client half (lib/client.js) only decorates that
// catalog row with a localized label and an icon.
//
// Delivery: the handler submits an internal KICKOFF message through
// `agent.followup`; the same turn's `agent/pre-step` replaces it with the
// full workspace-init prompt itself — no user bubble. The replacement
// carries the `form: "notice"` context shape (as /plan does for its
// narration), which the Web GUI renders inside the context block; its
// `summary` is only the collapsed row title. Requirements typed after the
// command are appended under their own heading.
//
// Zero imports on @deepseek-ai/* by design: this bundle lives outside the
// host install, where those specifiers would not resolve.

/** Workspace-init prompt for DSH agents. {{cwd}} is replaced at delivery. */
const DEFAULT_PROMPT = String.raw`你正在 DSH（DeepSeek Harness）环境中执行工作区初始化（init）任务。

你的任务是为未来的 DSH agent 创建或更新一份简洁的工作区指令文件。

目标：
- 工作区目录：{{cwd}}
- 指令文件：{{cwd}}\AGENTS.md
- 需要检查的已有指令文件候选：
    {{cwd}}\AGENTS.md 与
    {{cwd}}\.agents\AGENTS.md
- 文件名必须恰好为 AGENTS.md。
- 本任务仅针对当前工作区。不要写入用户级全局指令文件 ~/.dsh/AGENTS.md。

流程：
1. 先用 glob（path 参数指向工作区目录）检查是否存在 AGENTS.md 或
   .agents\AGENTS.md。
   - 若根目录 AGENTS.md 已存在：报告路径，转入第 3 步做增量更新。
   - 若仅 .agents\AGENTS.md 存在：报告路径，并询问用户是否将其内容
     迁移到根目录 AGENTS.md，确认后再动笔。
2. 写入之前先检查仓库。优先使用 read、glob、grep 工具了解代码结构；
   需要运行命令时用 pwsh 执行安全命令，如 git status、git log、
   包管理器脚本检查。不要用 shell 命令去做 read/glob/grep 本身就能
   完成的事。
3. 若 AGENTS.md 已存在，必须先用 read 完整读取，再用 edit 做增量更新，
   不要用 write 整篇覆盖。
4. 若 AGENTS.md 不存在，用 write 在工作区根目录创建它。
5. 保持文件实用，篇幅控制在未来 agent 能快速读完的程度。
6. 只写入未来 DSH agent 否则无法得知的项目专属事实。
7. 仅当某个仓库专属决策无法推断、且会实质性地改变文件内容时，
   才用 ask_user_question 工具向用户提问。
8. 注意 DSH 文件沙箱：若工作区目录不在当前会话工作区内，read/write/edit
   可能被拒绝。按沙箱提示请求用户批准，不要尝试绕过。

建议写入 AGENTS.md 的内容：
- 仓库用途与主要目录。
- 从仓库中发现的构建、类型检查、lint 和重点测试命令。
- 对修改有影响的架构边界与分层规则。
- 编码约定、导入/路径规则、日志规则、UI/设计规则，
  以及（若存在）平台兼容性约束（Windows 优先，注意路径分隔符等）。
- 若本仓库涉及桌面应用、Web、远程、stdio、协议或 agent 运行时，
  写入相关的已知陷阱。
- 在改动敏感区域之前，agent 应当先阅读的文档文件。

创建或编辑 AGENTS.md 之后，总结写入的主要章节，并提及文件路径。`;

/** `input.hint` for the command row; shown after the claimed `/init ` token. */
const HINT = "可选补充要求";

/**
 * Internal kickoff line the handler submits; optional extra requirements
 * follow it after a newline. pre-step replaces it before it can reach the
 * model, so the line itself never appears in a request or the transcript.
 */
const KICKOFF = "执行工作区初始化（init）任务。";

/** Collapsed-row title for the injected prompt (never shown to the model). */
const SUMMARY = "工作区初始化（init）任务指示";

/** Recursively freeze a value in place (mirrors dsh-util-values deepFreeze). */
function deepFreeze(value) {
	if (value !== null && typeof value === "object") {
		for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
		Object.freeze(value);
	}
	return value;
}

/** Build one user-role message shaped exactly like createUserMessage output. */
function createUserMessage(text) {
	return deepFreeze(structuredClone({
		id: crypto.randomUUID(),
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "user" }
	}));
}

/** Join one message's text parts, or "" when it carries none. */
function messageText(message) {
	const content = message?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

/**
 * Recognize a kickoff message and split off its extra requirements.
 * @param message - one admitted message.
 * @returns hit: whether this is a kickoff; args: the appended requirements.
 */
function kickoffArgs(message) {
	const text = messageText(message);
	if (text === KICKOFF) return { hit: true, args: "" };
	if (text.startsWith(`${KICKOFF}\n`)) return { hit: true, args: text.slice(KICKOFF.length + 1).trim() };
	return { hit: false, args: "" };
}

/**
 * Build the context-shaped message carrying the full init instructions.
 * @param template - the instructions, with a {{cwd}} placeholder.
 * @param cwdText - the resolved workspace directory (or a pwd hint).
 * @param args - extra requirements submitted after the command, or "".
 * @returns the frozen message the request and the context block will show.
 */
function createPromptMessage(template, cwdText, args) {
	let text = "以下为本次工作区初始化（init）任务的一次性指示，请立即完整执行：\n\n"
		+ template.replaceAll("{{cwd}}", cwdText);
	if (args !== "") text += `\n\n## 用户附加要求\n\n${args}`;
	return deepFreeze(structuredClone({
		id: crypto.randomUUID(),
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "init-command", form: "notice", summary: SUMMARY }
	}));
}

/**
 * Register the /init host half: the claimed command submits the kickoff, and
 * pre-step swaps it for the full instructions.
 * @param ctx - cordis plugin context.
 * @param config - optional { prompt } override for the instructions;
 *   validated fail-loud.
 */
function apply(ctx, config) {
	const template = config?.prompt === undefined ? DEFAULT_PROMPT : config.prompt;
	if (typeof template !== "string" || template.trim() === "") {
		throw new Error("init-command: config.prompt must be a non-empty string when provided");
	}
	ctx.inject(["commands"], (commandCtx) => {
		commandCtx.commands.register({
			name: "init",
			description: "注入工作区 init 提示词（创建或更新 AGENTS.md）",
			input: { hint: HINT },
			handler: (invocation) => {
				const agent = invocation.agent;
				if (agent === undefined || agent === null) {
					return { kind: "error", text: "/init requires a session-backed agent" };
				}
				const args = invocation.rawInput.trim();
				const text = args === "" ? KICKOFF : `${KICKOFF}\n${args}`;
				agent.followup(createUserMessage(text));
				return { kind: "success", text: "init 任务已下发（指示经上下文注入）" };
			}
		});
	});
	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || signal.aborted) return decision;
		let args = "";
		let hit = false;
		for (const message of decision.messages) {
			const parsed = kickoffArgs(message);
			if (parsed.hit) {
				hit = true;
				args = parsed.args;
				break;
			}
		}
		if (!hit) return decision;
		const session = agent.session;
		const cwd = session?.header?.cwd;
		const cwdText = typeof cwd === "string" && cwd !== "" ? cwd : "当前会话工作区（请先用 pwd 确认）";
		const messages = decision.messages.filter((message) => !kickoffArgs(message).hit);
		return { ...decision, messages: [...messages, createPromptMessage(template, cwdText, args)] };
	});
}

export { apply, KICKOFF };
