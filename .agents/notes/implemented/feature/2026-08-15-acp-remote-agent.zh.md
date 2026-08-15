# Agent Note: ACP 远程代理(WSL/SSH)

Status: implemented

[English](2026-08-15-acp-remote-agent.md) | 中文

## 问题

终端前门此前只能委派同一台机器上的子代理:ACP 客户端提供方(`dsh-subagent-acp`)本就能 spawn 任意 argv,但它的 cwd 处理在本机 stat 本地目录、权限提示自动应答无人参与、远端也没有一条命令就能起的服务端 profile。工作站愿景需要把 WSL 或 SSH 机器上的 dsh 当作子代理驱动,并且远端机器的危险工具询问要在本地 TUI 的审批对话框里呈现。

## 决策

**两个 cwd 角色,在运行 spec 处拆开。** `wsl`/`ssh` 传输进程在本地运行,无法 chdir 进 `/home/...`,因此 `AcpRunSpec` 在 `cwd`(ACP 会话工作区)之外新增 `spawnCwd`(本机锚点;remote 世界钉在本 harness 进程 cwd)。新配置 `cwdWorld: 'remote'` 在加载时只做语法校验——非空、远端机器上的绝对路径(posix `/`、Windows 盘符或 UNC)、绝不对本地启动目录做 resolve——且必填,因为委派父会话的 cwd 是本机状态,不能泄漏进远端工作区声明。默认 `local` 与既有行为逐字节一致。

**权限询问经父进程审批瀑布中继。** `permission: 'ask'` 把子进程的 `session/request_permission` 转发给 `AcpRunSpec.requestApproval`;提供方把它接到 `ctx.get('approval')`(工具面 serviceAsk 的机会式读取先例——服务运行时仍可选),以 `agent: request.parent` 归因、工具名加提供方命名空间(`acp:bash`):TUI 的每槽应答器恰好认领自己的 agent,由现有审批对话框裁决;而会话级"总是允许 acp:bash"永远不会给本地 bash 开绿灯。所有退化路径——服务缺席、请求被拒、瀑布抛错——都解析为 `unavailable`,响应映射把它变成 cancelled(fail-closed:未决询问之下子进程绝不继续)。

**用 run-settled 控制器收束竞态。** 询问的 signal 是运行请求的 signal 加一个 `runSettled` AbortController(result 落定或 dispose 时触发):取消运行或子进程崩溃会立即收回仍挂起的人工询问,迟到的应答落在已落定的运行上无害。已知限制:ACP 没有撤回挂起权限请求的消息,远端先超时时客户端可能残留一个过期对话框,其应答会被丢弃。

**桥上携带人工需要的信息。** `dsh-acp` 现在把工具名放进 toolCall `title`、询问理由(实际命令行)放进协议保留的 `_meta` 扩展位——不改协议;线的两端都是本仓库。

**内置服务端 profile。** `dsh-acp-bundle`(dsh-base 之上的纯配置:HMR 关闭让 stdout 专属 JSON-RPC,插入一行 `dsh-acp`,路由可用 `DSH_ACP_PROVIDER`/`DSH_ACP_MODEL` 钉住)加 `PROFILE_TEMPLATES.acp` 条目:远端机器 `dsh --profile acp` 零组装起服。

## 影响

- 凭据放在服务端机器:`wsl`/`ssh` 不转发客户端环境,argv 绝不能携带密钥(进程列表全局可读)。`spec.env` 对本地子进程照常生效。
- 客户端父侧审批策略是中继的闸门:`danger-full-access`(policy `never`)下远端询问被自动拒绝、不弹窗——`ask` 需要客户端处于 `workspace-write`。
- 远程运行在 `/agents` 面板不可见(进程外运行本就如此),只回传 `agent_message_chunk` 文本——提供方语义不变。
- 提供方不声明启动能力,因此远端 `tool-subagent` 实例必须用 `maxDepth: 'provider-managed'` 且一次性模式(不可 continuable 后台)。
- 测试证据:keyless 套件覆盖 cwd 双世界(local 不变 + remote 锚点/会话拆分、语法拒绝)、ask 中继(父归因、命名空间、`_meta` 理由、全部 outcome 映射与两种无选项退化、服务缺席/抛错、挂起中 abort)、桥 title/reason;真实 `dsh --profile acp --dump-config` 启动 bundle;ConPTY 回环冒烟(TUI → subagent-acp → `--profile acp` 子进程 → 远端询问 → TUI 对话框 → 允许 → 完成)在真实终端上跑通全链路。
