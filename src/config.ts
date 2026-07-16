/**
 * Plugin knobs, persisted settings, validation, and gated diagnostics.
 * Single place for anything that is not UI or network.
 */

export const PLUGIN_ID = 'obsidian-supermemory';
export const SM_SOURCE = 'obsidian';
export const DEFAULT_BASE_URL = 'http://localhost:6767';

export const REQUEST_TIMEOUT_MS = 60_000;
export const SYNC_BATCH_SIZE = 4;
export const SYNC_BATCH_GAP_MS = 1_200;
export const AUTO_SYNC_MS = 2_500;
export const SUGGEST_LIMIT = 5;
export const SUGGEST_MS = 800;
export const SEARCH_LIMIT = 12;
export const MAX_NOTE_CHARS = 100_000;

export interface NoteSyncEntry {
	hash: string;
	mtime: number;
}

export interface PluginSettings {
	baseURL: string;
	apiKey: string;
	lastSyncAt: number | null;
	lastProfileSnapshot: string | null;
	autoSync: boolean;
	debug: boolean;
	syncIndex: Record<string, NoteSyncEntry>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	baseURL: DEFAULT_BASE_URL,
	apiKey: '',
	lastSyncAt: null,
	lastProfileSnapshot: null,
	autoSync: false,
	debug: false,
	syncIndex: {},
};

export function normalizeBaseUrl(raw: string | null | undefined): string {
	if (!raw?.trim()) return DEFAULT_BASE_URL;
	const trimmed = raw.trim().replace(/\/+$/, '');
	try {
		const u = new URL(trimmed);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_BASE_URL;
		return trimmed;
	} catch {
		return DEFAULT_BASE_URL;
	}
}

export function isValidApiKey(key: string): { ok: true } | { ok: false; reason: string } {
	const k = key?.trim() ?? '';
	if (!k) return { ok: false, reason: 'API key is empty' };
	if (!k.startsWith('sm_')) return { ok: false, reason: 'API key must start with sm_' };
	if (k.length < 20) return { ok: false, reason: 'API key is too short' };
	if (/\s/.test(k)) return { ok: false, reason: 'API key contains whitespace' };
	return { ok: true };
}

export function sanitizeText(text: string, max = MAX_NOTE_CHARS): string {
	if (!text) return '';
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
		if (c === 0x7f || c === 0xfeff) continue;
		if (c >= 0xfff0) continue;
		out += text[i];
	}
	return out.length > max ? out.slice(0, max) + '\n\n…[truncated]' : out;
}

export function sanitizeMeta(
	meta: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	let n = 0;
	for (const [k, v] of Object.entries(meta)) {
		if (n >= 50 || k.length > 128 || /[^\w.-]/.test(k)) continue;
		if (typeof v === 'string') {
			out[k] = v.slice(0, 1024);
			n++;
		} else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') {
			out[k] = v;
			n++;
		}
	}
	return out;
}

// --- diagnostics (silent unless settings.debug) ---

let debugOn = false;

export function setDebug(on: boolean): void {
	debugOn = on;
}

export const smLog = {
	debug(msg: string, data?: unknown): void {
		if (!debugOn) return;
		window.console?.log(`[sm] ${msg}`, data ?? '');
	},
	warn(msg: string, data?: unknown): void {
		window.console?.warn(`[sm] ${msg}`, data ?? '');
	},
	error(msg: string, data?: unknown): void {
		window.console?.error(`[sm] ${msg}`, data ?? '');
	},
};
