/**
 * Pure helpers used by the Save extension.
 *
 * Kept separate from `save.ts` so they can be imported and unit-tested
 * without pulling in the TUI runtime.
 */

import { join } from "node:path";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

// ============
// Body extraction
// ============

export interface ExtractedBody {
	role: string;
	body: string;
}

function extractTextBlocks(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((b): b is { type?: string; text?: string } => !!b && typeof b === "object")
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n");
}

/**
 * Extract the body text of a session entry. Returns null when the entry has
 * no plain text body the user would want to save (for example, a model
 * change, a thinking level change, or an image-only user message).
 */
export function extractEntryBody(entry: SessionEntry): ExtractedBody | null {
	if (entry.type !== "message" || !entry.message) {
		return null;
	}
	const m = entry.message as unknown as Record<string, unknown>;

	if (m.role === "user") {
		const text = extractTextBlocks(m.content).trim();
		return text ? { role: "user", body: text } : null;
	}

	if (m.role === "assistant") {
		const text = extractTextBlocks(m.content).trim();
		return text ? { role: "assistant", body: text } : null;
	}

	if (m.role === "toolResult") {
		const text = extractTextBlocks(m.content).trim();
		if (!text) return null;
		const toolName = typeof m.toolName === "string" ? m.toolName : "tool";
		return { role: "tool", body: `[tool: ${toolName}]\n\n${text}` };
	}

	if (m.role === "bashExecution") {
		const cmd = typeof m.command === "string" ? m.command : "";
		const out = typeof m.output === "string" ? m.output : "";
		const text = `$ ${cmd}\n\n${out}`.trim();
		return text ? { role: "bash", body: text } : null;
	}

	if (m.role === "custom") {
		const text = extractTextBlocks(m.content).trim();
		if (!text) return null;
		const customType = typeof m.customType === "string" ? m.customType : "custom";
		return { role: "custom", body: `[custom: ${customType}]\n\n${text}` };
	}

	if (m.role === "branchSummary" && typeof m.summary === "string" && m.summary.trim()) {
		return { role: "summary", body: m.summary };
	}

	if (m.role === "compactionSummary" && typeof m.summary === "string" && m.summary.trim()) {
		return { role: "compact", body: m.summary };
	}

	return null;
}

// ============
// Tree display
// ============

export interface TreeRow {
	entryId: string;
	depth: number;
	/** For each depth d' <= depth: whether the ancestor at depth d' (or this row at d'=depth) is the last child of its parent. */
	isLastAtLevel: boolean[];
	displayLabel: string;
	hasBody: boolean;
}

const ROLE_LABELS: Record<string, string> = {
	user: "user      ",
	assistant: "assistant ",
	tool: "tool      ",
	bash: "bash      ",
	custom: "custom    ",
	summary: "summary   ",
	compact: "compaction",
};

function truncateLabel(s: string, max: number): string {
	const oneLine = s.replace(/\s+/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return oneLine.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * Flatten the session tree into a depth-first list of display rows. Rows
 * carry enough information to draw `├─`/`└─` connectors.
 */
export function buildVisibleTree(entries: SessionEntry[]): TreeRow[] {
	const childrenOf = new Map<string | null, SessionEntry[]>();
	for (const entry of entries) {
		const parent = entry.parentId ?? null;
		if (!childrenOf.has(parent)) {
			childrenOf.set(parent, []);
		}
		childrenOf.get(parent)!.push(entry);
	}

	const rows: TreeRow[] = [];

	const visit = (entry: SessionEntry, depth: number, parentIsLast: boolean[]): void => {
		const body = extractEntryBody(entry);
		let displayLabel: string;
		if (body) {
			const roleLabel = ROLE_LABELS[body.role] ?? body.role;
			displayLabel = `${roleLabel}  ${truncateLabel(body.body, 60)}`;
		} else if (entry.type === "message") {
			const msg = (entry.message ?? {}) as unknown as Record<string, unknown>;
			const role = typeof msg.role === "string" ? msg.role : "message";
			displayLabel = `${role.padEnd(10)}  (no text body)`;
		} else {
			displayLabel = `${entry.type.padEnd(10)}  (not a message)`;
		}

		rows.push({
			entryId: entry.id,
			depth,
			isLastAtLevel: [...parentIsLast],
			displayLabel,
			hasBody: body !== null,
		});

		const children = childrenOf.get(entry.id) || [];
		children.forEach((child, i) => {
			visit(child, depth + 1, [...parentIsLast, i === children.length - 1]);
		});
	};

	const roots = childrenOf.get(null) || [];
	roots.forEach((root, i) => {
		visit(root, 0, [i === roots.length - 1]);
	});

	return rows;
}

export function getPrefix(row: TreeRow): string {
	if (row.depth === 0) return "";
	let prefix = "";
	for (let i = 0; i < row.depth - 1; i++) {
		prefix += row.isLastAtLevel[i] ? "   " : "│  ";
	}
	prefix += row.isLastAtLevel[row.depth] ? "└─ " : "├─ ";
	return prefix;
}

// ============
// Editor command parsing
// ============

export function parseEditorCommand(editorCmd: string): { cmd: string; args: string[] } {
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(editorCmd)) !== null) {
		tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	if (tokens.length === 0) {
		return { cmd: "nano", args: [] };
	}
	return { cmd: tokens[0]!, args: tokens.slice(1) };
}

export function resolveEditor(): { cmd: string; args: string[]; source: string } {
	const visual = process.env.VISUAL?.trim();
	if (visual) {
		const parsed = parseEditorCommand(visual);
		return { ...parsed, source: "$VISUAL" };
	}
	const editor = process.env.EDITOR?.trim();
	if (editor) {
		const parsed = parseEditorCommand(editor);
		return { ...parsed, source: "$EDITOR" };
	}
	if (process.platform === "win32") {
		return { cmd: "notepad", args: [], source: "platform default" };
	}
	return { cmd: "nano", args: [], source: "platform default" };
}

// ============
// Save file content
// ============

// ============
// Save directory & filename
// ============

/**
 * Return the directory where saved messages are stored.
 * Created under the current working directory at `.pi/saved_messages/`.
 */
export function getSaveDir(): string {
	return join(process.cwd(), ".pi", "saved_messages");
}

/**
 * Generate a human-readable filename for a saved message.
 * Format: `<role>_<entry-id-prefix>_<slug>.md`
 * Example: `assistant_a53f79fc_approach-b-is-ex.md`
 *
 * @param entry  The session entry being saved.
 * @param body   The extracted body (provides role and slug text).
 */
export function generateSaveFilename(entry: SessionEntry, body: ExtractedBody): string {
	const idPrefix = entry.id.replace(/[^a-z0-9]/gi, "").slice(0, 8) || entry.id.slice(0, 8);
	const slug = body.body
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 16);
	return `${body.role}_${idPrefix}_${slug}.md`;
}

// ============
// Save file content
// ============

export function buildSaveFileContent(entry: SessionEntry, body: ExtractedBody): string {
	const ts = new Date().toISOString();
	const lines: string[] = [];
	lines.push(`<!-- entry: ${entry.id} -->`);
	lines.push(`<!-- role: ${body.role} -->`);
	lines.push(`<!-- saved: ${ts} -->`);
	lines.push("");
	lines.push(body.body);
	lines.push("");
	return lines.join("\n");
}

// ============
// Conversation export (/save all)
// ============

/**
 * Build a JSON string representing the conversation as an array of
 * `{role, content}` objects. Only user and assistant messages with plain
 * text content are included — tool calls, tool results, thinking blocks,
 * model changes, and any other roles are filtered out.
 *
 * The entries should be in DFS order (as returned by `collectAllEntries`).
 */
export function buildConversationJson(entries: SessionEntry[]): string {
	const messages: Array<{ role: string; content: string }> = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const m = entry.message as unknown as Record<string, unknown>;
		const role = m.role;
		if (role !== "user" && role !== "assistant") continue;

		const text = extractTextBlocks(m.content).trim();
		if (!text) continue;

		messages.push({ role: role as string, content: text });
	}

	return JSON.stringify(messages, null, 2) + "\n";
}

/**
 * Generate a descriptive filename for a conversation export.
 * Format: `conversation_<YYYY-MM-DD>_<slug>.json`
 * The slug is derived from the first user message in the session.
 */
export function generateConversationFilename(entries: SessionEntry[]): string {
	const date = new Date().toISOString().slice(0, 10);
	let slug = "conversation";
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const m = entry.message as unknown as Record<string, unknown>;
		if (m.role !== "user") continue;
		const text = extractTextBlocks(m.content).trim();
		if (text) {
			slug = text
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 24);
			break;
		}
	}
	return `conversation_${date}_${slug}.json`;
}
