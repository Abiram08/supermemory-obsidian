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

		this.contentEl.createDiv({ cls: 'sm-panel-header' }).createEl('h4', { text: 'Related notes' });
		const out = this.contentEl.createDiv({ cls: 'sm-results' });
		this.empty(out, 'Open a note and start writing. Related past notes show up here automatically.');

		const run = debounce(async (text: string, path: string | null) => {
			const q = tailQuery(text);
			const id = ++this.seq;
			if (!q) {
				if (id === this.seq) {
					out.empty();
					this.empty(out, 'Keep writing — related notes will appear here as you pause.');
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
					limit: SUGGEST_LIMIT + 3,
					searchMode: 'hybrid',
					threshold: 0.5,
				});
				if (id !== this.seq) return;
				this.show(out, res, path);
			} catch (e) {
				if (id !== this.seq) return;
				out.empty();
				if (isUnreachable(e)) this.down(this.errText(e));
				else this.empty(out, "Couldn't fetch related notes right now.");
			}
		}, SUGGEST_MS);

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
					this.empty(out, 'Open a note and start writing. Related past notes show up here automatically.');
					return;
				}
				if (view.file.path !== this.path) {
					this.path = view.file.path;
					out.empty();
					this.empty(out, 'Keep writing — related notes will appear here as you pause.');
				}
				if (view.editor) void run(view.editor.getValue(), this.path);
			}),
		);
	}

	private show(parent: HTMLElement, res: SearchReply, current: string | null): void {
		parent.empty();
		const hits = (res.results ?? [])
			.filter((h) => hitPath(h) !== current)
			.slice(0, SUGGEST_LIMIT);
		if (!hits.length) {
			this.empty(parent, "No related notes yet for what you're writing.");
			return;
		}
		const list = parent.createDiv({ cls: 'sm-results-list' });
		for (const h of hits) paintHit(this.app, list, h, { snippet: 180 });
	}
}

function tailQuery(text: string): string {
	const t = text.trim();
	if (!t) return '';
	const paras = t.split(/\n\s*\n/).filter(Boolean);
	const last = paras[paras.length - 1];
	if (last && last.length > 8) return last.slice(0, 400);
	return paras.slice(-2).join('\n\n').slice(-400);
}
