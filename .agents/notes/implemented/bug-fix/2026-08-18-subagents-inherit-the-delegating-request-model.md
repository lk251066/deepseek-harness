# Agent Note: Subagents inherit the delegating request model

Status: implemented

English | [中文](2026-08-18-subagents-inherit-the-delegating-request-model.zh.md)

## Problem

In-process children inherited provider and model from their parent's creation-time `AgentOptions`. A session-level model switch instead changes the logged `request/header`, so a delegation from that request could silently run the child on the stale creation route. Reasoning effort was not represented in child options or continuable descriptors, and a fork seed could restore an older request effort into the child.

## Decision

Every in-process delegation synchronously captures the parent's latest `request/header` before its first await. The header's provider and model are authoritative once present; parent creation options are used only before the first request. Explicit child provider or model fields override the captured route.

The child inherits reasoning effort only when its final provider and model exactly match the captured parent route and `adapterDefaults.reasoningEffort` is not true. This preserves explicit user selection without converting an adapter-materialized default into durable child policy or moving an opaque effort id to another model.

The captured route and optional explicit effort are installed as one fixed child-scoped model selection. It applies after downstream request listeners and after any fork seed, so the request that performed the delegation determines the child request. Nested in-process delegation reads the immediate parent's child header by the same rule.

Continuable descriptors store the resolved provider, model, and optional explicit reasoning effort. Cold resume reconstructs only that stored selection and does not read the parent's later request state. Adding the reasoning field raises `SUBAGENT_DESCRIPTOR_VERSION`; unsupported older descriptors remain non-resumable under the pre-release on-disk format policy.

## Alternatives considered

**Read `Session.requestContext()`.** That projection records provider, model, and context capacity but not reasoning effort, so it cannot reproduce the complete selection that generated the delegation.

**Keep reading `parent.options`.** Creation options do not change when a TUI or API installs a session-scoped model selection, which is the stale-route defect.

**Copy every resolved reasoning effort.** Adapter defaults are deployment policy resolved per request. Persisting them as explicit child selections would prevent later adapter-default changes and misstate their ownership.

**Re-read the parent during cold resume.** A durable child is an independent session. Applying a later parent switch to an existing child would change that child's model without an event in its own history.

## Consequences

Spawn, fork, continuable, and nested in-process children use the model selection of the request that delegated them. Explicit child routes remain authoritative, cross-route reasoning does not leak, and adapter defaults remain adapter-owned. Continuable descriptor version 3 is the complete cold-resume input for the captured selection.

Focused tests exercise dynamic parent selection, explicit child overrides, adapter defaults, fork seeds with older reasoning, nested delegation, descriptor validation, and cold resume after the parent changes effort.
