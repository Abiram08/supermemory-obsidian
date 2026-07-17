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
	type SearchHit,
} from '../api';
import { writeLivingProfileNote } from '../livingProfile';
import { buildProfileFactsFromVault } from '../profileBuild';
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
		header.createEl('p', {
			cls: 'sm-section-hint',
			text: `Space: ${this.space} · Local extracts facts after sync (needs LLM). Search still works on note text while profile fills.`,
		});
		const refresh = header.createEl('button', { cls: 'sm-button sm-button-primary', text: 'Refresh profile' });
		const buildBtn = header.createEl('button', {
			cls: 'sm-button',
			text: 'Build profile facts',
		});
		buildBtn.setAttr(
			'title',
			'If Stable/Current stay empty after sync, build facts from your notes into Supermemory',
		);
		const liveBtn = header.createEl('button', {
			cls: 'sm-button',
			text: 'Write living note',
		});
		liveBtn.setAttr('title', 'Write Meta/My memory profile.md from Supermemory profile');
		const focus = header.createEl('input', {
			type: 'text',
			cls: 'sm-search-input',
			placeholder: 'Optional: focus on a topic (e.g. database)',
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
				const profile = await this.api().profile({
					containerTag: this.space,
					...(q ? { q } : {}),
					// Soft threshold — only affects profile searchResults, not static/dynamic lists
					threshold: 0.4,
				});

				const staticFacts = profile.profile?.static ?? [];
				const dynamicFacts = profile.profile?.dynamic ?? [];
				const emptyFacts = staticFacts.length === 0 && dynamicFacts.length === 0;

				// Local often finishes document index before LLM fact extraction.
				// Fall back to hybrid note search so the panel is still useful for demos.
				let noteHits: SearchHit[] = profile.searchResults?.results ?? [];
				if (emptyFacts || noteHits.length === 0) {
					const fallbackQ =
						q ||
						'preferences decisions tools stack projects database goals habits work';
					const search = await this.api().search({
						q: fallbackQ,
						containerTag: this.space,
						limit: 12,
						searchMode: 'hybrid',
						threshold: 0.3,
					});
					noteHits = search.results ?? [];
				}

				last = {
					...profile,
					searchResults: {
						results: noteHits,
						total: noteHits.length,
					},
				};
				this.renderProfile(body, last, emptyFacts);
			} catch (e) {
				body.empty();
				if (isUnreachable(e)) this.down(this.errText(e));
				else {
					this.empty(
						body,
						"Couldn't build a profile: " +
							this.errText(e) +
							' — sync the vault and keep Local running with a working LLM key (e.g. Groq).',
					);
				}
			}
		};

		refresh.addEventListener('click', () => void load());
		buildBtn.addEventListener('click', () => {
			void (async () => {
				buildBtn.setAttr('disabled', 'disabled');
				const r = await buildProfileFactsFromVault(this.app, this.plugin);
				buildBtn.removeAttribute('disabled');
				if (r.ok) void load();
			})();
		});
		liveBtn.addEventListener('click', () => {
			void writeLivingProfileNote(this.plugin, { open: true });
		});
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

	private renderProfile(parent: HTMLElement, profile: ProfileReply, factsEmpty: boolean): void {
		parent.empty();
		const stable = profile.profile?.static ?? [];
		const current = profile.profile?.dynamic ?? [];
		const related = profile.searchResults?.results ?? [];
		const wrap = parent.createDiv({ cls: 'sm-profile' });

		if (factsEmpty) {
			const banner = wrap.createDiv({ cls: 'sm-status-card' });
			banner.createDiv({
				cls: 'sm-status-hint',
				text:
					'No extracted profile facts yet (Stable / Current are empty). ' +
					'Documents are indexed — hybrid search works — but Local has not filled static/dynamic memories. ' +
					'Keep Local running with a valid LLM key (Groq/OpenAI/…), wait a few minutes after sync, then refresh. ' +
					'Below: related notes from your vault so you can still demo value.',
			});
		}

		const sSec = wrap.createDiv({ cls: 'sm-profile-section' });
		sSec.createEl('h5', { text: 'Stable facts' });
		sSec.createEl('p', {
			cls: 'sm-section-hint',
			text: 'Long-lived identity traits Supermemory extracted from your notes.',
		});
		if (!stable.length) {
			sSec.createEl('p', {
				cls: 'sm-empty',
				text: 'No stable facts yet — Local needs LLM memory extraction after sync. Use related notes below for now.',
			});
		} else for (const f of stable) sSec.createDiv({ cls: 'sm-fact', text: f });

		const dSec = wrap.createDiv({ cls: 'sm-profile-section' });
		dSec.createEl('h5', { text: 'Current state (most recent facts)' });
		dSec.createEl('p', {
			cls: 'sm-section-hint',
			text: 'What is true now. Use "show history" to see how a fact evolved.',
		});
		if (!current.length) {
			dSec.createEl('p', {
				cls: 'sm-empty',
				text: 'Nothing changing detected yet — same cause as empty stable facts (extraction still pending or LLM issue).',
			});
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

		// When profile facts are empty, still offer history on a synthetic "topic"
		if (factsEmpty) {
			const tip = wrap.createDiv({ cls: 'sm-profile-section' });
			tip.createEl('h5', { text: 'Topic history (from notes)' });
			tip.createEl('p', {
				cls: 'sm-section-hint',
				text: 'While profile facts are empty, pick a topic and search your notes over time.',
			});
			const row = tip.createDiv({ cls: 'sm-home-secondary' });
			for (const topic of ['database', 'preferences', 'tools', 'work']) {
				const b = row.createEl('button', { cls: 'sm-button', text: `History: ${topic}` });
				b.addEventListener('click', () => {
					void (async () => {
						const host = tip.createDiv({ cls: 'sm-history' });
						host.createDiv({ cls: 'sm-loading', text: 'Loading…' });
						await this.fillHistory(host, topic);
					})();
				});
			}
		}

		const mSec = wrap.createDiv({ cls: 'sm-profile-section' });
		mSec.createEl('h5', { text: factsEmpty ? 'Related notes (from your vault)' : 'Related notes' });
		if (!related.length) {
			mSec.createEl('p', {
				cls: 'sm-empty',
				text: 'No notes returned. Sync the vault and confirm Search works for this vault first.',
			});
		} else {
			const list = mSec.createDiv({ cls: 'sm-results-list' });
			for (const h of related) {
				paintHit(this.app, list, h, { snippet: 180, score: true, badge: true });
			}
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
			const box = host.createDiv({ cls: 'sm-history' });
			await this.fillHistory(box, fact);
			btn.setText('Hide history');
		} catch {
			btn.setText('Failed to load history');
		} finally {
			btn.removeAttribute('disabled');
		}
	}

	private async fillHistory(box: HTMLElement, topic: string): Promise<void> {
		box.empty();
		const api = this.api();
		let res = await api.search({
			q: topic,
			containerTag: this.space,
			limit: 12,
			searchMode: 'memories',
			threshold: 0.3,
		});
		if (!res.results.length) {
			res = await api.search({
				q: topic,
				containerTag: this.space,
				limit: 12,
				searchMode: 'hybrid',
				threshold: 0.3,
			});
		}
		if (!res.results.length) {
			box.createEl('p', { cls: 'sm-empty', text: 'No notes or memories touch this topic yet.' });
			return;
		}
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
	const staticF = p.profile?.static ?? [];
	const dynamicF = p.profile?.dynamic ?? [];
	const related = (p.searchResults?.results ?? []).map((r) => hitTitle(r));
	return [
		'## Stable facts',
		...(staticF.length ? staticF : ['(none yet)']),
		'',
		'## Current state',
		...(dynamicF.length ? dynamicF : ['(none yet)']),
		'',
		'## Related notes',
		...related.slice(0, 12),
	].join('\n');
}

function dateIn(text: string): string | null {
	return text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
}
