# Supermemory for Obsidian

Connect your Obsidian vault to a local [Supermemory](https://supermemory.ai) instance for **semantic search**, **writing-time related-note suggestions**, and an **auto-synthesized profile** of what your notes reveal about you — fully local, nothing leaves your machine.

> **Note:** This plugin is **desktop-only**. It requires a running Supermemory Local server (`supermemory-server`) on your machine. It will not work on Obsidian mobile.

---

## Why this exists

Obsidian's native search is exact-keyword-match only. Once a vault grows past a few hundred notes, finding things by keyword becomes painful. Supermemory understands meaning, tracks how facts change over time, and can synthesize a running profile from your accumulated notes. This plugin brings that power into Obsidian, backed entirely by a local Supermemory process.

---

## Prerequisites

1. **Supermemory Local** must be installed and running.

   ```bash
   curl -fsSL https://supermemory.ai/install | bash
   supermemory-server
   ```

   On first boot, Supermemory Local prints:

   ```
   url       http://localhost:6767
   api key   sm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   org id    xxxxxxxxxxxxxxxxxxxxxx
   ```

   Save the `api key` — you'll paste it into the plugin settings.

2. **Obsidian desktop** (Windows, macOS, or Linux).

---

## Installation

### From a GitHub release (recommended for judges / end users)

1. Download the latest release assets: `main.js`, `manifest.json`, and `styles.css`.
2. In your Obsidian vault, create the folder `.obsidian/plugins/obsidian-supermemory/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Open Obsidian → **Settings → Community Plugins → Installed plugins**.
5. Enable **Supermemory for Obsidian**.

### From source

```bash
git clone https://github.com/supermemoryai/obsidian-supermemory.git
cd obsidian-supermemory
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` from the repo into `.obsidian/plugins/obsidian-supermemory/` in your vault.

---

## Setup (core workflow)

1. **Start Supermemory Local** (separate process):

   ```bash
   npx supermemory local
   # or: supermemory-server
   ```

   Copy the `sm_…` API key from first boot (`http://localhost:6767`).

2. Enable the plugin in Obsidian. On first run the **Supermemory hub** opens automatically.
3. Open **Settings → Supermemory for Obsidian** (or the hub) → paste the API key → **Test connection**.
4. Run **Supermemory: Sync vault to supermemory**.
5. Use **Search**, **Related while writing**, or **Profile** from the hub, ribbon, or command palette.

The status bar shows `SM · Connected` / `Offline` / `No API key` — click it to reopen the hub.

| Step | What happens |
| --- | --- |
| Local server | Graph engine + embeddings on your machine |
| API key | Bearer token from local first boot only |
| Sync | Notes → memory documents (`taskType: memory`) |
| Search / profile | Hybrid recall + static/dynamic facts from Local |

---

## How this product uses Supermemory (the core idea)

This is **not** "embed my vault and do vector search." That is plain RAG, and every AI-Obsidian plugin already does it.

Supermemory is a **memory layer**: when notes are ingested, it extracts facts, links them in a graph, tracks when facts update or contradict older ones, and maintains a living **profile** (stable identity + current state). The plugin is the Obsidian-facing pipeline for that system:

```
Vault notes ──sync──► documents (taskType: memory)
                         │
                         ▼
              extracted memories + graph updates
                         │
         ┌───────────────┼────────────────┐
         ▼               ▼                ▼
   Hybrid search    Writing suggestions   Profile
   (notes+facts)    (related context)     (static/dynamic)
```

| Surface | Supermemory API | Why it matters |
| --- | --- | --- |
| **Sync** | `POST /v3/documents/batch` with `taskType: "memory"`, `dreaming: "dynamic"`, `entityContext`, stable `customId` | Feeds the graph. Dynamic dreaming groups related notes so memories form from coherent units, not isolated chunks. |
| **Search** | `POST /v4/search` hybrid (default) or memories-only + rerank | Hybrid = note text **and** extracted facts. Memories-only surfaces how Supermemory *understood* you. |
| **Suggest** | hybrid search on the paragraph you're writing | Related past context without leaving the editor. |
| **Profile** | `POST /v4/profile` + memories search for "Show history" | Static vs dynamic facts; history shows temporal evolution — the clearest differentiator vs vector-only plugins. |

---

## Usage

### Sync your vault (memory intake pipeline)

Open the command palette (`Ctrl/Cmd + P`) and run **"Supermemory: Sync vault to supermemory"**.

What production sync does:

1. **Scans** every markdown note and fingerprints content (SHA-256).
2. **Skips** notes whose fingerprint already matches the local sync index (incremental by default).
3. **Batch-uploads** only changed notes (`/v3/documents/batch`, 4 at a time with a short gap) with:
   - stable `customId` (`obsidian:<vaultTag>:<path>`) so re-sync **updates** instead of duplicating
   - `taskType: "memory"` so Supermemory builds the memory/profile layer (not SuperRAG-only)
   - `dreaming: "dynamic"` so related documents are processed as coherent units
   - `entityContext` describing this as a personal Obsidian vault (guides extraction)
   - metadata: `path`, `title`, `folder`, `mtime`, `noteDate` for filtering and temporal UX
4. Shows a **progress notice** (sent / skipped / failed). Partial progress is saved so a later run resumes cleanly.

Other sync commands:

| Command | Behavior |
| --- | --- |
| **Sync vault to supermemory** | Incremental — only changed notes |
| **Force full re-sync to supermemory** | Re-sends every note (still upserts via `customId`) |
| **Cancel running sync** | Stops after the current batch |

In **Settings**, you can enable **Auto-sync on edit** (debounced single-note re-ingest) and clear the sync index if you need a clean fingerprint slate.

> After a large first sync, wait a moment for Supermemory Local to finish processing (`queued` → `done`) before judging profile quality.

### Semantic search

Open the command palette and run **"Supermemory: Open semantic search"**, or click the **search icon** in the left ribbon.

Type a phrase and press `Enter`. Toggle:

- **Hybrid (notes + memories)** — default; best everyday search (reranked)
- **Memories only** — only extracted facts from the graph

Click a result to open the source note when a path is available.

### Related notes while writing

Open the command palette and run **"Supermemory: Open related-notes panel (while writing)"**. As you type in a markdown note, the panel automatically updates after a short pause to show 3–5 related past notes, excluding the note you're currently editing.

### Vault profile

Open the command palette and run **"Supermemory: Open vault profile"**, or click the **user icon** in the left ribbon.

Click **Refresh profile** to synthesize what your synced notes reveal about you. The profile shows:

- **Stable facts** — long-term identity traits extracted from your notes.
- **Current state (most recent facts)** — what is true *now*. Supermemory updates these when newer notes contradict older ones. **Show history** re-queries in memories mode and sorts by date so you can see how a fact evolved.
- **Related notes** — when you set a focus topic, profile + search results return together.

#### Profile snapshots (before/after comparison)

1. After syncing a subset of notes, click **Refresh profile**, then **Save snapshot**.
2. Sync more notes.
3. Click **Refresh profile** again, then **Compare to last snapshot** to see a side-by-side diff of how your profile changed.

This is especially useful for demos — it visibly shows the profile getting smarter as more notes are added.

---

## Error handling

- If Supermemory Local isn't running, every panel shows a clear message: **"Supermemory Local isn't running — start it with `supermemory-server` and reload."**
- If no API key is set, panels prompt you to open plugin settings and add the `sm_...` token.

---

## Scope & limitations

- **Desktop only.** The plugin sets `isDesktopOnly: true` because it needs a local server process.
- **One vault, one container tag.** Notes are grouped under `vault_<vaultname>` in Supermemory.
- **No cloud required.** The plugin only talks to the URL in your settings (default `http://localhost:6767`).
- **No automatic contradiction resolution.** Supermemory surfaces how facts change over time; resolving contradictions is left to you.

---

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm run lint     # eslint
```

Source layout:

| Path | Role |
| --- | --- |
| `src/main.ts` | Plugin lifecycle, commands, ribbon, auto-sync |
| `src/config.ts` | Settings shape, validation, knobs, debug log |
| `src/api.ts` | Local Supermemory HTTP client + search hit helpers |
| `src/notes.ts` | Vault → document shaping (tags, body, fingerprint) |
| `src/sync.ts` | Incremental / batch vault sync |
| `src/ui/*` | Settings tab + search / suggest / profile panels |

Ship to a vault: copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/obsidian-supermemory/`.

---

## License

MIT
