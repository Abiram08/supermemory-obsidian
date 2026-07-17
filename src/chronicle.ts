/**
 * Topic chronicle — chronological story of a topic from hybrid search hits.
 * Peak Supermemory: time-ordered memory of a subject, written as a vault note.
 */

import { Notice, normalizePath, TFile } from 'obsidian';
import type SupermemoryPlugin from './main';
import { MemoryApi, hitPath, hitSnippet, hitText, hitTitle, smMessage } from './api';
import { containerTag } from './notes';

function dateIn(text: string): string | null {
	return text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
}

export async function writeTopicChronicle(
	plugin: SupermemoryPlugin,
	topic: string,
): Promise<boolean> {
	const q = topic.trim();
	if (q.length < 2) {
		new Notice('Enter a topic (e.g. database, tools, work).');
		return false;
	}
	if (!plugin.settings.apiKey) {
		new Notice('Supermemory: set API key first.');
		return false;
	}

	const notice = new Notice(`Building chronicle for “${q}”…`, 0);
	try {
		const api = MemoryApi.of(plugin.settings);
		const tag = containerTag(plugin.app.vault.getName());

		let res = await api.search({
			q,
			containerTag: tag,
			limit: 20,
			searchMode: 'memories',
			threshold: 0.3,
		});
		if (!res.results.length) {
			res = await api.search({
				q,
				containerTag: tag,
				limit: 20,
				searchMode: 'hybrid',
				threshold: 0.3,
			});
		}

		if (!res.results.length) {
			notice.hide();
			new Notice(`No notes/memories found for “${q}”. Sync the vault first.`);
			return false;
		}

		const rows = res.results
			.map((r) => {
				const body = hitText(r);
				const date =
					dateIn(body) ??
					(typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 10) : 'unknown');
				return {
					date,
					title: hitTitle(r),
					path: hitPath(r),
					snippet: hitSnippet(body).slice(0, 220),
					kind: typeof r.memory === 'string' && r.memory ? 'memory' : 'note',
				};
			})
			.sort((a, b) => a.date.localeCompare(b.date));

		const safeTopic = q.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
		const path = normalizePath(`Chronicles/${safeTopic}.md`);
		const folder = 'Chronicles';
		if (!plugin.app.vault.getAbstractFileByPath(folder)) {
			await plugin.app.vault.createFolder(folder);
		}

		const lines: string[] = [
			`# Chronicle: ${q}`,
			'',
			`> Generated from Supermemory Local · ${new Date().toISOString()}`,
			`> Space: \`${tag}\``,
			'',
			'A time-ordered story of this topic from your notes and memories.',
			'',
		];

		let lastDate = '';
		for (const row of rows) {
			if (row.date !== lastDate) {
				lines.push(`## ${row.date}`, '');
				lastDate = row.date;
			}
			const link = row.path
				? `[[${row.path.replace(/\.md$/i, '')}|${row.title}]]`
				: `**${row.title}**`;
			lines.push(`- (${row.kind}) ${link}`);
			if (row.snippet) lines.push(`  - ${row.snippet.replace(/\n/g, ' ')}`);
			lines.push('');
		}

		const body = lines.join('\n');
		const existing = plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await plugin.app.vault.modify(existing, body);
		} else {
			await plugin.app.vault.create(path, body);
		}

		notice.hide();
		new Notice(`Chronicle written: ${path}`);
		const file = plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await plugin.app.workspace.getLeaf(false).openFile(file);
		}
		return true;
	} catch (e) {
		notice.hide();
		new Notice('Chronicle failed: ' + smMessage(e));
		return false;
	}
}

/** Prompt for topic via Notice is weak — use simple window.prompt in Obsidian. */
export async function writeTopicChroniclePrompt(plugin: SupermemoryPlugin): Promise<boolean> {
	const topic = window.prompt('Chronicle topic (e.g. database, tools, running):', 'database');
	if (topic == null) return false;
	return writeTopicChronicle(plugin, topic);
}
