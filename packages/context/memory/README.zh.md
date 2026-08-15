# @deepseek-ai/dsh-memory

[English](README.md) | 中文

关于用户的持久长期记忆。本包注册 `ctx.memory`,把一个记忆库持久化到 storage-domain(宿主的 `storages` 根目录),并为个人助手安装其专属作用域的 `memory_save`/`memory_search` 工具与自动召回的 prompt 段。记忆跨进程重启存活,比任何单次对话都长寿。

## 配置

| 键 | 含义 | 默认 |
|---|---|---|
| `maxTextBytes` | 正安全整数:单条记忆文本的最大 UTF-8 字节长度。 | `2000` |
| `recallMaxChars` | 正安全整数:自动召回 prompt 段的字符预算。 | `4000` |

```yaml
- id: memory
  name: '@deepseek-ai/dsh-memory'
  config:
    maxTextBytes: 2000
    recallMaxChars: 4000
```

服务注入 `storageDomain`。其持久域为 `memory`(version 0),`memories` 表中每条记忆一行(按记忆 id 键)。

## 数据模型

`MemoryRecord` 携带 `id`、`text`(一条简短自包含的事实,存储时已 trim)、`tags`(规范化:trim、小写、去重)、仅等值比较的 `version`,以及宿主赋值的 `createdAt`/`updatedAt` Unix 毫秒时间戳。持久行 schema 在重开时拒绝空白文本、未规范化或重复的 tag、以及 `updatedAt` 早于 `createdAt`。

`list()` 返回首建顺序;`search(query, limit?)` 跨文本与 tag 做大小写不敏感匹配,最近更新优先(id 为稳定决胜);`add`/`update`/`remove` 在域写链上串行。`recalledText(budget)` 在字符预算内按最近优先渲染全部记忆——库为空、未初始化或已关闭时返回空串,因此建立在它之上的 prompt 段永远不会打断组装。

## 作用域安装

`ctx.memory.installTools(agentCtx)` 只在单个 agent 的作用域上注册:`memory_save`(持久写,回合独占)与 `memory_search`(纯读,并发安全)两个工具、静态的 `tool:memory` 指引段、以及每次 prompt 组装都重新求值的动态 `memory:recalled` 段。以这种方式装配的 agent——个人助手——能看到它们;其他任何会话的 prompt 与工具面不受影响。
