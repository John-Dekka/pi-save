/**
 * Save Extension for pi
 *
 * Adds a `/save` slash command that opens the current session tree (using pi's
 * built-in TreeSelectorComponent, so it looks exactly like `/tree`), lets the
 * user pick a message, and launches the user's default text editor with the
 * selected message's body preloaded. The editor invocation uses the exact same
 * mechanism as pi's built-in Ctrl+G (app.editor.external): it calls tui.stop(),
 * spawns the editor, waits for it to close, then calls tui.start() +
 * tui.requestRender(true) so the TUI resumes cleanly.
 *
 * Usage:
 *   /save
 *
 * Editor resolution order:
 *   1. $VISUAL environment variable
 *   2. $EDITOR environment variable
 *   3. Platform default (notepad on Windows, nano elsewhere)
 *
 * Requirements:
 *   - pi coding agent (interactive TUI mode)
 *   - Node.js with ES modules
 */

import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { TreeSelectorComponent } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
	buildSaveFileContent,
	extractEntryBody,
	generateSaveFilename,
	getSaveDir,
	resolveEditor,
} from "./save-lib.ts";

// ============
// Editor spawning (identical to pi's own openExternalEditor)
// ============

/**
 * Spawn the user's editor, wait for it to close.
 * The file at `tmpFile` is already in the project's `.pi/saved_messages/`
 * directory and stays there after the editor exits.
 */
async function launchEditor(tmpFile: string): Promise<void> {
	const { cmd, args, source } = resolveEditor();
	return new Promise((resolve, reject) => {
		process.stdout.write(`\nLaunching external editor (${source}): ${cmd}\n`);
		process.stdout.write("Pi will resume when the editor exits.\n\n");

		const child = spawn(cmd, [...args, tmpFile], {
			stdio: "inherit",
			shell: process.platform === "win32",
		});

		child.on("error", (err) => reject(err));
		child.on("close", () => resolve());
	});
}

// ============
// Save file content (the HTML-comment header is written by save-lib.ts)
// ============

function collectAllEntries(tree: any[]): SessionEntry[] {
	const out: SessionEntry[] = [];
	const walk = (nodes: any[]): void => {
		for (const n of nodes) {
			out.push(n.entry);
			walk(n.children);
		}
	};
	walk(tree);
	return out;
}

// ============
// Main extension
// ============

export default function saveExtension(pi: ExtensionAPI) {
	pi.registerCommand("save", {
		description:
			"Open the session tree, pick a message, and launch your default text editor ($VISUAL/$EDITOR) with the message body so you can save it as a file",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (ctx.mode !== "tui") {
				ctx.ui.notify("The /save command requires the interactive TUI mode", "warning");
				return;
			}

			const sm = ctx.sessionManager;
			const tree = sm.getTree();
			const leafId = sm.getLeafId();
			const entries = collectAllEntries(tree);
			const savable = entries.filter((e) => extractEntryBody(e) !== null);

			if (savable.length === 0) {
				ctx.ui.notify("No messages with a text body found in this session", "warning");
				return;
			}

			// ---- Show the tree picker using pi's own TreeSelectorComponent ----
			const selectedId = await ctx.ui.custom<string | null>(
				(tui, theme, _kb, done) => {
					const terminalHeight = tui.terminal.rows;

					const treeSelector = new TreeSelectorComponent(
						tree as any,
						leafId,
						terminalHeight,
						async (entryId: string) => {
							// ---- User picked a message ----
							const entry = sm.getEntry(entryId);
							if (!entry) {
								ctx.ui.notify("Selected entry is no longer in the session", "error");
								return;
							}
							const body = extractEntryBody(entry);
							if (!body) {
								ctx.ui.notify("Selected entry has no text body", "warning");
								return;
							}

							// Write body to a file in $CWD/.pi/saved_messages/.
							const saveDir = getSaveDir();
							const saveFile = join(saveDir, generateSaveFilename(entry, body));
							try {
								mkdirSync(saveDir, { recursive: true });
								writeFileSync(saveFile, buildSaveFileContent(entry, body), "utf-8");
							} catch (err) {
								ctx.ui.notify(
									`Failed to write file: ${(err as Error).message}`,
									"error",
								);
								done(null);
								return;
							}

							// ---- Launch editor (same mechanism as pi's Ctrl+G) ----
							tui.stop();

							try {
								await launchEditor(saveFile);
							} catch (err) {
								tui.start();
								tui.requestRender(true);
								ctx.ui.notify(
									`Editor failed: ${(err as Error).message}. File: ${saveFile}`,
									"error",
								);
								// Don't call done() — user stays in tree to try again
								return;
							}

							tui.start();
							tui.requestRender(true);
							ctx.ui.notify(`Saved: ${saveFile}`, "info");
							done(entryId);
						},
						() => {
							done(null); // user cancelled
						},
					);

					return treeSelector;
				},
			);

			// If we got here, the picker is done and the user either cancelled
			// or the entire flow completed. Nothing more to do — the editor
			// was already launched inside onSelect.
			if (!selectedId) return;
		},
	});
}
