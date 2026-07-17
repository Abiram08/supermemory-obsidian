/**
 * Living Profile note — writes Supermemory profile into a real vault markdown file
 * so it participates in Obsidian's graph, embeds, and daily workflow.
 */

import { Notice, normalizePath, TFile } from 'obsidian';
import type SupermemoryPlugin from './main';
import { MemoryApi, smMessage, type ProfileReply } from './api';
import { containerTag } from './notes';

export const DEFAULT_PROFILE_NOTE = 'Meta/My memory profile.md';

export async function writeLivingProfileNote(
	plugin: SupermemoryPlugin,
	opts?: { open?: boolean },
): Promise<boolean> {
	if (!plugin.settings.apiKey) {
		new Notice('Supermemory: set API key first.');
		return false;
	}

	const path = normalizePath(plugin.settings.livingProfilePath || DEFAULT_PROFILE_NOTE);
	const notice = new Notice('Writing living profile note…', 0);

	try {
		const api = MemoryApi.of(plugin.settings);
		const tag = containerTag(plugin.app.vault.getName());
		const profile = await api.profile({ containerTag: tag, threshold: 0.4 });

		// If empty, try a soft hybrid assist for "related" section only
		let relatedTitles: string[] = [];
		const staticF = profile.profile?.static ?? [];
		const dynamicF = profile.profile?.dynamic ?? [];
		if (staticF.length === 0 && dynamicF.length === 0) {
			const search = await api.search({
				q: 'preferences decisions tools stack projects database goals',
				containerTag: tag,
				limit: 8,
				searchMode: 'hybrid',
				threshold: 0.3,
			});
			relatedTitles = (search.results ?? []).map((r) => {
				const t = r.metadata?.title;
				const p = r.metadata?.path;
				if (typeof t === 'string' && t) return t;
				if (typeof p === 'string' && p) return p;
				return (r.memory || r.chunk || 'note').slice(0, 80);
			});
		} else if (profile.searchResults?.results) {
			relatedTitles = profile.searchResults.results.map((r) => {
				const t = r.metadata?.title;
				return typeof t === 'string' ? t : (r.memory || '').slice(0, 80);
			}).filter(Boolean);
		}

		const body = renderProfileMarkdown(profile, {
			vault: plugin.app.vault.getName(),
			space: tag,
			relatedTitles,
		});

		const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (folder) {
			const parts = folder.split('/');
			let acc = '';
			for (const part of parts) {
				acc = acc ? `${acc}/${part}` : part;
				if (!plugin.app.vault.getAbstractFileByPath(acc)) {
					await plugin.app.vault.createFolder(acc);
				}
			}
		}

		const existing = plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await plugin.app.vault.modify(existing, body);
		} else {
			await plugin.app.vault.create(path, body);
		}

		notice.hide();
		new Notice(`Living profile updated: ${path}`);

		if (opts?.open !== false) {
			const file = plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await plugin.app.workspace.getLeaf(false).openFile(file);
			}
		}
		return true;
	} catch (e) {
		notice.hide();
		new Notice('Living profile failed: ' + smMessage(e));
		return false;
	}
}

function renderProfileMarkdown(
	profile: ProfileReply,
	meta: { vault: string; space: string; relatedTitles: string[] },
): string {
	const staticF = profile.profile?.static ?? [];
	const dynamicF = profile.profile?.dynamic ?? [];
	const now = new Date().toISOString();

	const lines: string[] = [
		'# My memory profile',
		'',
		'> Auto-generated from **Supermemory Local**. Do not hand-edit permanently — re-run **Update living profile note** to refresh.',
		'',
		`- **Vault:** ${meta.vault}`,
		`- **Space:** \`${meta.space}\``,
		`- **Updated:** ${now}`,
		'',
		'## Stable facts',
		'',
		'_Long-lived traits from your notes._',
		'',
	];

	if (staticF.length === 0) {
		lines.push('_No stable facts yet. Run **Build profile facts from notes**, then update this file again._');
		lines.push('');
	} else {
		for (const f of staticF) lines.push(`- ${f}`);
		lines.push('');
	}

	lines.push('## Current state', '', '_What is true now (may change)._', '');
	if (dynamicF.length === 0) {
		lines.push('_No dynamic facts yet._');
		lines.push('');
	} else {
		for (const f of dynamicF) lines.push(`- ${f}`);
		lines.push('');
	}

	if (meta.relatedTitles.length > 0) {
		lines.push('## Related notes', '');
		for (const t of meta.relatedTitles.slice(0, 12)) {
			// wikilink-friendly if title matches a note basename
			lines.push(`- [[${t.replace(/\.md$/i, '')}]]`);
		}
		lines.push('');
	}

	lines.push('## How to use', '');
	lines.push('- Link this note: `[[My memory profile]]`');
	lines.push('- Refresh: command **Update living profile note**');
	lines.push('- Timeline for a fact: open **Vault profile** → Show history');
	lines.push('');

	return lines.join('\n');
}
