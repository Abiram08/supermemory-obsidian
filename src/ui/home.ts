/**
 * Workflow hub — single place for setup → sync → use with Supermemory Local.
 */

import { Notice, type WorkspaceLeaf } from 'obsidian';
import type SupermemoryPlugin from '../main';
import {
	checkHealth,
	clearHealthCache,
	healthHint,
	healthLabel,
	isOnline,
	nextAction,
	workflowSteps,
	type HealthState,
} from '../status';
import { PROFILE_VIEW } from './profile';
import { SEARCH_VIEW } from './search';
import { openPanel, Panel } from './shell';
import { SUGGEST_VIEW } from './suggest';

export const HOME_VIEW = 'supermemory-home';

export class HomePanel extends Panel {
	private health: HealthState | null = null;

	constructor(leaf: WorkspaceLeaf, plugin?: SupermemoryPlugin) {
		super(leaf, plugin);
	}

	getViewType(): string {
		return HOME_VIEW;
	}
	getDisplayText(): string {
		return 'Supermemory';
	}
	getIcon(): string {
		return 'brain-circuit';
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async refresh(force = true): Promise<void> {
		this.contentEl.empty();
		const loading = this.contentEl.createDiv({ cls: 'sm-results' });
		loading.createDiv({ cls: 'sm-loading', text: 'Checking Supermemory Local…' });

		this.health = await checkHealth(this.settings, { force });
		this.plugin.setConnectionState(this.health);
		this.draw(this.health);
	}

	private draw(health: HealthState): void {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: 'sm-home' });

		// Header
		const header = root.createDiv({ cls: 'sm-panel-header' });
		header.createEl('h4', { text: 'Supermemory for Obsidian' });
		header.createEl('p', {
			cls: 'sm-section-hint',
			text: 'Local memory for your vault — semantic search, related notes while writing, and a living profile. Powered by Supermemory Local on your machine.',
		});

		// Status card
		const status = root.createDiv({ cls: 'sm-status-card' });
		const badge = status.createDiv({
			cls: 'sm-status-badge sm-status-' + health.state,
			text: healthLabel(health),
		});
		badge.setAttr('aria-live', 'polite');
		status.createDiv({ cls: 'sm-status-hint', text: healthHint(health) });
		status.createDiv({
			cls: 'sm-status-meta',
			text: `URL · ${this.settings.baseURL}  ·  space · ${this.space}`,
		});

		const refreshBtn = status.createEl('button', { cls: 'sm-button', text: 'Refresh status' });
		refreshBtn.addEventListener('click', () => void this.refresh(true));

		// Workflow steps
		const stepsWrap = root.createDiv({ cls: 'sm-workflow' });
		stepsWrap.createEl('h5', { text: 'Workflow' });
		const steps = workflowSteps(this.settings, health);
		for (const step of steps) {
			const row = stepsWrap.createDiv({
				cls:
					'sm-step' +
					(step.done ? ' sm-step-done' : '') +
					(step.current ? ' sm-step-current' : ''),
			});
			row.createSpan({
				cls: 'sm-step-mark',
				text: step.done ? '✓' : step.current ? '→' : '○',
			});
			const body = row.createDiv({ cls: 'sm-step-body' });
			body.createDiv({ cls: 'sm-step-title', text: step.title });
			body.createDiv({ cls: 'sm-step-detail', text: step.detail });
		}

		// Primary next action
		const next = nextAction(this.settings, health);
		const actions = root.createDiv({ cls: 'sm-home-actions' });
		actions.createEl('h5', { text: 'Next' });

		const primary = actions.createEl('button', {
			cls: 'sm-button sm-button-primary',
			text: next.label,
		});
		primary.addEventListener('click', () => void this.runAction(next.action));

		// Secondary actions (always visible when useful)
		const secondary = actions.createDiv({ cls: 'sm-home-secondary' });

		const syncBtn = secondary.createEl('button', { cls: 'sm-button', text: 'Sync vault' });
		syncBtn.disabled = !isOnline(health);
		syncBtn.addEventListener('click', () => void this.plugin.runSync('incremental'));

		const searchBtn = secondary.createEl('button', { cls: 'sm-button', text: 'Search' });
		searchBtn.addEventListener('click', () => void openPanel(this.app, SEARCH_VIEW));

		const suggestBtn = secondary.createEl('button', { cls: 'sm-button', text: 'Related while writing' });
		suggestBtn.addEventListener('click', () => void openPanel(this.app, SUGGEST_VIEW));

		const profileBtn = secondary.createEl('button', { cls: 'sm-button', text: 'Profile' });
		profileBtn.addEventListener('click', () => void openPanel(this.app, PROFILE_VIEW));

		const settingsBtn = secondary.createEl('button', { cls: 'sm-button', text: 'Settings' });
		settingsBtn.addEventListener('click', () => this.plugin.openSettings());

		// Sync stats
		const n = Object.keys(this.settings.syncIndex ?? {}).length;
		const stats = root.createDiv({ cls: 'sm-home-stats' });
		stats.createEl('h5', { text: 'Vault memory' });
		stats.createDiv({
			cls: 'sm-status-meta',
			text: this.settings.lastSyncAt
				? `Last sync ${new Date(this.settings.lastSyncAt).toLocaleString()} · ${n} note${n === 1 ? '' : 's'} indexed`
				: 'Not synced yet — run sync after Supermemory Local is connected.',
		});
		if (isOnline(health) && n > 0) {
			stats.createDiv({
				cls: 'sm-section-hint',
				text: 'After a large first sync, wait a bit for Supermemory to finish processing before expecting a full profile.',
			});
		}

		// Local setup cheatsheet
		const help = root.createDiv({ cls: 'sm-home-help' });
		help.createEl('h5', { text: 'Start Supermemory Local' });
		help.createEl('pre', {
			cls: 'sm-code',
			text: 'npx supermemory local\n# or: supermemory-server\n# copy the sm_… API key into Settings',
		});
		help.createEl('p', {
			cls: 'sm-section-hint',
			text: 'Docs: supermemory.ai/docs/self-hosting/quickstart — same Memory API as cloud, pointed at localhost:6767.',
		});
	}

	private async runAction(action: 'settings' | 'sync' | 'search' | 'profile' | 'retry'): Promise<void> {
		switch (action) {
			case 'settings':
				this.plugin.openSettings();
				break;
			case 'sync':
				await this.plugin.runSync('incremental');
				await this.refresh(true);
				break;
			case 'search':
				await openPanel(this.app, SEARCH_VIEW);
				break;
			case 'profile':
				await openPanel(this.app, PROFILE_VIEW);
				break;
			case 'retry': {
				clearHealthCache();
				const h = await checkHealth(this.settings, { force: true });
				this.plugin.setConnectionState(h);
				if (isOnline(h)) new Notice('Supermemory Local is connected.');
				else new Notice(healthHint(h));
				await this.refresh(false);
				break;
			}
		}
	}
}
