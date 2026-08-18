# Agent Note: 子 agent 继承发起委派请求的模型

Status: implemented

[English](2026-08-18-subagents-inherit-the-delegating-request-model.md) | 中文

## Problem

进程内子 agent 原本从父 agent 创建时的 `AgentOptions` 继承 provider 与 model。会话级模型切换改变的是已记录的 `request/header`，因此从该请求发起委派时，子 agent 可能静默使用过期的创建路由。reasoning effort 没有进入子 agent 选项或可继续描述符，fork seed 还可能把较旧请求的 effort 恢复到子 agent。

## Decision

每次进程内委派都会在第一次 await 前同步捕获父 agent 最新的 `request/header`。一旦存在 header，其中的 provider 与 model 就具有权威性；只有第一次请求之前才使用父 agent 创建选项。显式指定的子 agent provider 或 model 会覆盖捕获的路由。

只有当子 agent 最终的 provider 与 model 完全匹配所捕获的父级路由，且 `adapterDefaults.reasoningEffort` 不为 true 时，子 agent 才继承 reasoning effort。这样既保留用户的显式选择，又不会把 adapter 填充的默认值转成持久的子 agent 策略，也不会把不透明的 effort id 移到其他模型。

捕获的路由和可选显式 effort 会作为一份固定的子 agent 作用域模型选择安装。它在下游请求 listener 和任何 fork seed 之后生效，因此由真正执行委派的请求决定子 agent 请求。嵌套进程内委派按同一规则读取直接父级的子 agent header。

可继续描述符会存储已解析的 provider、model 与可选显式 reasoning effort。冷恢复只重建这份已存储的选择，不读取父 agent 后续请求状态。新增 reasoning 字段会提升 `SUBAGENT_DESCRIPTOR_VERSION`；按照预发布阶段的磁盘格式策略，不支持的旧描述符仍不可恢复。

## Alternatives considered

**读取 `Session.requestContext()`。** 该投影记录 provider、model 与上下文容量，但不记录 reasoning effort，因此无法重现生成委派的完整选择。

**继续读取 `parent.options`。** TUI 或 API 安装会话作用域模型选择时不会改变创建选项，这正是路由过期缺陷。

**复制所有已解析的 reasoning effort。** Adapter 默认值是按请求解析的部署策略。把它持久化为显式子 agent 选择，会阻止后续 adapter 默认值变化，也会错误表达其归属。

**冷恢复时重新读取父 agent。** 持久化子 agent 是独立会话。把父 agent 后续切换应用到既有子 agent，会在其自身历史没有事件的情况下改变模型。

## Consequences

Spawn、fork、可继续与嵌套进程内子 agent 都使用发起委派请求的模型选择。显式子 agent 路由保持权威，reasoning 不会跨路由泄漏，adapter 默认值仍归 adapter 所有。可继续描述符版本 3 是所捕获选择的完整冷恢复输入。

聚焦测试覆盖动态父级选择、显式子 agent 覆盖、adapter 默认值、带较旧 reasoning 的 fork seed、嵌套委派、描述符校验，以及父级改变 effort 后的冷恢复。
