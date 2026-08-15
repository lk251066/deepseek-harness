# @deepseek-ai/dsh-acp-bundle

English | [中文](README.zh.md)

The ACP server bundle: `dsh --profile acp` serves this harness over the Agent Client Protocol on stdio — one agent per protocol session, with permission asks relayed to the client. Composed over `dsh-base` (LLM routing, tools, sandbox, persistence); the bridge itself lives in [`@deepseek-ai/dsh-acp`](../../acp/acp).

## What the patch does

- **`hmr: disabled`** — stdout belongs to the JSON-RPC stream; the launcher's watch-only fallback keeps user patch layers live through stderr.
- **inserts `dsh-acp`** with env-pinnable routing: `DSH_ACP_PROVIDER` (default `deepseek-official`) and `DSH_ACP_MODEL` (default `deepseek-v4-flash`) configure every ACP-created agent.

Base's agent roster stays EMPTY — agents are created per `session/new`, so there is no boot agent and no interactive surface.

## Serving and consuming

```bash
# serve (the remote machine — bare metal, WSL, or an SSH host)
dsh --profile acp

# consume from another dsh's TUI (subagent-acp as the client) — add to the
# CLIENT profile's cordis.patch.yml:
- insert:
    - id: subagent-acp
      name: '@deepseek-ai/dsh-subagent-acp'
      config:
        providerName: acp
        command: wsl                      # or: ssh
        args: ['-e', 'dsh', '--profile', 'acp']
        cwdWorld: remote
        cwd: /home/me/project
        permission: ask                   # permission asks surface in the client's approval UI
```

Credentials live on the SERVING machine (`$DSH_HOME` env / `.env`): `wsl`/`ssh` transports do not forward the client's environment, and argv must never carry a key (process listings are world-readable).

## Credentials and prerequisites

- The serving side needs its own provider credentials — nothing flows from the client.
- `dsh` must resolve on the remote PATH; otherwise wrap it: `args: ['-e', 'bash', '-lc', 'dsh --profile acp']` for WSL (argv is never shell-interpreted locally; the wrapper runs remotely).
