import { Notice, type WorkspaceLeaf } from 'obsidian';
import type SupermemoryPlugin from '../main';
import {
	hitPath,
	hitSnippet,
	hitText,
	hitTitle,
	isMemoryHit,
	isUnreachable,
	type ProfileReply,
} from '../api';
import { Panel, paintHit } from './shell';

export const PROFILE_VIEW = 'supermemory-profile';

export class ProfilePanel extends Panel {
	constructor(leaf: WorkspaceLeaf, plugin?: SupermemoryPlugin) {
		super(leaf, plugin);
	}

	getViewType(): string {
		return PROFILE_VIEW;
	}
	getDisplayText(): string {
		return 'Vault profile';
	}
	getIcon(): string {
		return 'user';
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
		header.createEl('h4', { text: 'What your notes say about you' });
		const refresh = header.createEl('button', { cls: 'sm-button', text: 'Refresh profile' });
		const focus = header.createEl('input', {
			type: 'text',
			cls: 'sm-search-input',
			placeholder: 'Optional: focus the profile on a topic',
		});
		focus.setAttribute('aria-label', 'Optional focus query');
		const snap = header.createEl('button', { cls: 'sm-button', text: 'Save snapshot' });
		const compare = header.createEl('button', { cls: 'sm-button', text: 'Compare to last snapshot' });

		const body = this.contentEl.createDiv({ cls: 'sm-results' });
		this.empty(body, 'Click "Refresh profile" to synthesize what your synced notes reveal about you.');

		let last: ProfileReply | null = null;

		const load = async () => {
			body.empty();
			body.createDiv({ cls: 'sm-loading', text: 'Synthesizing your profile…' });
			try {
				const q = focus.value.trim();
				last = await this.api().profile({
					containerTag: this.space,
					...(q ? { q } : {}),
					threshold: 0.5,
				});
				this.renderProfile(body, last);
			} catch (e) {
				body.empty();
				if (isUnreachable(e)) this.down(this.errText(e));
				else {
					this.empty(
						body,
						"Couldn't build a profile — sync the vault and wait for supermemory to finish processing.",
					);
				}
			}
		};

		refresh.addEventListener('click', () => void load());
		focus.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				void load();
			}
		});

		snap.addEventListener('click', () => {
			if (!last) {
				new Notice('Load a profile first, then save a snapshot.');
				return;
			}
			void (async () => {
				this.settings.lastProfileSnapshot = serialize(last);
				await this.plugin.saveSettings();
				new Notice('Profile snapshot saved. Sync more notes, then compare.');
			})();
		});

		compare.addEventListener('click', () => {
			const prev = this.settings.lastProfileSnapshot;
			if (!prev) {
				new Notice('No saved snapshot yet. Load a profile and save a snapshot first.');
				return;
			}
			if (!last) {
				new Notice('Load the current profile first, then compare.');
				return;
			}
			this.compare(body, prev, last);
		});
	}

	private renderProfile(parent: HTMLElement, profile: ProfileReply): void {
		parent.empty();
		const stable = profile.profile?.static ?? [];
		const current = profile.profile?.dynamic ?? [];
		const related = profile.searchResults?.results ?? [];
		const wrap = parent.createDiv({ cls: 'sm-profile' });

		const sSec = wrap.createDiv({ cls: 'sm-profile-section' });
		sSec.createEl('h5', { text: 'Stable facts' });
		sSec.createEl('p', {
			cls: 'sm-section-hint',
			text: 'Long-lived identity traits supermemory extracted from your notes.',
		});
		if (!stable.length) {
			sSec.createEl('p', {
				cls: 'sm-empty',
				text: 'No stable facts yet — sync more personal notes and wait for processing.',
			});
		} else for (const f of stable) sSec.createDiv({ cls: 'sm-fact', text: f });

		const dSec = wrap.createDiv({ cls: 'sm-profile-section' });
		dSec.createEl('h5', { text: 'Current state (most recent facts)' });
		dSec.createEl('p', {
			cls: 'sm-section-hint',
			text: 'What is true now. Use "show history" to see how a fact evolved.',
		});
		if (!current.length) {
			dSec.createEl('p', { cls: 'sm-empty', text: 'Nothing changing detected yet.' });
		} else {
			for (const f of current) {
				const row = dSec.createDiv({ cls: 'sm-fact sm-fact-dynamic' });
				row.createSpan({ text: f });
				if (f) {
					const btn = row.createEl('button', { cls: 'sm-link-button', text: 'Show history' });
					btn.addEventListener('click', () => void this.history(f, btn));
				}
			}
		}

		const mSec = wrap.createDiv({ cls: 'sm-profile-section' });
		mSec.createEl('h5', { text: 'Related notes' });
		if (!related.length) {
			mSec.createEl('p', {
				cls: 'sm-empty',
				text: profile.searchResults
					? 'No related notes surfaced for this focus.'
					: 'Add a focus topic above and refresh to pull related notes with the profile.',
			});
		} else {
			const list = mSec.createDiv({ cls: 'sm-results-list' });
			for (const h of related) paintHit(this.app, list, h, { snippet: 180 });
		}
	}

	private async history(fact: string, btn: HTMLElement): Promise<void> {
		const host = btn.parentElement;
		if (!host) return;
		const existing = host.querySelector('.sm-history');
		if (existing) {
			existing.remove();
			btn.setText('Show history');
			return;
		}
		btn.setAttribute('disabled', 'disabled');
		btn.setText('Loading history…');
		try {
			const api = this.api();
			let res = await api.search({
				q: fact,
				containerTag: this.space,
				limit: 12,
				searchMode: 'memories',
				threshold: 0.4,
			});
			if (!res.results.length) {
				res = await api.search({
					q: fact,
					containerTag: this.space,
					limit: 10,
					searchMode: 'hybrid',
					rerank: true,
					threshold: 0.4,
				});
			}
			const box = host.createDiv({ cls: 'sm-history' });
			if (!res.results.length) {
				box.createEl('p', { cls: 'sm-empty', text: 'No notes or memories touch this topic yet.' });
			} else {
				const sorted = res.results
					.map((r) => ({
						r,
						date: dateIn(hitText(r)) ?? (typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 10) : ''),
					}))
					.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

				for (const { r, date } of sorted) {
					const item = box.createDiv({ cls: 'sm-history-item' });
					item.createDiv({
						cls: 'sm-history-date',
						text: `${date || 'unknown date'} · ${isMemoryHit(r) ? 'memory' : 'note'}`,
					});
					const title = hitTitle(r);
					const path = hitPath(r);
					const tEl = item.createDiv({ cls: 'sm-result-title', text: title });
					if (path) {
						tEl.addClass('sm-result-clickable');
						tEl.addEventListener('click', () => void this.app.workspace.openLinkText(path, '', false));
					}
					const snip = hitSnippet(hitText(r));
					if (snip && snip !== title) {
						item.createDiv({ cls: 'sm-result-snippet', text: snip.slice(0, 160) });
					}
				}
			}
			btn.setText('Hide history');
		} catch {
			btn.setText('Failed to load history');
		} finally {
			btn.removeAttribute('disabled');
		}
	}

	private compare(parent: HTMLElement, previous: string, current: ProfileReply): void {
		const modal = parent.createDiv({ cls: 'sm-compare-modal' });
		modal.createEl('h4', { text: 'Profile change since last snapshot' });
		modal.createEl('button', { cls: 'sm-button', text: 'Close' }).addEventListener('click', () => modal.remove());

		const cols = modal.createDiv({ cls: 'sm-compare-cols' });
		const left = cols.createDiv({ cls: 'sm-compare-col' });
		left.createEl('h5', { text: 'Last snapshot' });
		const now = serialize(current);
		left.createEl('pre', { cls: 'sm-compare-text', text: previous });
		const right = cols.createDiv({ cls: 'sm-compare-col' });
		right.createEl('h5', { text: 'Current' });
		right.createEl('pre', { cls: 'sm-compare-text', text: now });

		const diff = modal.createDiv({ cls: 'sm-compare-diff' });
		const prev = new Set(previous.split('\n'));
		const curr = now.split('\n');
		for (const line of curr) {
			if (line.trim() && !prev.has(line)) diff.createDiv({ cls: 'sm-diff-added', text: '+ ' + line });
		}
		const currSet = new Set(curr);
		for (const line of previous.split('\n')) {
			if (line.trim() && !currSet.has(line)) diff.createDiv({ cls: 'sm-diff-removed', text: '- ' + line });
		}
	}
}

function serialize(p: ProfileReply): string {
	return [
		'## Stable facts',
		...(p.profile?.static ?? []),
		'',
		'## Current state',
		...(p.profile?.dynamic ?? []),
	].join('\n');
}

function dateIn(text: string): string | null {
	return text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
}
