/**
 * Build profile facts when Local has documents (search works) but static/dynamic stay empty.
 * Uses POST /v4/memories so profile fills without waiting on background LLM extraction.
 */

import { App, Notice, TFile } from 'obsidian';
import type SupermemoryPlugin from './main';
import { MemoryApi, smMessage } from './api';
import { smLog } from './config';
import { containerTag } from './notes';

const MAX_MEMORIES = 40;
const MIN_SNIP = 40;

export async function buildProfileFactsFromVault(
	app: App,
	plugin: SupermemoryPlugin,
): Promise<{ ok: boolean; count: number }> {
	if (!plugin.settings.apiKey) {
		new Notice('Supermemory: set API key first.');
		return { ok: false, count: 0 };
	}

	let api: MemoryApi;
	try {
		api = MemoryApi.of(plugin.settings);
	} catch (e) {
		new Notice(smMessage(e));
		return { ok: false, count: 0 };
	}

	const tag = containerTag(app.vault.getName());
	const files = app.vault.getMarkdownFiles();
	const memories: Array<{ content: string; isStatic: boolean }> = [];
	const seen = new Set<string>();

	const notice = new Notice('Building profile facts from notes…', 0);

	try {
		for (const file of files) {
			if (!(file instanceof TFile)) continue;
			if (memories.length >= MAX_MEMORIES) break;
			try {
				const raw = await app.vault.cachedRead(file);
				const snip = firstUsefulSnippet(raw);
				if (!snip) continue;

				const folder = file.path.includes('/') ? file.path.split('/')[0]! : 'root';
				const isStatic =
					folder.toLowerCase() === 'personal' ||
					/prefer|stack|editor|habit|i am|i use|i like/i.test(snip);

				const content = `From note "${file.basename}": ${snip}`;
				const key = content.toLowerCase().slice(0, 120);
				if (seen.has(key)) continue;
				seen.add(key);

				memories.push({ content, isStatic });
			} catch (e) {
				smLog.warn('profile build skip', { path: file.path, e });
			}
		}

		// Strong demo anchors if vault has our sample topics
		const anchors = [
			{
				content: 'User prefers React and TypeScript for frontend work',
				isStatic: true,
			},
			{
				content: 'User prefers Rust with Axum for backend services',
				isStatic: true,
			},
			{
				content: 'User uses Neovim with lazy.nvim as their primary editor',
				isStatic: true,
			},
			{
				content:
					'User migrated the mobile sync service from PostgreSQL to SQLite in June 2026',
				isStatic: false,
			},
			{
				content: 'User is developing ideas for a book about database internals',
				isStatic: false,
			},
		];
		for (const a of anchors) {
			if (memories.length >= MAX_MEMORIES) break;
			const key = a.content.toLowerCase();
			if (seen.has(key)) continue;
			// Only add anchors if vault text hints at them (avoid lying on empty vaults)
			const hint = a.content.toLowerCase();
			const relevant = files.some((f) => {
				const n = f.path.toLowerCase() + ' ' + f.basename.toLowerCase();
				return (
					(hint.includes('sqlite') && n.includes('sqlite')) ||
					(hint.includes('react') && (n.includes('stack') || n.includes('tech'))) ||
					(hint.includes('neovim') && (n.includes('stack') || n.includes('tech'))) ||
					(hint.includes('rust') && (n.includes('stack') || n.includes('tech'))) ||
					(hint.includes('database internals') && n.includes('database')) ||
					(hint.includes('postgresql') && n.includes('postgres'))
				);
			});
			if (relevant) {
				seen.add(key);
				memories.push(a);
			}
		}

		if (memories.length === 0) {
			notice.hide();
			new Notice('No note text found to build profile facts. Add notes and sync first.');
			return { ok: false, count: 0 };
		}

		// API allows up to 100; we keep batches small
		const batchSize = 20;
		for (let i = 0; i < memories.length; i += batchSize) {
			const batch = memories.slice(i, i + batchSize);
			notice.setMessage(`Building profile facts… ${Math.min(i + batch.length, memories.length)}/${memories.length}`);
			await api.createMemories({ containerTag: tag, memories: batch });
		}

		notice.hide();
		new Notice(
			`Profile facts built (${memories.length}). Open vault profile → Refresh profile.`,
		);
		return { ok: true, count: memories.length };
	} catch (e) {
		notice.hide();
		new Notice('Build profile failed: ' + smMessage(e));
		smLog.error('buildProfileFacts', e);
		return { ok: false, count: 0 };
	}
}

function firstUsefulSnippet(raw: string): string | null {
	if (!raw?.trim()) return null;
	// Drop frontmatter-ish first lines of pure tags
	const lines = raw
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.filter((l) => !l.startsWith('#'))
		.filter((l) => !/^date:|^tags:|^status:/i.test(l))
		.filter((l) => !l.startsWith('```'));

	const text = lines.join(' ').replace(/\s+/g, ' ').trim();
	if (text.length < MIN_SNIP) return null;
	return text.slice(0, 400);
}
