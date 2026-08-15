# @deepseek-ai/dsh-acp-bundle

[English](README.md) | 中文

ACP 服务端 bundle:`dsh --profile acp` 把本 harness 以 Agent Client Protocol 形式服务于 stdio——每个协议会话一个 agent,权限询问中继给客户端。组合在 `dsh-base` 之上(LLM 路由、工具、沙箱、持久化);协议桥本体在 [`@deepseek-ai/dsh-acp`](../../acp/acp)。

## 补丁做了什么

- **`hmr: disabled`**——stdout 属于 JSON-RPC 流;launcher 的 watch-only 回退仍通过 stderr 保住用户补丁层的热更新。
- **插入 `dsh-acp`**,路由可用环境变量钉住:`DSH_ACP_PROVIDER`(默认 `deepseek-official`)与 `DSH_ACP_MODEL`(默认 `deepseek-v4-flash`)配置每个 ACP 创建的 agent。

base 的 agent 花名册保持为空——agent 随 `session/new` 创建,没有启动 agent,也没有交互面。

## 服务与消费

```bash
# 服务端(远端机器——裸机、WSL 或 SSH 主机)
dsh --profile acp

# 在另一台 dsh 的 TUI 里消费(subagent-acp 作客户端)——加到客户端
# profile 的 cordis.patch.yml:
- insert:
    - id: subagent-acp
      name: '@deepseek-ai/dsh-subagent-acp'
      config:
        providerName: acp
        command: wsl                      # 或: ssh
        args: ['-e', 'dsh', '--profile', 'acp']
        cwdWorld: remote
        cwd: /home/me/project
        permission: ask                   # 权限询问在客户端的审批界面弹出
```

凭据放在服务端机器上(`$DSH_HOME` 环境变量 / `.env`):`wsl`/`ssh` 传输不转发客户端环境,且 argv 绝不能携带密钥(进程列表全局可读)。

## 凭据与前置条件

- 服务端需要自己的 provider 凭据——没有任何东西从客户端流过来。
- 远端 PATH 里必须能解析 `dsh`;否则包一层:WSL 用 `args: ['-e', 'bash', '-lc', 'dsh --profile acp']`(argv 在本地永不经过 shell 解释;包装命令在远端执行)。
