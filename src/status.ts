/**
 * Connection health + workflow readiness for Supermemory Local.
 * One cached check drives the status bar, home panel, and preflight gates.
 */

import { checkConnection } from './api';
import type { PluginSettings } from './config';
import { smLog } from './config';

export type HealthState =
	| { state: 'no-key' }
	| { state: 'invalid-key'; detail: string }
	| { state: 'offline'; detail?: string }
	| { state: 'online' }
	| { state: 'error'; detail?: string };

export type WorkflowStepId = 'server' | 'apikey' | 'connect' | 'sync' | 'use';

export interface WorkflowStep {
	id: WorkflowStepId;
	title: string;
	detail: string;
	done: boolean;
	current: boolean;
}

const CACHE_MS = 8_000;
let cache: { at: number; health: HealthState; key: string; base: string } | null = null;

export function clearHealthCache(): void {
	cache = null;
}

export async function checkHealth(
	settings: Pick<PluginSettings, 'apiKey' | 'baseURL'>,
	opts?: { force?: boolean },
): Promise<HealthState> {
	const force = opts?.force ?? false;
	const now = Date.now();
	if (
		!force &&
		cache &&
		now - cache.at < CACHE_MS &&
		cache.key === settings.apiKey &&
		cache.base === settings.baseURL
	) {
		return cache.health;
	}

	if (!settings.apiKey?.trim()) {
		const health: HealthState = { state: 'no-key' };
		cache = { at: now, health, key: settings.apiKey, base: settings.baseURL };
		return health;
	}

	const result = await checkConnection(settings);
	let health: HealthState;
	if (result.ok) health = { state: 'online' };
	else if (result.reason === 'no-api-key') health = { state: 'no-key' };
	else if (result.reason === 'invalid-key') {
		health = { state: 'invalid-key', detail: result.detail ?? 'Invalid API key' };
	} else if (result.reason === 'unreachable') {
		health = { state: 'offline', detail: result.detail };
	} else {
		health = { state: 'error', detail: result.detail };
	}

	cache = { at: now, health, key: settings.apiKey, base: settings.baseURL };
	smLog.debug('health', health);
	return health;
}

export function isOnline(h: HealthState): boolean {
	return h.state === 'online';
}

/** Human label for status bar / badges. */
export function healthLabel(h: HealthState): string {
	switch (h.state) {
		case 'online':
			return 'Connected';
		case 'no-key':
			return 'No API key';
		case 'invalid-key':
			return 'Bad API key';
		case 'offline':
			return 'Offline';
		case 'error':
			return 'Error';
	}
}

export function healthHint(h: HealthState): string {
	switch (h.state) {
		case 'online':
			return 'Supermemory Local is reachable.';
		case 'no-key':
			return 'Paste the sm_… key printed when you start supermemory-server.';
		case 'invalid-key':
			return h.detail || 'API key must look like sm_… from local server first boot.';
		case 'offline':
			return (
				h.detail ||
				"Supermemory Local isn't running. Start it with `supermemory-server` (default http://localhost:6767)."
			);
		case 'error':
			return h.detail || 'Could not reach Supermemory Local. Check URL and API key.';
	}
}

/**
 * Ordered setup → use workflow (matches Local quickstart + plugin product path).
 * 1. Server  2. API key  3. Connected  4. Synced  5. Search/profile
 */
export function workflowSteps(
	settings: PluginSettings,
	health: HealthState,
): WorkflowStep[] {
	const hasKey = !!settings.apiKey?.trim();
	const online = health.state === 'online';
	const synced = settings.lastSyncAt != null || Object.keys(settings.syncIndex ?? {}).length > 0;

	const base: Omit<WorkflowStep, 'current'>[] = [
		{
			id: 'server',
			title: '1. Run Supermemory Local',
			detail: 'Install and start: `npx supermemory local` or `supermemory-server` → http://localhost:6767',
			// Server step is "done" only when we can actually reach it (or we have never proven offline after a key).
			done: online,
		},
		{
			id: 'apikey',
			title: '2. Add API key',
			detail: 'Copy the sm_… token printed on first boot into plugin settings.',
			done: hasKey && health.state !== 'invalid-key' && health.state !== 'no-key',
		},
		{
			id: 'connect',
			title: '3. Connect',
			detail: 'Plugin talks only to your local base URL — nothing leaves the machine.',
			done: online,
		},
		{
			id: 'sync',
			title: '4. Sync vault',
			detail: 'Ingest notes as memory documents (incremental, stable customId).',
			done: online && synced,
		},
		{
			id: 'use',
			title: '5. Search · suggest · profile',
			detail: 'Semantic search, writing-time related notes, and auto-synthesized profile.',
			done: online && synced,
		},
	];

	const allDone = base.every((s) => s.done);
	let marked = false;
	return base.map((s) => {
		if (allDone) return { ...s, current: s.id === 'use' };
		const current = !marked && !s.done;
		if (current) marked = true;
		return { ...s, current };
	});
}

export function nextAction(
	settings: PluginSettings,
	health: HealthState,
): { label: string; action: 'settings' | 'sync' | 'search' | 'profile' | 'retry' } {
	if (health.state === 'no-key' || health.state === 'invalid-key') {
		return { label: 'Open settings', action: 'settings' };
	}
	if (health.state === 'offline' || health.state === 'error') {
		return { label: 'Retry connection', action: 'retry' };
	}
	const synced = settings.lastSyncAt != null || Object.keys(settings.syncIndex ?? {}).length > 0;
	if (!synced) return { label: 'Sync vault', action: 'sync' };
	return { label: 'Open search', action: 'search' };
}
