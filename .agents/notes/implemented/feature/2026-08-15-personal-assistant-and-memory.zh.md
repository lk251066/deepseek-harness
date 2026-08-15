# Agent Note: 个人助手会话与长期记忆

Status: implemented

[English](2026-08-15-personal-assistant-and-memory.md) | 中文

## 问题

终端前门此前一个进程只驱动一个编码会话。用户的个人工作站愿景需要一名个人助手:一个有自己人设的特殊会话,能把关于用户的持久事实跨重启保存下来,并有办法浏览它记住了什么——同时不改变普通编码会话的 prompt 与工具面,也不让助手变成后台守护进程(会话仍然随进程生死;只有记忆库是持久的)。

## 决策

**记忆是基于现有存储栈的独立包。** `@deepseek-ai/dsh-memory` 在组合的 json 后端上开一个 storage-domain(`memory`,version 0)——数据落在 `$DSH_HOME/storages` 下,持久化与生俱来。服务 API 是同步读 + 写链变更(`list`/`add`/`update`/`remove`/`search`/`recalledText`),镜像 message-feedback 的边车模式。没有引入新的持久化机制。

**工具与注入只装在助手 agent 的作用域上,而非全局。** `MemoryService.installTools(agentCtx)` 注册 `memory_save`(回合独占的持久写)与 `memory_search`(并发安全的纯读),外加两个 prompt 段——静态 `tool:memory` 指引和动态 `memory:recalled`(每次组装重新求值,按字符预算截断;库为空/未初始化/已关闭时返回空串,组装永远不会被打断)。TUI 不 import 该包的任何运行时代码:`ctx.get('memory')` + 仅类型声明合并,不挂它的组合依然有效。

**助手是固定 id 会话,靠 setup 契约续命。** `/assistant`(chat/assistant.ts)按从快到慢三条分支解析:注册表里已有槽位直接切换;agent 存活但被 LRU 逐出则重新 adopt;否则做一次只读头的持久化预检(`sessionPersistence.list()`),决定 resume(`ctx.agents.resume({resumeSessionId: 'assistant', setup})`,跨进程延续同一段对话)还是 create。两条路径都跑同一个 `setupAssistant`:以同名替换规则 shadow `deployment:persona` 装上助手人设,并经可选服务装上记忆工具——resume 契约(setup 必须重跑)正是人设跨重启存活的原因。resume 被拒且消息匹配 `not found`(预检与 resume 之间被人删除)时回退 create 一次;其余失败以通知报告。

**依赖只朝一个方向流动。** TUI 依赖 agent 注册表、通道注册表和可选服务;dsh-memory 依赖 storage-domain 与 tools。助手控制器不持有任何记忆引用——插件缺席时助手是一个换了人设的普通会话,`/memories` 报告缺口。

## 影响

- 助手对话跨重启增长;既有 compaction 机制兜底,与 `main` 相同。
- 助手日志的 `header.cwd` 停留在创建时的工作区(jsonl 后端按固定 id 跨项目目录解析),因此那里的 `/status` 可能显示别的项目路径。已接受。
- resume 的 `not found` 是字符串匹配(upstream 没有类型化错误);预检让这条路径罕见而非承重。upstream 品牌化该错误后即可去掉字符串判断。
- 记忆暂无删除通道(` /memories` v1 只读);召回预算约束 prompt 增长,`maxMemories` LRU 是自然的下一步。
- 两个进程并发 resume 同一份助手日志时,共享任何第二次 `/resume` 的 torn-tail 恢复保障——与手动流程一致,已接受。
