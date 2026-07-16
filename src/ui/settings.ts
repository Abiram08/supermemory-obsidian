import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SupermemoryPlugin from '../main';
import { checkConnection } from '../api';
import { DEFAULT_BASE_URL, isValidApiKey, normalizeBaseUrl, setDebug } from '../config';
import { clearHealthCache, healthHint, type HealthState } from '../status';

export class SettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SupermemoryPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): { id: string; name: string }[] {
		return [
			{ id: 'base-url', name: 'Supermemory local URL' },
			{ id: 'api-key', name: 'API key' },
			{ id: 'auto-sync', name: 'Auto-sync on edit' },
			{ id: 'debug', name: 'Debug logging' },
			{ id: 'last-sync', name: 'Last sync' },
			{ id: 'clear-sync-index', name: 'Clear sync index' },
			{ id: 'reset-snapshot', name: 'Reset profile snapshot' },
		];
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Supermemory local')
			.setDesc(
				'This plugin only talks to a supermemory process on your machine (default http://localhost:6767). Start the server first, then paste the sm_… key from first boot.',
			)
			.setHeading();

		// Guided setup strip
		const guide = containerEl.createDiv({ cls: 'sm-settings-guide' });
		guide.createEl('strong', { text: 'Setup' });
		guide.createEl('ol', {}, (ol) => {
			ol.createEl('li', {
				text: 'Install/run Local: npx supermemory local  (or supermemory-server)',
			});
			ol.createEl('li', { text: 'Copy the sm_… API key printed on first boot' });
			ol.createEl('li', { text: 'Paste it below → Test connection' });
			ol.createEl('li', { text: 'Command palette: Sync vault to supermemory' });
			ol.createEl('li', { text: 'Open hub / search / profile from the ribbon' });
		});

		new Setting(containerEl)
			.setName('Supermemory local URL')
			.setDesc(`Where supermemory-server is running. Default: ${DEFAULT_BASE_URL}`)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_BASE_URL)
					.setValue(s.baseURL)
					.onChange(async (v) => {
						s.baseURL = normalizeBaseUrl(v);
						clearHealthCache();
						await this.plugin.saveSettings();
					}),
			);

		const key = new Setting(containerEl)
			.setName('API key')
			.setDesc('Bearer token from supermemory-server first boot (sm_…).')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setPlaceholder('sm_...')
					.setValue(s.apiKey)
					.onChange(async (v) => {
						s.apiKey = v.trim();
						clearHealthCache();
						await this.plugin.saveSettings();
					});
			});

		key.addButton((btn) =>
			btn.setButtonText('Test connection').onClick(async () => {
				btn.setButtonText('Testing…');
				btn.setDisabled(true);
				if (s.apiKey) {
					const fmt = isValidApiKey(s.apiKey);
					if (!fmt.ok) {
						btn.setButtonText('Test connection');
						btn.setDisabled(false);
						new Notice(`Invalid API key: ${fmt.reason}`);
						return;
					}
				}
				clearHealthCache();
				const r = await checkConnection(s);
				btn.setButtonText('Test connection');
				btn.setDisabled(false);

				let health: HealthState;
				if (r.ok) health = { state: 'online' };
				else if (r.reason === 'no-api-key') health = { state: 'no-key' };
				else if (r.reason === 'invalid-key') {
					health = { state: 'invalid-key', detail: r.detail ?? 'Invalid API key' };
				} else if (r.reason === 'unreachable') {
					health = { state: 'offline', detail: r.detail };
				} else health = { state: 'error', detail: r.detail };

				this.plugin.setConnectionState(health);
				new Notice(r.ok ? 'Supermemory Local is connected.' : healthHint(health));
			}),
		);

		new Setting(containerEl)
			.setName('Auto-sync on edit')
			.setDesc(
				'When connected, re-ingest a note after you edit it (debounced). Keeps memory current without full vault sync.',
			)
			.addToggle((t) =>
				t.setValue(s.autoSync).onChange(async (v) => {
					s.autoSync = v;
					await this.plugin.saveSettings();
					new Notice(v ? 'Auto-sync enabled.' : 'Auto-sync disabled.');
				}),
			);

		new Setting(containerEl)
			.setName('Debug logging')
			.setDesc('Write detailed supermemory logs to the developer console (Ctrl+Shift+I).')
			.addToggle((t) =>
				t.setValue(s.debug).onChange(async (v) => {
					s.debug = v;
					setDebug(v);
					await this.plugin.saveSettings();
				}),
			);

		const n = Object.keys(s.syncIndex ?? {}).length;
		new Setting(containerEl)
			.setName('Last sync')
			.setDesc(
				s.lastSyncAt
					? `${new Date(s.lastSyncAt).toLocaleString()} · ${n} note${n === 1 ? '' : 's'} indexed`
					: 'Vault has not been synced yet.',
			);

		new Setting(containerEl)
			.setName('Clear sync index')
			.setDesc(
				'Forget local fingerprints. Next sync re-sends every note (customId still upserts — no duplicates).',
			)
			.addButton((b) =>
				b.setButtonText('Clear index').onClick(async () => {
					s.syncIndex = {};
					await this.plugin.saveSettings();
					this.display();
					new Notice('Sync index cleared. Next sync will re-send all notes.');
				}),
			);

		new Setting(containerEl)
			.setName('Reset profile snapshot')
			.setDesc('Clear the stored profile snapshot used for before/after comparison.')
			.addButton((b) =>
				b
					.setButtonText('Clear snapshot')
					.setDisabled(s.lastProfileSnapshot === null)
					.onClick(async () => {
						s.lastProfileSnapshot = null;
						await this.plugin.saveSettings();
						this.display();
						new Notice('Profile snapshot cleared.');
					}),
			);
	}
}
