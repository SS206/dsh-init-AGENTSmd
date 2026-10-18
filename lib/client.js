window.__ModuleLoader__.load({
	id: "@local/init-command",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { IconContextInjectionOutlineRegular } = require("@deepseek-ai/dsh-client-ui-primitives");

		/** Services this plugin's apply needs before it runs. */
		const inject = ["commandUi"];

		/** Localized row face for the host `init` command. */
		const LABEL = "初始化";
		const DESCRIPTION = "注入工作区 init 提示词（创建或更新 AGENTS.md）";

		/**
		 * Decorate the host command's catalog row with a localized label and an
		 * icon. This is the same row-decoration technique the BTW plugin uses:
		 * the host command keeps its catalog row, argument claim, and lifecycle
		 * logging, while the client supplies the face a catalog descriptor
		 * cannot carry. Claiming, `/init <requirements>` parsing, and execution
		 * all stay on the built-in paths.
		 * @param commandUi - the command surface service (`ctx.commandUi`).
		 * @returns the disposer restoring the original candidate synthesis.
		 */
		function attachRowFace(commandUi) {
			if (commandUi === null || typeof commandUi !== "object") return () => {};
			if (typeof commandUi.candidates !== "function") return () => {};
			const original = commandUi.candidates;
			commandUi.candidates = async function candidatesWithInitFace(...args) {
				const rows = await original.apply(this, args);
				if (!Array.isArray(rows)) return rows;
				return rows.map((row) => row !== null && typeof row === "object" && row.name === "init"
					? {
						...row,
						label: LABEL,
						description: DESCRIPTION,
						icon: row.icon ?? IconContextInjectionOutlineRegular
					}
					: row);
			};
			return () => {
				commandUi.candidates = original;
			};
		}

		/**
		 * Mount the row face on the command surface.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.inject(["commandUi"], (scope) => attachRowFace(scope.get("commandUi")));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
