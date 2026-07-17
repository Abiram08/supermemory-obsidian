/**
 * Peak Supermemory feature: save selected text (or active note snippet)
 * as an explicit memory in Local — same idea as agent "remember this".
 */

import { MarkdownView, Notice } from 'obsidian';
import type SupermemoryPlugin from './main';
import { MemoryApi, smMessage } from './api';
import { containerTag } from './notes';

export async function rememberSelection(
	plugin: SupermemoryPlugin,
	opts?: { asStatic?: boolean },
): Promise<boolean> {
	if (!plugin.settings.apiKey) {
		new Notice('Supermemory: set API key first.');
		return false;
	}

	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view?.file) {
		new Notice('Open a markdown note and select text to remember.');
		return false;
	}

	const selected = view.editor.getSelection().trim();
	const fallback = view.editor.getValue().trim().slice(0, 500);
	const text = selected.length >= 8 ? selected : fallback;
	if (text.length < 8) {
		new Notice('Select at least a short sentence to remember.');
		return false;
	}

	const title = view.file.basename;
	const content = `User note (${title}): ${text}`.slice(0, 10_000);
	const isStatic = opts?.asStatic ?? /prefer|always|i am|i use|i like|my name/i.test(text);

	try {
		const api = MemoryApi.of(plugin.settings);
		await api.createMemories({
			containerTag: containerTag(plugin.app.vault.getName()),
			memories: [{ content, isStatic }],
		});
		new Notice(
			isStatic
				? 'Saved as stable memory. Open profile → Refresh to see it.'
				: 'Saved as memory. Open profile → Refresh or search in Memories only.',
		);
		return true;
	} catch (e) {
		new Notice('Remember failed: ' + smMessage(e));
		return false;
	}
}
