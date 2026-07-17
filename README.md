# Supermemory for Obsidian

**Local memory for your Obsidian vault** — powered by [Supermemory Local](https://supermemory.ai/docs/self-hosting/overview).

Obsidian’s built-in search only matches **exact keywords**. This plugin connects your vault to **Supermemory Local** on your machine so you can:

- Find notes by **meaning** (not just titles/keywords)
- See **related notes while you write**
- Build a **living profile** of what your notes say about you (and how facts change over time)

Everything stays **local**. No cloud Supermemory account is required for this path.

> **Desktop only.** Needs a running `supermemory-server`. On **Windows**, run Local in **WSL**.

---

## One-line pitch

Turns your Obsidian vault into a living local memory layer — semantic search, writing-time context, and a time-aware profile — via Supermemory Local.

---

## Features (current)

| Feature | What it does |
| --- | --- |
| **Hub + status bar** | Setup checklist, connection status (`SM · Connected` / Offline) |
| **Vault sync** | Incremental sync of all markdown notes (hash skip, batch upload, progress) |
| **Force full re-sync** | Re-send every note (still updates via stable IDs, no duplicates) |
| **Auto-sync on edit** | Optional: re-ingest a note when you save/edit it |
| **Hybrid semantic search** | Search notes + extracted memories by meaning; ranked results with relevance % |
| **Memories-only search** | Search extracted facts only |
| **Folder filters** | Limit meaning search to a top-level vault folder (e.g. Projects) |
| **Related notes while writing** | Side panel updates after you pause typing (or “Find related now”) |
| **Vault profile** | Stable facts + current state from Supermemory |
| **Show history** | Timeline for how a fact/topic evolved across notes |
| **Build profile facts** | Fill Stable/Current when auto-extraction left the profile empty |
| **Profile snapshots** | Save before/after profile and compare |
| **Living profile note** | Write profile into a real note (default `Meta/My memory profile.md`) |
| **Topic chronicle** | Generate a time-ordered story note under `Chronicles/` |
| **Remember selection** | Save selected text as a memory or stable fact |
| **Contradict while typing** | Soft warning when what you type conflicts with profile memory (e.g. Postgres vs SQLite) |

---

## How it works (simple)

```
Your notes (Obsidian)
        │
        │  Sync  →  POST /v3/documents
        ▼
Supermemory Local  (http://localhost:6767)
  • stores + embeds notes
  • extracts memories (LLM)
  • builds profile (static / dynamic)
        │
        │  Search / Profile / Remember  →  /v4/search, /v4/profile, /v4/memories
        ▼
Plugin panels open the right note in Obsidian
```

Two different keys:

| Key | Looks like | Where |
| --- | --- | --- |
| Local API key | `sm_…` | **Plugin settings only** |
| LLM provider key | `gsk_…` / OpenAI / etc. | **Only when starting Local** (not in Obsidian) |

---

## Quick start (anyone can follow this)

### Step 1 — Start Supermemory Local

**macOS / Linux**

```bash
curl -fsSL https://supermemory.ai/install | bash
# set an LLM key if prompted, or:
export GROQ_API_KEY="your_provider_key"
supermemory-server
```

**Windows (WSL Ubuntu)**

```bash
# Install once (if needed):
curl -fsSL https://supermemory.ai/install | SUPERMEMORY_NO_START=1 SUPERMEMORY_NO_PROMPT=1 bash

export PATH="$HOME/.local/bin:$PATH"
export GROQ_API_KEY="your_provider_key"          # no spaces around =
export SUPERMEMORY_DATA_DIR="/mnt/d/Supermemory" # optional: put data on D:
mkdir -p "$SUPERMEMORY_DATA_DIR"
supermemory-server
```

When you see:

```text
url       http://localhost:6767
api key   sm_xxxxxxxx
→ supermemory ready
```

**Copy the `sm_…` key** and **leave this terminal open**.

Free LLM options that work with Local include [Groq](https://console.groq.com/keys), Gemini, OpenAI, Anthropic, or Ollama.

---

### Step 2 — Install this plugin into a vault

1. Build (or download release assets):

   ```bash
   npm install
   npm run build
   ```

2. In your vault folder create:

   ```text
   YourVault/.obsidian/plugins/obsidian-supermemory/
   ```

3. Copy these three files into that folder:

   - `main.js`
   - `manifest.json`
   - `styles.css`

4. Open Obsidian → **Settings → Community plugins**
   - Turn **Restricted mode** **off**
   - Enable **Supermemory for Obsidian**

---

### Step 3 — Connect the plugin

1. **Settings → Supermemory for Obsidian** (or open the hub from the ribbon).
2. **API key:** paste **`sm_…`** from Local (not your Groq key).
3. **URL:** `http://localhost:6767` (default).
4. Click **Test connection**.
5. Status bar (bottom) should show **`SM · Connected`**.

---

### Step 4 — Add notes and sync

1. Add a few real markdown notes (or any existing vault).
2. Press **`Ctrl/Cmd + P`**.
3. Run **`Supermemory: Sync vault to supermemory`**.
4. Wait for “synced N notes”.
5. Wait **1–2 minutes** after the first big sync so Local can process.

Optional: Settings → **Auto-sync on edit**.

---

### Step 5 — Use the features

| Goal | What to do |
| --- | --- |
| **Search by meaning** | `Ctrl+P` → **Open semantic search** → type a natural question → Enter. Optionally set **Folder**. Click a result to open the note. |
| **Related while writing** | **Open related-notes panel** → type in a note → pause ~1s or click **Find related now**. |
| **Profile** | **Open vault profile** → **Refresh profile**. If Stable/Current empty → **Build profile facts from notes** → Refresh again. |
| **Fact history** | On a current-state fact → **Show history**. |
| **Living profile note** | **Update living profile note** → opens `Meta/My memory profile.md` (path configurable in settings). |
| **Topic story** | **Write topic chronicle** → e.g. `database` → creates `Chronicles/database.md`. |
| **Save a fact** | Select text → **Remember selection as memory** or **… as stable fact**. |
| **Memory guard** | Keep **Contradict while typing** on; write something that conflicts with a known fact → notice appears. |
| **Snapshots** | Profile → **Save snapshot** → change/sync more → **Compare to last snapshot**. |

---

## All commands (command palette)

| Command | Purpose |
| --- | --- |
| Open supermemory hub | Setup status and workflow |
| Check Supermemory Local connection | Health check |
| Sync vault to supermemory | Incremental sync |
| Force full re-sync to supermemory | Full re-send |
| Cancel running sync | Stop sync |
| Open semantic search | Hybrid / memories + folder filter |
| Open related-notes panel (while writing) | Writing suggestions |
| Open vault profile | Profile UI |
| Build profile facts from notes | Fill empty Stable/Current |
| Remember selection as memory | Dynamic-style memory |
| Remember selection as stable fact | Static memory |
| Update living profile note | Profile → markdown in vault |
| Write topic chronicle | Time-ordered topic note |

**Ribbon:** brain (hub), search, user (profile).  
**Status bar:** click to open hub.

---

## Settings

| Setting | Meaning |
| --- | --- |
| Supermemory local URL | Default `http://localhost:6767` |
| API key | `sm_…` from Local first boot |
| Auto-sync on edit | Re-ingest notes after edit |
| Contradict while typing | Warn on conflicts with profile |
| Living profile note path | Default `Meta/My memory profile.md` |
| Debug logging | Console logs (`Ctrl+Shift+I`) |
| Clear sync index | Next sync re-sends all notes (still upserts) |
| Reset profile snapshot | Clear before/after snapshot |

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Not connected | Is Local still running? Correct `sm_…`? URL `http://localhost:6767`? |
| `export: '=' not a valid identifier` | No spaces: `export KEY="value"` |
| `supermemory-server: command not found` | Use full path `$HOME/.local/bin/supermemory-server` or reinstall Local in WSL as your user |
| Windows install fails | Use WSL; native Windows binary is not supported yet |
| Profile Stable/Current empty | Run **Build profile facts from notes**; ensure Local was started with a valid LLM key; wait after sync |
| Search works, profile empty | Documents indexed; memories not extracted yet — Build profile facts |
| Related notes empty | Type a full sentence; use **Find related now**; sync first |
| 400 on Test connection | Use latest built `main.js` from this repo |
| Reranking errors in Local log | Safe to ignore; plugin does not rely on cloud rerank |

---

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production main.js
npm run lint
```

### Source layout

| Path | Role |
| --- | --- |
| `src/main.ts` | Lifecycle, commands, ribbon, status bar |
| `src/api.ts` | HTTP client to Supermemory Local |
| `src/sync.ts` | Vault sync |
| `src/notes.ts` | Note payload, tags, fingerprints |
| `src/config.ts` | Settings and defaults |
| `src/status.ts` | Connection health / workflow |
| `src/profileBuild.ts` | Build profile facts |
| `src/remember.ts` | Remember selection |
| `src/livingProfile.ts` | Living profile note |
| `src/chronicle.ts` | Topic chronicle |
| `src/contradict.ts` | Contradict while typing |
| `src/ui/*` | Hub, search, suggest, profile, settings |

---

## License

This project is open source under the **[MIT License](LICENSE)**.

Copyright (c) 2026 Supermemory for Obsidian contributors.
