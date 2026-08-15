# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

Durable long-term memory about the user. The package registers `ctx.memory`, persists one memory store in storage-domain (the host's `storages` root), and installs the personal assistant's scoped `memory_save`/`memory_search` tools plus its auto-recalled prompt section. Memory survives process restarts and outlives any single conversation.

## Configuration

| key | meaning | default |
|---|---|---|
| `maxTextBytes` | Positive safe integer: maximum UTF-8 byte length of one memory text. | `2000` |
| `recallMaxChars` | Positive safe integer: character budget for the auto-recalled prompt section. | `4000` |

```yaml
- id: memory
  name: '@deepseek-ai/dsh-memory'
  config:
    maxTextBytes: 2000
    recallMaxChars: 4000
```

The service injects `storageDomain`. Its durable domain is `memory` (version 0), with one `memories` table row per memory id.

## Data model

A `MemoryRecord` carries `id`, `text` (one short self-contained fact, stored trimmed), `tags` (normalized: trimmed, lowercased, de-duplicated), an opaque equality-only `version`, and host-assigned `createdAt`/`updatedAt` Unix-millisecond timestamps. The durable row schema rejects blank text, non-normalized or duplicate tags, and `updatedAt` before `createdAt` on reopen.

`list()` returns first-creation order; `search(query, limit?)` matches case-insensitively across text and tags, most recently updated first (id as the stable tiebreaker); `add`/`update`/`remove` serialize on the domain's write chain. `recalledText(budget)` renders every memory most-recent-first inside a character budget — empty when the store is empty, uninitialized, or closed, so a prompt section built on it can never break assembly.

## Scoped installation

`ctx.memory.installTools(agentCtx)` registers on ONE agent's scope: the `memory_save` (durable write, turn-exclusive) and `memory_search` (pure read, concurrency-safe) tools, the static `tool:memory` guidance section, and the dynamic `memory:recalled` section whose text re-evaluates on every prompt assembly. Agents set up this way — the personal assistant — see them; every other session's prompt and tool surface is untouched.
