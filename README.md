# Save Extension for pi

Finally figured out why I kept yelling "just save that as a file" at my agent in anger. 😂

This is a simple but useful /save command. Pick any message, hit enter, and your editor opens with it ready to go. No copy-paste, no export dance, no re-prompt to save the last response as file.

---

## Quick Start

### Install the extension
```bash
pi install git:github.com/John-Dekka/pi-save
```

That's it. Type `/save` and you're saving.

## What It Is

pi-save is an extension for [pi](https://pi.dev) that adds a `/save` slash command. You have two ways to use it:

- **`/save`** — opens the session tree picker. Pick any single message — user, assistant, tool result, bash execution, custom, branch summary, compaction summary, the lot — and your editor opens with that message's body preloaded.
- **`/save all`** — exports the full conversation as a clean JSON array of `{"role", "content"}` objects. Tool calls, thinking blocks, model changes, and other metadata are stripped — just user and assistant turns in chronological order.

In both cases, the file lands directly in your project directory at `.pi/saved_messages/` with a descriptive name like `assistant_a53f79fc_approach-b-is-ex.md` or `conversation_2026-06-05_what-s-the-capital-of.json`. Review the content, make tweaks, close the editor, and the file stays right where you want it.

## How It Works

1. **Install the extension**, obviously.
2. **Type `/save`** (or **`/save all`**) in interactive mode
3. - **`/save`**: pick a message from the session tree (pi's built-in `TreeSelectorComponent` — looks exactly like `/tree`). The file opens in your editor; close it when done.
   - **`/save all`**: the full conversation is written directly to a `.json` file — no picker, no editor, just a clean export.
4. The file is saved at `.pi/saved_messages/<role>_<entry-id-prefix>_<slug>.md` (single) or `.pi/saved_messages/conversation_<date>_<slug>.json` (all).

## Requirements
- [pi](https://pi.dev) coding agent (interactive TUI mode)
- Node.js that supports ES modules
- A text editor available on `$PATH` (or set `$VISUAL` / `$EDITOR`)
- The extension currently relies on pi's interactive TUI — the picker does not work in `--mode rpc` or `-p` print mode

## Usage Notes

- Saved files accumulate in `.pi/saved_messages/` under your project root. Each save produces a deterministic filename — saving the same message twice overwrites the previous file, which is usually what you want.
- The file extension is always `.md` because the body content is most often plain text or markdown. Your editor doesn't care about the extension; you can change it if you like.
- Messages with no text body (image-only user messages, empty assistant turns, model changes) are skipped in the picker. If you only see a few messages, that's why.
- The picker does not modify the session — it's a read-only view. Selecting a message just hands its body to the editor; the session leaf stays where it was.

## License

MIT - Use it, share it, make it better. ♥️
