/**
 * Memory intake: vault markdown → Supermemory documents.
 * Incremental (content hash), batched, cancelable, single-flight.
 */

import { App, Notice, TFile } from 'obsidian';
import type SupermemoryPlugin from './main';
import { MemoryApi, isUnreachable, smMessage, type BatchDoc } from './api';
import { SYNC_BATCH_GAP_MS, SYNC_BATCH_SIZE, smLog, type NoteSyncEntry } from './config';
import { containerTag, customId, entityContext, fingerprint, noteBody, noteMeta } from './notes';

export type SyncMode = 'incremental' | 'full';

export interface SyncResult {
	ok: boolean;
	synced: number;
	skipped: number;
	failed: number;
	cancelled: boolean;
}

interface Job {
	file: TFile;
	hash: string;
	doc: BatchDoc;
}

let flight: { cancel: boolean } | null = null;

export const syncBusy = () => flight !== null;

export function cancelSync(): boolean {
	if (!flight) return false;
	flight.cancel = true;
	return true;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export async function syncVault(
	app: App,
	plugin: SupermemoryPlugin,
	mode: SyncMode = 'incremental',
): Promise<SyncResult> {
	if (flight) {
		new Notice('Supermemory: a sync is already running. Use "cancel sync" or wait.');
		return zero(false);
	}
	if (!plugin.settings.apiKey) {
		new Notice('Supermemory: no API key set. Open plugin settings first.');
		return zero(false);
	}

	let api: MemoryApi;
	try {
		api = MemoryApi.of(plugin.settings);
	} catch (e) {
		new Notice(smMessage(e));
		return zero(false);
	}

	const run = { cancel: false };
	flight = run;

	const tag = containerTag(app.vault.getName());
	const ctx = entityContext(app.vault.getName());
	const files = app.vault.getMarkdownFiles();
	if (files.length === 0) {
		flight = null;
		new Notice('Supermemory: vault has no notes to sync.');
		return { ok: true, synced: 0, skipped: 0, failed: 0, cancelled: false };
	}

	const index: Record<string, NoteSyncEntry> = { ...(plugin.settings.syncIndex ?? {}) };
	let synced = 0;
	let skipped = 0;
	let failed = 0;
	const notice = new Notice(`Supermemory sync: preparing ${files.length} notes…`, 0);

	try {
		const queue: Job[] = [];
		for (let i = 0; i < files.length; i++) {
			if (run.cancel) break;
			const file = files[i];
			if (!(file instanceof TFile)) continue;
			try {
				const raw = await app.vault.cachedRead(file);
				if (!raw?.trim()) {
					skipped++;
					continue;
				}
				const content = noteBody(file, raw);
				const hash = await fingerprint(content);
				if (mode === 'incremental' && index[file.path]?.hash === hash) {
					skipped++;
					continue;
				}
				queue.push({
					file,
					hash,
					doc: {
						content,
						customId: customId(tag, file.path),
						metadata: noteMeta(file.path, file.basename, file.stat),
					},
				});
			} catch (e) {
				failed++;
				smLog.error('prepare failed', { path: file.path, e });
			}
			if (i % 40 === 0 || i === files.length - 1) {
				notice.setMessage(
					`Supermemory sync: scanning ${i + 1}/${files.length} · ${queue.length} to send · ${skipped} unchanged…`,
				);
			}
		}

		if (run.cancel) {
			notice.hide();
			new Notice(`Supermemory: sync cancelled. ${synced} sent, ${skipped} skipped.`);
			return { ok: false, synced, skipped, failed, cancelled: true };
		}

		if (queue.length === 0) {
			notice.hide();
			await saveIndex(plugin, index);
			new Notice(
				`Supermemory: nothing to sync — all ${skipped} note${skipped === 1 ? '' : 's'} already up to date.`,
			);
			return { ok: true, synced: 0, skipped, failed, cancelled: false };
		}

		const batches = Math.ceil(queue.length / SYNC_BATCH_SIZE);
		for (let b = 0; b < batches; b++) {
			if (run.cancel) break;
			const slice = queue.slice(b * SYNC_BATCH_SIZE, (b + 1) * SYNC_BATCH_SIZE);
			notice.setMessage(
				`Supermemory sync: batch ${b + 1}/${batches} · ${synced}/${queue.length} sent · ${skipped} skipped…`,
			);

			const out = await flushBatch(api, slice, tag, ctx, index);
			synced += out.synced;
			failed += out.failed;
			if (out.dead) {
				notice.hide();
				new Notice("Supermemory local isn't running — start it with `supermemory-server` and reload.");
				await saveIndex(plugin, index);
				return { ok: false, synced, skipped, failed, cancelled: false };
			}

			if (b > 0 && b % 5 === 0) {
				plugin.settings.syncIndex = { ...index };
				await plugin.saveSettings();
			}
			if (b < batches - 1 && !run.cancel) await sleep(SYNC_BATCH_GAP_MS);
		}

		const live = new Set(files.map((f) => f.path));
		for (const p of Object.keys(index)) {
			if (!live.has(p)) delete index[p];
		}
		await saveIndex(plugin, index);
		notice.hide();

		if (run.cancel) {
			new Notice(`Supermemory: sync cancelled. ${synced} sent, ${skipped} skipped, ${failed} failed.`);
			return { ok: false, synced, skipped, failed, cancelled: true };
		}

		new Notice(
			failed === 0
				? `Supermemory: synced ${synced} note${synced === 1 ? '' : 's'}` +
					(skipped ? `, skipped ${skipped} unchanged` : '') +
					'.'
				: `Supermemory: synced ${synced}, skipped ${skipped}, failed ${failed}. Check the console.`,
		);
		return { ok: failed === 0, synced, skipped, failed, cancelled: false };
	} finally {
		flight = null;
	}
}

export async function syncOne(app: App, plugin: SupermemoryPlugin, file: TFile): Promise<boolean> {
	if (flight || !plugin.settings.apiKey) return false;
	let api: MemoryApi;
	try {
		api = MemoryApi.of(plugin.settings);
	} catch {
		return false;
	}

	const tag = containerTag(app.vault.getName());
	try {
		const raw = await app.vault.cachedRead(file);
		if (!raw?.trim()) return true;
		const content = noteBody(file, raw);
		const hash = await fingerprint(content);
		if (plugin.settings.syncIndex?.[file.path]?.hash === hash) return true;

		await api.addNote({
			content,
			containerTag: tag,
			customId: customId(tag, file.path),
			metadata: noteMeta(file.path, file.basename, file.stat),
			entityContext: entityContext(app.vault.getName()),
		});

		plugin.settings.syncIndex ??= {};
		plugin.settings.syncIndex[file.path] = { hash, mtime: file.stat.mtime };
		plugin.settings.lastSyncAt = Date.now();
		await plugin.saveSettings();
		return true;
	} catch (e) {
		if (isUnreachable(e)) {
			smLog.warn('auto-sync: server unreachable');
			return false;
		}
		smLog.error('auto-sync failed', { path: file.path, err: smMessage(e) });
		return false;
	}
}

function zero(ok: boolean): SyncResult {
	return { ok, synced: 0, skipped: 0, failed: 0, cancelled: false };
}

async function saveIndex(plugin: SupermemoryPlugin, index: Record<string, NoteSyncEntry>): Promise<void> {
	plugin.settings.syncIndex = index;
	plugin.settings.lastSyncAt = Date.now();
	await plugin.saveSettings();
}

async function flushBatch(
	api: MemoryApi,
	slice: Job[],
	tag: string,
	ctx: string,
	index: Record<string, NoteSyncEntry>,
): Promise<{ synced: number; failed: number; dead: boolean }> {
	let synced = 0;
	let failed = 0;

	const markOk = (j: Job) => {
		synced++;
		index[j.file.path] = { hash: j.hash, mtime: j.file.stat.mtime };
	};

	try {
		const res = await api.addBatch({
			documents: slice.map((j) => j.doc),
			containerTag: tag,
			entityContext: ctx,
		});
		const rows = res?.results ?? [];
		if (rows.length === 0) {
			if ((res?.failed ?? 0) === 0) slice.forEach(markOk);
			else {
				failed += slice.length;
				smLog.error('batch failed without detail', res);
			}
			return { synced, failed, dead: false };
		}
		for (let i = 0; i < slice.length; i++) {
			const j = slice[i]!;
			const r = rows[i];
			if (r && (r.status === 'error' || r.error)) {
				failed++;
				smLog.error('batch item failed', { path: j.file.path, err: r.error ?? r.status });
			} else markOk(j);
		}
		return { synced, failed, dead: false };
	} catch (e) {
		if (isUnreachable(e)) return { synced, failed, dead: true };

		smLog.warn('batch unavailable, single-add fallback', smMessage(e));
		for (const j of slice) {
			try {
				await api.addNote({
					content: j.doc.content,
					containerTag: tag,
					customId: j.doc.customId,
					metadata: j.doc.metadata,
					entityContext: ctx,
				});
				markOk(j);
			} catch (err) {
				failed++;
				smLog.error('single add failed', { path: j.file.path, err: smMessage(err) });
				if (isUnreachable(err)) return { synced, failed, dead: true };
			}
		}
		return { synced, failed, dead: false };
	}
}
