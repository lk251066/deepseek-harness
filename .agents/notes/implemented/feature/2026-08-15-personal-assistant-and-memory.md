# Agent Note: Personal Assistant Session and Long-Term Memory

Status: implemented

English | [中文](2026-08-15-personal-assistant-and-memory.zh.md)

## Problem

The terminal front door drove one coding session per process. The user's workstation vision needs a personal assistant: a special session with its own persona that keeps durable facts about the user across restarts, plus a way to browse what it remembers — without changing the prompt or tool surface of ordinary coding sessions, and without the assistant becoming a background daemon (sessions still live and die with the process; only the memory store is durable).

## Decisions

**Memory is its own package over the existing storage stack.** `@deepseek-ai/dsh-memory` opens one storage-domain (`memory`, version 0) on the composition's json backend — data lands under `$DSH_HOME/storages`, so it survives restarts by construction. The service API is synchronous reads + write-chain mutations (`list`/`add`/`update`/`remove`/`search`/`recalledText`), mirroring message-feedback's sidecar pattern. No new persistence mechanism.

**Tools and injection are scoped to the assistant agent, not global.** `MemoryService.installTools(agentCtx)` registers `memory_save` (turn-exclusive durable write) and `memory_search` (concurrency-safe pure read) plus two prompt sections — static `tool:memory` guidance and dynamic `memory:recalled` (re-evaluated per assembly, character-budgeted, empty on an empty/uninitialized/closed store so assembly can never break). The TUI never imports the package's runtime code: `ctx.get('memory')` with a type-only declaration merge, so compositions without it stay valid.

**The assistant is a fixed-id session with a setup contract.** `/assistant` (chat/assistant.ts) resolves in three fast-to-slow branches: a live registry slot switches; a live-but-LRU-evicted agent re-adopts; otherwise a header-only persistence preflight (`sessionPersistence.list()`) picks resume (`ctx.agents.resume({resumeSessionId: 'assistant', setup})`, continuing the same conversation across processes) or create. Either path runs the same `setupAssistant`, which shadows `deployment:persona` with the assistant persona (the system-prompt registry's same-name replacement rule) and installs the memory tools through the optional service — the resume contract (setup must re-run) is what keeps the persona alive across restarts. A resume rejection matching `not found` (a delete racing the preflight) falls back to create once; every other failure reports as a notice.

**Dependencies run one way.** The TUI depends on the agent registry, the channel registry, and optional services; dsh-memory depends on storage-domain and tools. The assistant controller holds no memory references — if the plugin is absent the assistant is a persona-shifted session and `/memories` reports the gap.

## Consequences

- The assistant conversation grows across restarts; the existing compaction machinery bounds it, same as `main`.
- The assistant log's `header.cwd` stays at the creating workspace (the jsonl backend resolves the fixed id across project directories), so `/status` there can show another project's path. Accepted.
- `not found` from resume is a string match (upstream has no typed error); the preflight makes that path rare rather than load-bearing. An upstream branded error would remove the string check.
- Memory has no deletion channel yet (`/memories` is read-only, v1); the recall budget bounds prompt growth, and a `maxMemories` LRU is the natural next step.
- Two processes resuming the same assistant log concurrently share the torn-tail recovery guarantees of any second `/resume` — accepted, same as the manual flow.
