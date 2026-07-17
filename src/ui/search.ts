import type { WorkspaceLeaf } from 'obsidian';
import type SupermemoryPlugin from '../main';
import type { SearchReply } from '../api';
import { SEARCH_LIMIT } from '../config';
import { topFolder } from '../notes';
import { isUnreachable } from '../api';
import { Panel, paintHit } from './shell';

export const SEARCH_VIEW = 'supermemory-search';

export class SearchPanel extends Panel {
	constructor(leaf: WorkspaceLeaf, plugin?: SupermemoryPlugin) {
		super(leaf, plugin);
	}

	getViewType(): string {
		return SEARCH_VIEW;
	}
	getDisplayText(): string {
		return 'Supermemory search';
	}
	getIcon(): string {
		return 'search';
	}

	async onOpen(): Promise<void> {
		this.draw();
	}
	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private vaultFolders(): string[] {
		const set = new Set<string>();
		for (const f of this.app.vault.getMarkdownFiles()) {
			set.add(topFolder(f.path));
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}

	private draw(): void {
		this.contentEl.empty();
		if (!this.needKey()) return;

		const header = this.contentEl.createDiv({ cls: 'sm-panel-header' });
		const input = header.createEl('input', {
			type: 'text',
			cls: 'sm-search-input',
			placeholder: 'Search your vault by meaning, not keywords…',
		});
		input.setAttribute('aria-label', 'Semantic search query');

		// Folder filter row
		const filterRow = header.createDiv({ cls: 'sm-mode-row' });
		filterRow.createSpan({ cls: 'sm-filter-label', text: 'Folder' });
		const folderSelect = filterRow.createEl('select', { cls: 'sm-select' });
		folderSelect.setAttribute('aria-label', 'Filter by top-level folder');
		const optAll = folderSelect.createEl('option', { text: 'All folders', value: 'all' });
		optAll.selected = true;
		for (const folder of this.vaultFolders()) {
			folderSelect.createEl('option', { text: folder, value: folder });
		}

		// Mode row
		const modes = header.createDiv({ cls: 'sm-mode-row' });
		const hybrid = modes.createEl('button', {
			cls: 'sm-button sm-mode-active',
			text: 'Hybrid (notes + memories)',
		});
		const memOnly = modes.createEl('button', { cls: 'sm-button', text: 'Memories only' });
		let mode: 'hybrid' | 'memories' = 'hybrid';

		const setMode = (m: 'hybrid' | 'memories') => {
			mode = m;
			hybrid.toggleClass('sm-mode-active', m === 'hybrid');
			memOnly.toggleClass('sm-mode-active', m === 'memories');
		};
		hybrid.addEventListener('click', () => {
			setMode('hybrid');
			if (input.value.trim()) void go(input.value);
		});
		memOnly.addEventListener('click', () => {
			setMode('memories');
			if (input.value.trim()) void go(input.value);
		});
		folderSelect.addEventListener('change', () => {
			if (input.value.trim()) void go(input.value);
		});

		const out = this.contentEl.createDiv({ cls: 'sm-results' });
		this.empty(
			out,
			"Type a phrase above. Optionally pick a folder to scope meaning search — e.g. only Projects.",
		);

		const go = async (raw: string) => {
			const q = raw.trim();
			if (!q) {
				out.empty();
				this.empty(out, 'Type a phrase above to search by meaning.');
				return;
			}
			const folder = folderSelect.value || 'all';
			out.empty();
			out.createDiv({
				cls: 'sm-loading',
				text:
					folder === 'all'
						? 'Searching…'
						: `Searching in “${folder}”…`,
			});
			try {
				const res = await this.api().search({
					q,
					containerTag: this.space,
					limit: SEARCH_LIMIT,
					searchMode: mode,
					threshold: 0.4,
					folder: folder === 'all' ? null : folder,
				});
				this.show(out, q, res, mode, folder);
			} catch (e) {
				out.empty();
				if (isUnreachable(e)) this.down(this.errText(e));
				else this.empty(out, 'Search failed: ' + this.errText(e));
			}
		};

		input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				void go(input.value);
			}
		});
	}

	private show(
		parent: HTMLElement,
		q: string,
		res: SearchReply,
		mode: string,
		folder: string,
	): void {
		parent.empty();
		const total = res.total ?? res.results.length;
		const ms = typeof res.timing === 'number' ? ` · ${Math.round(res.timing)}ms` : '';
		const scope = folder === 'all' ? 'all folders' : `folder: ${folder}`;
		parent.createDiv({
			cls: 'sm-results-meta',
			text: `${total} result${total === 1 ? '' : 's'} for "${q}" (${mode} · ${scope})${ms}`,
		});
		const list = parent.createDiv({ cls: 'sm-results-list' });
		if (!res.results.length) {
			this.empty(
				list,
				folder === 'all'
					? 'No relevant notes found. Try a different phrasing, or sync the vault first.'
					: `No hits in “${folder}”. Try All folders, or another folder.`,
			);
			return;
		}
		for (const h of res.results) {
			paintHit(this.app, list, h, { snippet: 240, badge: true, score: true, date: true });
		}
	}
}
