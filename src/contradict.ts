/**
 * Contradict-as-you-type — soft warnings when writing conflicts with
 * Supermemory dynamic/static profile facts (temporal memory while writing).
 */

import { Editor, MarkdownView, Notice, debounce } from 'obsidian';
import type SupermemoryPlugin from './main';
import { MemoryApi, smMessage } from './api';
import { smLog } from './config';
import { containerTag } from './notes';

/** Pairs of terms that often conflict in tech/personal notes. */
const CONFLICT_PAIRS: Array<[string, string]> = [
	['postgres', 'sqlite'],
	['postgresql', 'sqlite'],
	['mysql', 'postgres'],
	['mysql', 'sqlite'],
	['react', 'vue'],
	['react', 'svelte'],
	['neovim', 'vscode'],
	['nvim', 'vscode'],
	['rust', 'golang'],
	['rust', 'go '],
	['typescript', 'javascript only'],
	['remote', 'local-first'],
	['cloud', 'fully offline'],
];

interface FactCache {
	at: number;
	static: string[];
	dynamic: string[];
}

const CACHE_MS = 60_000;
let cache: FactCache | null = null;
let lastWarnAt = 0;
let lastWarnKey = '';

export function clearContradictionCache(): void {
	cache = null;
}

async function loadFacts(plugin: SupermemoryPlugin): Promise<FactCache> {
	const now = Date.now();
	if (cache && now - cache.at < CACHE_MS) return cache;
	const api = MemoryApi.of(plugin.settings);
	const tag = containerTag(plugin.app.vault.getName());
	const profile = await api.profile({ containerTag: tag });
	cache = {
		at: now,
		static: profile.profile?.static ?? [],
		dynamic: profile.profile?.dynamic ?? [],
	};
	return cache;
}

function words(s: string): Set<string> {
	return new Set(
		s
			.toLowerCase()
			.replace(/[^a-z0-9+#.\s-]/g, ' ')
			.split(/\s+/)
			.filter((w) => w.length > 2),
	);
}

function findConflict(paragraph: string, facts: string[]): string | null {
	const p = paragraph.toLowerCase();
	const pWords = words(paragraph);
	if (pWords.size < 3) return null;

	for (const fact of facts) {
		const f = fact.toLowerCase();
		const fWords = words(fact);
		// topical overlap
		let overlap = 0;
		for (const w of fWords) {
			if (w.length < 4) continue;
			if (pWords.has(w)) overlap++;
		}
		if (overlap < 1) continue;

		// pair-based contradiction
		for (const [a, b] of CONFLICT_PAIRS) {
			const factHasA = f.includes(a);
			const factHasB = f.includes(b);
			const paraHasA = p.includes(a);
			const paraHasB = p.includes(b);
			if (factHasA && paraHasB && !paraHasA) {
				return `Your memory says: “${fact.slice(0, 160)}” — but you're writing about ${b}.`;
			}
			if (factHasB && paraHasA && !paraHasB) {
				return `Your memory says: “${fact.slice(0, 160)}” — but you're writing about ${a}.`;
			}
		}

		// negation of a distinctive multi-word fact chunk
		const distinctive = [...fWords].filter((w) => w.length > 5).slice(0, 4);
		if (distinctive.length >= 2) {
			const hits = distinctive.filter((w) => pWords.has(w)).length;
			if (hits >= 2 && /\b(not|never|no longer|don't|dont|stopped|instead of)\b/i.test(paragraph)) {
				return `Possible contradiction with memory: “${fact.slice(0, 160)}”`;
			}
		}
	}
	return null;
}

/**
 * Register editor listener. Returns cleanup via plugin.registerEvent pattern —
 * caller should use plugin.registerEvent / register for debounce cancel.
 */
export function attachContradictionWatcher(plugin: SupermemoryPlugin): void {
	const check = debounce(
		async (editor: Editor) => {
			if (!plugin.settings.contradictWhileTyping) return;
			if (!plugin.settings.apiKey) return;

			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) return;

			const text = editor.getValue();
			const para = lastParagraph(text);
			if (para.length < 20) return;

			try {
				const facts = await loadFacts(plugin);
				const all = [...facts.dynamic, ...facts.static];
				if (all.length === 0) return;

				const msg = findConflict(para, all);
				if (!msg) return;

				const key = msg.slice(0, 80);
				const now = Date.now();
				// Don't spam the same warning
				if (key === lastWarnKey && now - lastWarnAt < 45_000) return;
				lastWarnKey = key;
				lastWarnAt = now;

				new Notice(`Supermemory · ${msg}`, 8000);
			} catch (e) {
				smLog.debug('contradiction check failed', smMessage(e));
			}
		},
		2000,
		true,
	);

	plugin.registerEvent(
		plugin.app.workspace.on('editor-change', (editor: Editor) => {
			if (!plugin.settings.contradictWhileTyping) return;
			void check(editor);
		}),
	);
}

function lastParagraph(text: string): string {
	const t = text.trim();
	if (!t) return '';
	const parts = t.split(/\n\s*\n/).filter(Boolean);
	const last = parts[parts.length - 1] ?? t;
	return last.slice(-500);
}
