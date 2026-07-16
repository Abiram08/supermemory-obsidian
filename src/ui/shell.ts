/**
 * Shared panel chrome: base ItemView, open leaf helper, result cards.
 */

import { App, ItemView, WorkspaceLeaf } from 'obsidian';
import type SupermemoryPlugin from '../main';
import {
	MemoryApi,
	hitPath,
	hitScore,
	hitSnippet,
	hitText,
	hitTitle,
	isMemoryHit,
	smMessage,
	type SearchHit,
} from '../api';
import { PLUGIN_ID } from '../config';
import { healthHint, type HealthState } from '../status';

/** Keep view ids as strings here to avoid circular imports with panel modules. */
const HOME_VIEW_ID = 'supermemory-home';

export abstract class Panel extends ItemView {
	protected readonly plugin: SupermemoryPlugin;

	constructor(leaf: WorkspaceLeaf, plugin?: SupermemoryPlugin) {
		super(leaf);
		this.plugin =
			plugin ??
			((this.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins[
				PLUGIN_ID
			] as SupermemoryPlugin);
	}

	protected get settings() {
		return this.plugin.settings;
	}

	protected get space(): string {
		return this.plugin.spaceTag();
	}

	protected api(): MemoryApi {
		return MemoryApi.of(this.settings);
	}

	/** Require API key; offer path back to home workflow. */
	protected needKey(): boolean {
		if (this.settings.apiKey) return true;
		this.contentEl.empty();
		const wrap = this.contentEl.createDiv({ cls: 'sm-results' });
		wrap.createEl('p', {
			cls: 'sm-empty',
			text: 'No supermemory API key set. Open the Supermemory hub or settings to add the sm_… token from supermemory-server.',
		});
		const row = wrap.createDiv({ cls: 'sm-home-secondary' });
		const hub = row.createEl('button', { cls: 'sm-button sm-button-primary', text: 'Open hub' });
		hub.addEventListener('click', () => void openPanel(this.app, HOME_VIEW_ID));
		const set = row.createEl('button', { cls: 'sm-button', text: 'Settings' });
		set.addEventListener('click', () => this.plugin.openSettings());
		return false;
	}

	protected empty(parent: HTMLElement, text: string): void {
		parent.createDiv({ cls: 'sm-empty', text });
	}

	protected down(message: string): void {
		this.contentEl.empty();
		const b = this.contentEl.createDiv({ cls: 'sm-error-banner' });
		b.createEl('strong', { text: "Supermemory Local isn't reachable" });
		b.createEl('p', { text: message });
		b.createEl('p', {
			cls: 'sm-error-hint',
			text: 'Start it with `supermemory-server` or `npx supermemory local`, then retry from the hub.',
		});
		const row = b.createDiv({ cls: 'sm-home-secondary' });
		const hub = row.createEl('button', { cls: 'sm-button sm-button-primary', text: 'Open hub' });
		hub.addEventListener('click', () => void openPanel(this.app, HOME_VIEW_ID));
	}

	protected offlineBanner(health: HealthState): void {
		this.down(healthHint(health));
	}

	protected errText(e: unknown): string {
		return smMessage(e);
	}
}

export async function openPanel(app: App, type: string): Promise<void> {
	let leaf = app.workspace.getLeavesOfType(type)[0] ?? null;
	if (!leaf) {
		const right = app.workspace.getRightLeaf(false);
		if (!right) return;
		leaf = right;
		await leaf.setViewState({ type, active: true });
	} else {
		await leaf.setViewState({ type, active: true });
	}
	await app.workspace.revealLeaf(leaf);
}

export function paintHit(
	app: App,
	parent: HTMLElement,
	hit: SearchHit,
	opts: { snippet?: number; badge?: boolean; score?: boolean; date?: boolean } = {},
): void {
	const { snippet = 240, badge = false, score = false, date = false } = opts;
	const el = parent.createDiv({ cls: 'sm-result' });
	const mem = isMemoryHit(hit);
	if (mem) el.addClass('sm-result-memory');
	if (badge) el.createDiv({ cls: 'sm-result-badge', text: mem ? 'memory' : 'note' });

	const title = hitTitle(hit);
	const path = hitPath(hit);
	const titleEl = el.createDiv({ cls: 'sm-result-title', text: title });
	if (path) {
		titleEl.addClass('sm-result-clickable');
		const open = () => void app.workspace.openLinkText(path, '', false);
		titleEl.addEventListener('click', open);
		el.createDiv({ cls: 'sm-result-path', text: path }).addEventListener('click', open);
	}

	const snip = hitSnippet(hitText(hit));
	if (snip && (!mem || snip !== title)) {
		el.createDiv({ cls: 'sm-result-snippet', text: snip.slice(0, snippet) });
	}
	if (score) {
		const s = hitScore(hit);
		if (s != null) el.createDiv({ cls: 'sm-result-score', text: `relevance ${(s * 100).toFixed(0)}%` });
	}
	if (date && hit.updatedAt) {
		el.createDiv({ cls: 'sm-result-date', text: `updated ${String(hit.updatedAt).slice(0, 10)}` });
	}
}
