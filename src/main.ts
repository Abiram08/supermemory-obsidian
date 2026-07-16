import { Notice, Plugin, TAbstractFile, TFile, debounce } from 'obsidian';
import { smMessage } from './api';
import {
	AUTO_SYNC_MS,
	DEFAULT_SETTINGS,
	normalizeBaseUrl,
	setDebug,
	type PluginSettings,
} from './config';
import { containerTag } from './notes';
import {
	checkHealth,
	clearHealthCache,
	healthLabel,
	isOnline,
	type HealthState,
} from './status';
import { cancelSync, syncBusy, syncOne, syncVault } from './sync';
import { HOME_VIEW, HomePanel } from './ui/home';
import { PROFILE_VIEW, ProfilePanel } from './ui/profile';
import { SEARCH_VIEW, SearchPanel } from './ui/search';
import { SettingsTab } from './ui/settings';
import { openPanel } from './ui/shell';
import { SUGGEST_VIEW, SuggestPanel } from './ui/suggest';

export default class SupermemoryPlugin extends Plugin {
	settings!: PluginSettings;
	private statusEl: HTMLElement | null = null;
	private lastHealth: HealthState = { state: 'no-key' };
	private healthTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		setDebug(this.settings.debug);

		this.addSettingTab(new SettingsTab(this.app, this));

		this.registerView(HOME_VIEW, (leaf) => new HomePanel(leaf, this));
		this.registerView(SEARCH_VIEW, (leaf) => new SearchPanel(leaf, this));
		this.registerView(SUGGEST_VIEW, (leaf) => new SuggestPanel(leaf, this));
		this.registerView(PROFILE_VIEW, (leaf) => new ProfilePanel(leaf, this));

		// --- Core workflow commands ---
		this.addCommand({
			id: 'open-home',
			name: 'Open supermemory hub',
			callback: () => void openPanel(this.app, HOME_VIEW),
		});
		this.addCommand({
			id: 'check-connection',
			name: 'Check Supermemory Local connection',
			callback: () => void this.refreshHealth(true, true),
		});
		this.addCommand({
			id: 'sync-vault',
			name: 'Sync vault to supermemory',
			callback: () => void this.runSync('incremental'),
		});
		this.addCommand({
			id: 'sync-vault-full',
			name: 'Force full re-sync to supermemory',
			callback: () => void this.runSync('full'),
		});
		this.addCommand({
			id: 'cancel-sync',
			name: 'Cancel running sync',
			callback: () => {
				new Notice(
					cancelSync() ? 'Supermemory: cancelling sync…' : 'Supermemory: no sync is running.',
				);
			},
		});
		this.addCommand({
			id: 'open-search',
			name: 'Open semantic search',
			callback: () => void openPanel(this.app, SEARCH_VIEW),
		});
		this.addCommand({
			id: 'open-suggest',
			name: 'Open related-notes panel (while writing)',
			callback: () => void openPanel(this.app, SUGGEST_VIEW),
		});
		this.addCommand({
			id: 'open-profile',
			name: 'Open vault profile',
			callback: () => void openPanel(this.app, PROFILE_VIEW),
		});

		// Hub first — primary entry for the Local workflow
		this.addRibbonIcon('brain-circuit', 'Supermemory hub', () => {
			void openPanel(this.app, HOME_VIEW);
		});
		this.addRibbonIcon('search', 'Supermemory search', () => void openPanel(this.app, SEARCH_VIEW));
		this.addRibbonIcon('user', 'Supermemory profile', () => void openPanel(this.app, PROFILE_VIEW));

		// Status bar: always-visible connection state
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass('sm-status-bar');
		this.statusEl.setAttr('aria-label', 'Supermemory Local connection');
		this.statusEl.addEventListener('click', () => void openPanel(this.app, HOME_VIEW));
		this.paintStatusBar({ state: 'no-key' }, false);

		// Auto-sync active note (optional)
		const onEdit = debounce(
			(file: TFile) => {
				if (!this.settings.autoSync || syncBusy()) return;
				if (!isOnline(this.lastHealth)) return;
				void syncOne(this.app, this, file);
			},
			AUTO_SYNC_MS,
			true,
		);
		const md = (f: TAbstractFile) => {
			if (f instanceof TFile && f.extension === 'md') onEdit(f);
		};
		this.registerEvent(this.app.vault.on('modify', md));
		this.registerEvent(this.app.vault.on('create', md));

		// Initial health + light poll (does not spam notices)
		void this.refreshHealth(true, false);
		this.healthTimer = window.setInterval(() => {
			void this.refreshHealth(false, false);
		}, 30_000);
		this.register(() => {
			if (this.healthTimer != null) window.clearInterval(this.healthTimer);
		});

		// First-run: open hub if never configured
		if (!this.settings.apiKey) {
			this.app.workspace.onLayoutReady(() => {
				void openPanel(this.app, HOME_VIEW);
			});
		}
	}

	onunload(): void {
		cancelSync();
		if (this.healthTimer != null) window.clearInterval(this.healthTimer);
	}

	spaceTag(): string {
		return containerTag(this.app.vault.getName());
	}

	/** Used by settings + home after connection tests. */
	setConnectionState(health: HealthState): void {
		this.lastHealth = health;
		this.paintStatusBar(health, syncBusy());
	}

	openSettings(): void {
		// Obsidian public API: open settings and focus this plugin tab when possible
		const setting = (
			this.app as unknown as {
				setting?: { open: () => void; openTabById: (id: string) => void };
			}
		).setting;
		if (setting) {
			setting.open();
			setting.openTabById('obsidian-supermemory');
		} else {
			new Notice('Open Settings → Community plugins → Supermemory for Obsidian.');
		}
	}

	async refreshHealth(force: boolean, notice: boolean): Promise<HealthState> {
		if (force) clearHealthCache();
		const health = await checkHealth(this.settings, { force });
		this.setConnectionState(health);
		if (notice) {
			if (isOnline(health)) new Notice('Supermemory Local is connected.');
			else new Notice(`Supermemory: ${healthLabel(health)}`);
		}
		return health;
	}

	async runSync(mode: 'incremental' | 'full'): Promise<void> {
		// Preflight: don't start a long sync against a dead server
		const health = await this.refreshHealth(true, false);
		if (!this.settings.apiKey) {
			new Notice('Supermemory: no API key set. Open the hub or settings first.');
			void openPanel(this.app, HOME_VIEW);
			return;
		}
		if (!isOnline(health)) {
			new Notice(
				"Supermemory Local isn't reachable — start `supermemory-server`, then try sync again.",
			);
			void openPanel(this.app, HOME_VIEW);
			return;
		}

		this.paintStatusBar(health, true);
		try {
			await syncVault(this.app, this, mode);
			// Re-check after sync (server still up)
			await this.refreshHealth(true, false);
		} catch (e) {
			new Notice('Supermemory sync failed: ' + smMessage(e));
			this.paintStatusBar(this.lastHealth, false);
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
		this.settings.baseURL = normalizeBaseUrl(this.settings.baseURL);
		this.settings.syncIndex =
			this.settings.syncIndex && typeof this.settings.syncIndex === 'object'
				? this.settings.syncIndex
				: {};
		this.settings.debug = !!this.settings.debug;
		this.settings.autoSync = !!this.settings.autoSync;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		clearHealthCache();
	}

	private paintStatusBar(health: HealthState, syncing: boolean): void {
		if (!this.statusEl) return;
		const label = syncing ? 'Syncing…' : healthLabel(health);
		this.statusEl.setText(`SM · ${label}`);
		this.statusEl.removeClass('sm-bar-online', 'sm-bar-offline', 'sm-bar-warn', 'sm-bar-sync');
		if (syncing) this.statusEl.addClass('sm-bar-sync');
		else if (health.state === 'online') this.statusEl.addClass('sm-bar-online');
		else if (health.state === 'no-key' || health.state === 'invalid-key') this.statusEl.addClass('sm-bar-warn');
		else this.statusEl.addClass('sm-bar-offline');
		this.statusEl.title = `Supermemory Local — ${label}. Click to open hub.`;
	}
}
