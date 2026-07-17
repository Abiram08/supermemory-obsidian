/**
 * Local Supermemory transport.
 * Obsidian's requestUrl (CORS-safe) — not the Node SDK.
 */

import { requestUrl } from 'obsidian';
import {
	DEFAULT_BASE_URL,
	REQUEST_TIMEOUT_MS,
	SM_SOURCE,
	isValidApiKey,
	normalizeBaseUrl,
	sanitizeMeta,
	sanitizeText,
	smLog,
	type PluginSettings,
} from './config';

export type SmKind =
	| 'unreachable'
	| 'auth'
	| 'bad-request'
	| 'not-found'
	| 'rate-limit'
	| 'server'
	| 'timeout'
	| 'unknown';

export class SmError extends Error {
	constructor(
		message: string,
		public readonly kind: SmKind,
		public readonly status?: number,
	) {
		super(message);
		this.name = 'SmError';
	}
}

export function smMessage(err: unknown): string {
	if (err instanceof SmError) {
		switch (err.kind) {
			case 'auth':
				return 'Authentication failed — check your sm_… API key in plugin settings.';
			case 'rate-limit':
				return 'Rate limited — wait a moment and try again.';
			case 'server':
				return 'Supermemory is temporarily unavailable. Try again shortly.';
			case 'timeout':
				return err.message;
			case 'unreachable':
				return err.message;
			default:
				return err.message || 'Unknown supermemory error.';
		}
	}
	return err instanceof Error ? err.message : String(err);
}

export function isUnreachable(err: unknown): boolean {
	return err instanceof SmError && (err.kind === 'unreachable' || err.kind === 'timeout');
}

export interface SearchHit {
	id?: string;
	memory?: string;
	chunk?: string;
	content?: string;
	similarity?: number;
	score?: number;
	metadata?: Record<string, unknown> | null;
	updatedAt?: string;
	title?: string;
}

export interface SearchReply {
	results: SearchHit[];
	timing?: number;
	total?: number;
}

export interface ProfileReply {
	profile?: { static?: string[]; dynamic?: string[]; buckets?: Record<string, string[]> };
	searchResults?: SearchReply;
}

export interface BatchDoc {
	content: string;
	customId?: string;
	metadata?: Record<string, string | number | boolean>;
}

type Json = Record<string, unknown>;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function uniqBy<T>(items: T[], keyOf: (t: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const k = keyOf(item).toLowerCase().trim();
		if (!k || seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

export class MemoryApi {
	private readonly key: string;
	private readonly base: string;

	constructor(settings: Pick<PluginSettings, 'apiKey' | 'baseURL'>) {
		const check = isValidApiKey(settings.apiKey);
		if (!check.ok) throw new SmError(check.reason, 'auth');
		this.key = settings.apiKey.trim();
		this.base = normalizeBaseUrl(settings.baseURL || DEFAULT_BASE_URL);
	}

	static of(settings: Pick<PluginSettings, 'apiKey' | 'baseURL'>): MemoryApi {
		return new MemoryApi(settings);
	}

	async ping(): Promise<
		{ ok: true } | { ok: false; reason: 'no-api-key' | 'invalid-key' | 'unreachable' | 'error'; detail?: string }
	> {
		if (!this.key) return { ok: false, reason: 'no-api-key' };
		try {
			// Local validates q min length 1 after trim — a space alone returns 400.
			await this.post('/v4/search', { q: 'ping', containerTag: 'connection_test', limit: 1 });
			return { ok: true };
		} catch (e) {
			if (isUnreachable(e)) return { ok: false, reason: 'unreachable', detail: smMessage(e) };
			if (e instanceof SmError && e.kind === 'auth') {
				return { ok: false, reason: 'error', detail: 'Invalid or rejected API key.' };
			}
			return { ok: false, reason: 'error', detail: smMessage(e) };
		}
	}

	async addNote(p: {
		content: string;
		containerTag: string;
		customId?: string;
		metadata?: Record<string, string | number | boolean>;
		entityContext?: string;
	}): Promise<void> {
		await this.post('/v3/documents', {
			content: sanitizeText(p.content),
			containerTag: p.containerTag,
			taskType: 'memory',
			dreaming: 'dynamic',
			metadata: sanitizeMeta({ sm_source: SM_SOURCE, ...(p.metadata ?? {}) }),
			...(p.customId ? { customId: p.customId } : {}),
			...(p.entityContext ? { entityContext: p.entityContext } : {}),
		});
	}

	async addBatch(p: {
		documents: BatchDoc[];
		containerTag: string;
		entityContext?: string;
	}): Promise<{ results: Array<{ id: string; status: string; error?: string }>; failed: number; success: number }> {
		return (await this.post('/v3/documents/batch', {
			containerTag: p.containerTag,
			taskType: 'memory',
			dreaming: 'dynamic',
			...(p.entityContext ? { entityContext: p.entityContext } : {}),
			documents: p.documents.map((d) => ({
				content: sanitizeText(d.content),
				...(d.customId ? { customId: d.customId } : {}),
				metadata: sanitizeMeta({ sm_source: SM_SOURCE, ...(d.metadata ?? {}) }),
			})),
		})) as {
			results: Array<{ id: string; status: string; error?: string }>;
			failed: number;
			success: number;
		};
	}

	async search(p: {
		q: string;
		containerTag: string;
		limit?: number;
		searchMode?: 'hybrid' | 'memories';
		rerank?: boolean;
		threshold?: number;
		/** Supermemory metadata filters, e.g. folder scope */
		filters?: Record<string, unknown>;
		/** If set, also filter results client-side by metadata.folder (fallback if server ignores filters). */
		folder?: string | null;
	}): Promise<SearchReply> {
		const body: Record<string, unknown> = {
			q: p.q,
			containerTag: p.containerTag,
			...(p.limit != null ? { limit: p.limit } : {}),
			...(p.searchMode ? { searchMode: p.searchMode } : {}),
			...(p.rerank ? { rerank: true } : {}),
			...(p.threshold != null ? { threshold: p.threshold } : {}),
		};
		if (p.filters) body.filters = p.filters;
		else if (p.folder && p.folder !== 'all') {
			// Scope hybrid search to notes synced with metadata.folder
			body.filters = {
				AND: [{ key: 'folder', value: p.folder }],
			};
		}

		const raw = (await this.post('/v4/search', body)) as SearchReply;
		let results = uniqBy(raw?.results ?? [], (r) => hitText(r) || r.id || '');

		// Client-side safety net — Local may not always apply filters the same way as cloud
		if (p.folder && p.folder !== 'all') {
			const folder = p.folder;
			const filtered = results.filter((r) => {
				const f = r.metadata?.folder;
				if (typeof f === 'string' && f.length > 0) return f === folder;
				// Infer from path if metadata missing
				const path = typeof r.metadata?.path === 'string' ? r.metadata.path : null;
				if (path) {
					const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : 'root';
					return top === folder;
				}
				// Keep memory-only hits without path when filtering (they may still be relevant)
				return typeof r.memory === 'string' && r.memory.length > 0;
			});
			// If server already filtered well, filtered ≈ results; if server ignored filters, use filtered
			if (filtered.length > 0 || results.length === 0) results = filtered;
		}

		return { results, timing: raw?.timing, total: results.length };
	}

	/**
	 * Create memories directly (fills profile static/dynamic).
	 * Use when Local indexed documents for search but LLM extraction left profile empty.
	 */
	async createMemories(p: {
		containerTag: string;
		memories: Array<{ content: string; isStatic?: boolean }>;
	}): Promise<unknown> {
		return this.post('/v4/memories', {
			containerTag: p.containerTag,
			memories: p.memories.map((m) => ({
				content: m.content.slice(0, 10_000),
				isStatic: m.isStatic ?? false,
			})),
		});
	}

	async profile(p: { containerTag: string; q?: string; threshold?: number }): Promise<ProfileReply> {
		const raw = (await this.post('/v4/profile', {
			containerTag: p.containerTag,
			...(p.q ? { q: p.q } : {}),
			...(p.threshold != null ? { threshold: p.threshold } : {}),
		})) as ProfileReply;

		const seen = new Set<string>();
		const take = (xs: string[]) =>
			xs.filter((x) => {
				const k = x.toLowerCase().trim();
				if (!k || seen.has(k)) return false;
				seen.add(k);
				return true;
			});

		let searchResults = raw?.searchResults;
		if (searchResults?.results) {
			searchResults = {
				...searchResults,
				results: uniqBy(searchResults.results, (r) => hitText(r) || r.id || ''),
			};
		}

		return {
			profile: {
				static: take(raw?.profile?.static ?? []),
				dynamic: take(raw?.profile?.dynamic ?? []),
				buckets: raw?.profile?.buckets,
			},
			searchResults,
		};
	}

	private async post(path: string, body: Json, retries = 3): Promise<unknown> {
		const url = this.base + (path.startsWith('/') ? path : `/${path}`);
		let attempt = 0;

		while (true) {
			try {
				const res = await this.timedRequest(url, body);
				if (res.status >= 200 && res.status < 300) return res.json;

				if (res.status === 429 && attempt < retries) {
					attempt++;
					await wait(Math.min(30_000, 1000 * 2 ** attempt));
					continue;
				}

				const msg = this.errText(res);
				if (res.status === 401 || res.status === 403) throw new SmError(msg, 'auth', res.status);
				if (res.status === 404) throw new SmError(msg, 'not-found', res.status);
				if (res.status === 400) throw new SmError(msg, 'bad-request', res.status);
				if (res.status === 429) throw new SmError(msg, 'rate-limit', res.status);
				throw new SmError(msg, 'server', res.status);
			} catch (e) {
				if (e instanceof SmError) throw e;
				const msg = (e as Error)?.message ?? String(e);
				if (/timeout|timed? ?out|aborted/i.test(msg)) {
					throw new SmError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms.`, 'timeout');
				}
				if (/ECONN|fetch failed|Failed to fetch|NetworkError|ERR_|net::|status 0/i.test(msg)) {
					throw new SmError(
						`Supermemory local isn't reachable at ${url}. Start it with \`supermemory-server\` and reload.`,
						'unreachable',
					);
				}
				smLog.error('request failed', msg);
				throw new SmError(msg, 'unknown');
			}
		}
	}

	private timedRequest(url: string, body: Json) {
		const work = requestUrl({
			url,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.key}`,
				'Content-Type': 'application/json',
				'x-sm-source': SM_SOURCE,
			},
			body: JSON.stringify(body),
			throw: false,
		});
		const timeout = new Promise<never>((_, reject) => {
			window.setTimeout(() => reject(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
		});
		return Promise.race([work, timeout]);
	}

	private errText(res: { status: number; json: unknown; text: string }): string {
		try {
			let raw: unknown = res.json;
			if (typeof raw === 'string') {
				raw = JSON.parse(raw) as unknown;
			}
			if (raw && typeof raw === 'object') {
				const o = raw as Json;
				if (typeof o.message === 'string') return o.message;
				if (typeof o.error === 'string') return o.error;
			}
		} catch {
			if (res.text) return res.text;
		}
		return `Supermemory responded with ${res.status}.`;
	}
}

// --- hit presentation ---

export function hitText(h: SearchHit): string {
	return h.memory || h.chunk || h.content || '';
}

export function isMemoryHit(h: SearchHit): boolean {
	return typeof h.memory === 'string' && h.memory.length > 0;
}

export function hitSnippet(text: string): string {
	return text
		.replace(/^#\s+.*\n?/, '')
		.replace(/\(path:\s*[^)]+\)\s*\n?/, '')
		.replace(/^modified:\s*[^\n]+\n?/, '')
		.replace(/^[\s\n]+/, '')
		.slice(0, 500);
}

export function hitPath(h: SearchHit): string | null {
	const p = h.metadata?.path;
	if (typeof p === 'string' && p) return p;
	const m = hitText(h).match(/\(path:\s*([^\n)]+)\)/);
	return m?.[1]?.trim() ?? null;
}

export function hitTitle(h: SearchHit): string {
	const t = h.metadata?.title;
	if (typeof t === 'string' && t) return t;
	if (h.title) return h.title;
	if (isMemoryHit(h)) {
		const mem = h.memory!;
		return mem.length > 80 ? mem.slice(0, 77) + '…' : mem;
	}
	const line = hitText(h).split('\n')[0] ?? '';
	const m = line.match(/^#\s*(.+)$/);
	if (m?.[1]) return m[1].trim();
	return hitPath(h) ?? 'Untitled';
}

export function hitScore(h: SearchHit): number | null {
	if (typeof h.similarity === 'number') return h.similarity;
	if (typeof h.score === 'number') return h.score;
	return null;
}

export async function checkConnection(
	settings: Pick<PluginSettings, 'apiKey' | 'baseURL'>,
): Promise<
	{ ok: true } | { ok: false; reason: 'no-api-key' | 'invalid-key' | 'unreachable' | 'error'; detail?: string }
> {
	if (!settings.apiKey) return { ok: false, reason: 'no-api-key' };
	const fmt = isValidApiKey(settings.apiKey);
	if (!fmt.ok) return { ok: false, reason: 'invalid-key', detail: fmt.reason };
	try {
		return await MemoryApi.of(settings).ping();
	} catch (e) {
		return { ok: false, reason: 'error', detail: smMessage(e) };
	}
}
