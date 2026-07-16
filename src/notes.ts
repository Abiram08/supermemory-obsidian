/**
 * Vault → Supermemory document shaping.
 * Keeps paths/titles/dates in body + metadata so search can open notes.
 */

import { MAX_NOTE_CHARS, SM_SOURCE, sanitizeText } from './config';

const SAFE = /[^a-zA-Z0-9_:-]/g;

function slug(part: string, max = 60): string {
	return (
		part
			.toLowerCase()
			.replace(/[\s/\\]+/g, '_')
			.replace(SAFE, '_')
			.replace(/_+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, max) || 'untitled'
	);
}

export function containerTag(vaultName: string): string {
	return 'vault_' + slug(vaultName, 80);
}

export function topFolder(path: string): string {
	const i = path.indexOf('/');
	return i <= 0 ? 'root' : path.slice(0, i);
}

export async function fingerprint(text: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 16);
}

/** Steers extraction toward identity + evolving facts (not isolated chunks). */
export function entityContext(vaultName: string): string {
	return (
		`Obsidian personal knowledge vault "${vaultName}". ` +
		`Notes are the author's own writing: projects, research, decisions, preferences, and life context. ` +
		`Extract durable identity facts, preferences, tools/stack choices, project status, and how those change over time. ` +
		`Prefer entity-centric memories (who/what/when). Treat dated contradictions as updates, not duplicates.`
	).slice(0, 1500);
}

export function noteMeta(
	path: string,
	title: string,
	stat?: { mtime: number; ctime: number },
): Record<string, string | number | boolean> {
	const meta: Record<string, string | number | boolean> = {
		path,
		title,
		folder: topFolder(path),
		source: SM_SOURCE,
		sm_source: SM_SOURCE,
	};
	if (stat?.mtime != null) {
		meta.mtime = stat.mtime;
		meta.noteDate = new Date(stat.mtime).toISOString().slice(0, 10);
	}
	if (stat?.ctime != null) meta.ctime = stat.ctime;
	return meta;
}

export function noteBody(
	file: { basename: string; path: string; stat?: { mtime: number } },
	raw: string,
): string {
	const date =
		file.stat?.mtime != null ? `modified: ${new Date(file.stat.mtime).toISOString()}\n` : '';
	return `# ${file.basename}\n(path: ${file.path})\n${date}\n${sanitizeText(raw, MAX_NOTE_CHARS)}`;
}

export function customId(tag: string, path: string): string {
	return `obsidian:${tag}:${path}`;
}
