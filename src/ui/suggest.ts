import { Editor, MarkdownView, debounce, type WorkspaceLeaf } from 'obsidian';
import type SupermemoryPlugin from '../main';
import { hitPath, isUnreachable, type SearchReply } from '../api';
import { SUGGEST_LIMIT, SUGGEST_MS } from '../config';
import { Panel, paintHit } from './shell';

export const SUGGEST_VIEW = 'supermemory-suggest';

export class SuggestPanel extends Panel {
	private path: string | null = null;
	private seq = 0;

	constructor(leaf: WorkspaceLeaf, plugin?: SupermemoryPlugin) {
		super(leaf, plugin);
	}

	getViewType(): string {
		return SUGGEST_VIEW;
	}
	getDisplayText(): string {
		return 'Related while writing';
	}
	getIcon(): string {
		return 'lightbulb';
	}

	async onOpen(): Promise<void> {
		this.draw();
	}
	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private draw(): void {
		this.contentEl.empty();
		if (!this.needKey()) return;

		const header = this.contentEl.createDiv({ cls: 'sm-panel-header' });
		header.createEl('h4', { text: 'Related notes' });
		header.createEl('p', {
			cls: 'sm-section-hint',
			text: 'Type in a markdown note, then pause ~1 second. Or click Find related now.',
		});
		const findBtn = header.createEl('button', { cls: 'sm-button sm-button-primary', text: 'Find related now' });

		const out = this.contentEl.createDiv({ cls: 'sm-results' });
		this.empty(out, 'Open a markdown note and start writing (at least a short sentence).');

		// resetTimer=true: wait until typing pauses (Obsidian debounce)
		const run = debounce(async (text: string, path: string | null) => {
			const q = tailQuery(text);
			const id = ++this.seq;
			if (!q) {
				if (id === this.seq) {
					out.empty();
					this.empty(
						out,
						'Keep writing — need a bit more text (a full sentence helps), then pause or click Find related now.',
					);
				}
				return;
			}
			if (id !== this.seq) return;
			out.empty();
			out.createDiv({ cls: 'sm-loading', text: 'Finding related notes…' });
			try {
				const res = await this.api().search({
					q,
					containerTag: this.space,
					limit: SUGGEST_LIMIT + 5,
					searchMode: 'hybrid',
					// Lower threshold so Local hybrid still returns chunk matches
					threshold: 0.35,
				});
				if (id !== this.seq) return;
				this.show(out, res, path);
			} catch (e) {
				if (id !== this.seq) return;
				out.empty();
				if (isUnreachable(e)) this.down(this.errText(e));
				else this.empty(out, "Couldn't fetch related notes: " + this.errText(e));
			}
		}, SUGGEST_MS, true);

		const kick = () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) {
				out.empty();
				this.empty(out, 'Click into a markdown note first, then type or press Find related now.');
				return;
			}
			this.path = view.file.path;
			const text = view.editor?.getValue() ?? '';
			void run(text, this.path);
		};

		findBtn.addEventListener('click', () => kick());

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return;
				this.path = view.file.path;
				void run(editor.getValue(), this.path);
			}),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					this.path = null;
					out.empty();
					this.empty(out, 'Open a markdown note and start writing.');
					return;
				}
				this.path = view.file.path;
				if (view.editor) void run(view.editor.getValue(), this.path);
			}),
		);

		// Run once on open if a note is already active
		kick();
	}

	private show(parent: HTMLElement, res: SearchReply, currentPath: string | null): void {
		parent.empty();
		const raw = res?.results ?? [];
		// Prefer other notes; if all hits are the current file, still show them (better than empty)
		const others = raw.filter((r) => {
			const p = hitPath(r);
			return !p || p !== currentPath;
		});
		const results = (others.length > 0 ? others : raw).slice(0, SUGGEST_LIMIT);

		if (results.length === 0) {
			this.empty(
				parent,
				'No related notes found. Sync the vault first, type a longer sentence about a topic you already wrote about, then pause or click Find related now.',
			);
			return;
		}

		parent.createDiv({
			cls: 'sm-results-meta',
			text: `${results.length} related note${results.length === 1 ? '' : 's'}`,
		});
		const list = parent.createDiv({ cls: 'sm-results-list' });
		for (const h of results) paintHit(this.app, list, h, { snippet: 180, score: true });
	}
}

/** Build a search query from recent writing — works with single newlines, not only blank lines. */
function tailQuery(text: string): string {
	const t = text.trim();
	if (t.length < 12) return '';

	// Prefer last paragraph (blank-line separated)
	const paras = t.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
	if (paras.length > 0) {
		const last = (paras[paras.length - 1] ?? '').trim();
		if (last.length >= 12) return last.slice(0, 400);
		const joined = paras.slice(-2).join('\n').trim();
		if (joined.length >= 12) return joined.slice(0, 400);
	}

	// Fallback: last ~400 chars of the note (covers single-newline typing)
	return t.slice(-400);
}
