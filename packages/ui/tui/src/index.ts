/**
 * Interactive pi-tui front door for DeepSeek Harness agents. It renders the
 * durable session transcript, drives one configured agent, and provides
 * keyboard-driven user-interaction dialogs without owning agent lifecycle.
 * @module @deepseek-ai/dsh-tui
 */

import {
  CombinedAutocompleteProvider,
  Container,
  Key,
  Spacer,
  Text,
  TUI,
  ProcessTerminal,
  matchesKey,
  visibleWidth,
  type Component,
  type EditorTheme,
  type SlashCommand,
  type TerminalColorScheme,
} from '@earendil-works/pi-tui'
import { Service, type Context, type Fiber, type FiberState } from '@deepseek-ai/cordis'
import {
  assembleContextFor,
  installModelSelection,
  type Agent,
  type ModelSelectionRef,
  type AgentStatus,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  isReplacementSurfaceEvent,
  SessionId,
  type SessionEvent,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import {
  parseSessionReferenceText,
} from '@deepseek-ai/dsh-session-reference'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
// Type import also declaration-merges the optional `sessionPersistence`
// service onto `Context` so `ctx.get('sessionPersistence')` is typed.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
// Merges the `permissionPresets` service and the `permission/preset` session
// event onto their ambient declarations; the service itself is optional at runtime.
import type {} from '@deepseek-ai/dsh-permission-presets'
// Type import declaration-merges the `userInteraction` service onto `Context`;
// the ask-user-question queue is registered by ./chat/questions.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  TuiExtensionServiceImpl,
  TuiOverlayManager,
} from './extension/overlay-manager.ts'

import {
  parseTuiPromptTemplate,
  renderTuiPromptTemplate,
  type TuiPromptValueHandle,
} from './prompt.ts'
import type {
  TuiOverlayRequest,
  TuiOverlaySession,
  TuiTheme,
} from './extension/types.ts'
import { displayInlineText, displayText } from './components/text.ts'
import { createCodeHighlighter } from './components/highlight.ts'
import { brandText, createPalette, markdownTheme, renderPalette, selectTheme } from './components/theme.ts'
import { THEME_PRESETS, THEME_PRESET_NAMES, type ThemePreset } from './components/theme-presets.ts'
import { contentText, parseArguments } from './components/content.ts'
import {
  cacheHitRate,
  formatTokens,
  recordEventUsage,
  sessionTokens,
} from './chat/tokens.ts'
import {
  fadeGlyph,
  formatQueuedStatus,
  formatStatusDuration,
  openStepPhase,
  openTurn,
  pulseLevel,
  runningPhaseGlyph,
  STATUS_ANIMATION_INTERVAL_MS,
  STATUS_FADE_MS,
  TIMING_BUCKET_GLYPHS,
  TOOL_SPINNER_FRAMES,
  TOOL_SPINNER_INTERVAL_MS,
  type StepPosition,
} from './chat/timing.ts'
import {
  resolveTuiConfig,
  type Config,
} from './config.ts'
import {
  ContextCardComponent,
  type ToolCardVisibility,
  HeaderComponent,
  StreamingAssistantComponent,
  ToolCardComponent,
  TodoComponent,
  UserMessageComponent,
} from './components/transcript.ts'
import { FramedEditorComponent } from './components/framed-editor.ts'
import { NoticeSlotComponent, type NoticeKind } from './components/notice-slot.ts'
import { WorkingLineComponent } from './components/working-line.ts'
import { logoFullWidth, logoSingleWordWidth, SHIMMER_INTERVAL_MS, SHIMMER_WIDTH } from './components/logo.ts'
import { pickSpinnerVerb } from './chat/spinner-verbs.ts'
import { contextPressureLevel } from './chat/context-pressure.ts'
import {
  compactTargetLabel,
  ConfirmDialog,
  contextMeter,
  DetailsDialog,
  diagnosticMeter,
  formatDiagnosticCount,
  formatDiagnosticNumber,
  formatDiagnosticTime,
  initialTarget,
  StatusCardComponent,
  PromptContextComponent,
  RenameDialog,
  targetLabel,
  ThemeDialog,
  type DetailsSelection,
  type StatusCardRow,
} from './components/dialogs.ts'
import {
  parseSkillCommand,
  renderSkillInvocation,
  SKILL_COMMAND_PREFIX,
} from './chat/skill-invocation.ts'
import { ReferenceAutocompleteProvider } from './chat/autocomplete.ts'
import {
  BANNER_REVEAL_INTERVAL_MS,
  BANNER_REVEAL_STEPS,
  formatCwd,
  gitBranch,
  HintEditor,
  isCompactCheckpoint,
  sessionReferenceCard,
  transcriptToolCallIds,
} from './chat/helpers.ts'
import {
  createModelController,
  type ModelController,
} from './chat/model-command.ts'
import { createApprovalAnswerer } from './chat/approval.ts'
import { createGoalBar } from './chat/goal-bar.ts'
import { createPermissionController } from './chat/permission.ts'
import { createQuestionQueue } from './chat/questions.ts'
import { createQueueDock, replaceQueuedMessage } from './chat/queue-dock.ts'
import { forkSession } from './chat/fork.ts'
import {
  agentsLines,
  contextLines,
  jobsLines,
  openStaticDialog,
  settingsLines,
  statsStrip,
  writeExport,
  type InsightsDeps,
} from './chat/insights.ts'
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { createResumeController } from './chat/resume.ts'
import type { TuiResumeHost, TuiRuntime } from './runtime.ts'
import { WorkspaceFileSearch } from './chat/file-autocomplete.ts'

export { TuiPromptService } from './prompt.ts'
export { renderSkillInvocation } from './chat/skill-invocation.ts'
export type { TuiResumeHost, TuiRuntime } from './runtime.ts'
export {
  resolveTuiConfig,
  TuiConfigSchema,
  Config,
  type ResolvedTuiConfig,
  type ResolvedTuiThemeConfig,
  type TuiConfig,
  type TuiThemeConfig,
} from './config.ts'
export {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
} from './chat/file-autocomplete.ts'

export type {
  TuiComponent,
  TuiFocusable,
  TuiOverlayAnchor,
  TuiOverlayCloseReason,
  TuiOverlayHost,
  TuiOverlayMargin,
  TuiOverlayOptions,
  TuiOverlayOutcome,
  TuiOverlayRequest,
  TuiOverlaySession,
  TuiOverlayState,
  TuiTheme,
  TuiViewport,
} from './extension/types.ts'

/** First terminal Cordis state: FAILED, DISPOSED, and UNLOADING are unusable. */
const FIBER_FAILED = 3 as FiberState.FAILED

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Terminal-only interaction service, available only while a TUI is mounted. */
    tui: TuiExtensionService
    /** Optional process host that can replace this TUI with a resumed session. */
    tuiResumeHost: TuiResumeHost
    /** Launcher-owned `main` session identity; absent lets the app mint one. */
    mainSessionId: MainSessionIdentity | undefined
    /** Line the launcher wants printed on exit; absent prints nothing. */
    tuiGoodbyeMessage: string | undefined
    /** Skill the launcher wants auto-invoked as the fresh session's first turn; absent leaves it to the user. */
    tuiInitialSkill: string | undefined
  }
}

/** Launcher-chosen identity for the app's `main` session. */
export interface MainSessionIdentity {
  /** Exact session id `main` binds to. */
  readonly id: SessionId
  /**
   * Whether that session already has persisted history to load. `true` requires
   * an existing log and fails loud when absent; `false` creates it fresh.
   */
  readonly resume: boolean
}

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(MAIN_SESSION_ID_KEY, identity)`) to fix the `main` agent's
 * session identity, so an app bundle mounted from a `cordis.yml` binds a
 * launcher-selected session without a config key. `ctx.provide` is the only
 * channel from launcher argv into a Loader-mounted plugin, because config
 * `!!js` expressions evaluate against the entry's context. Absent leaves the
 * choice to the app.
 */
export const MAIN_SESSION_ID_KEY = 'mainSessionId'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(TUI_GOODBYE_MESSAGE_KEY, line)`) to supply the line the TUI
 * prints once the terminal is released on exit — for the shipped CLI, the
 * command that resumes this session. The launcher owns the wording because only
 * it knows how it was invoked; the TUI escapes terminal controls before
 * rendering. Absent prints nothing.
 */
export const TUI_GOODBYE_MESSAGE_KEY = 'tuiGoodbyeMessage'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(INITIAL_SKILL_KEY, name)`) to seed a fresh session's first user
 * turn with `/skill:<name>` — the `dsh migrate`/`dsh upgrade`
 * guided-session entry. The launcher sets it only when minting a fresh session,
 * so it never re-fires on a resumed one. Absent leaves the first turn to the user.
 */
export const INITIAL_SKILL_KEY = 'tuiInitialSkill'

/**
 * Optional terminal-local interaction service provided by one mounted TUI.
 *
 * The concrete provider retains pi-tui, focus, and terminal lifecycle state.
 * Plugins receive only effect-owned overlay sessions.
 */
export abstract class TuiExtensionService extends Service {
  /** Exact agent driven by this terminal instance. */
  abstract readonly agent: Agent

  /**
   * Queue an interactive overlay owned by the calling plugin fiber.
   *
   * The TUI displays one overlay at a time in FIFO order. Disposing the caller
   * removes a queued overlay or closes an active one before plugin teardown
   * settles. This live presentation is neither logged nor replayed.
   *
   * @param request - component factory, layout constraints, and cancellation.
   * @returns the effect-owned overlay session.
   * @throws when the TUI has begun shutting down.
   */
  abstract openOverlay(request: TuiOverlayRequest): TuiOverlaySession
}

export const name = 'ui-tui'
export const inject = ['agents', 'sessions', 'commands', 'userQuestions', 'tools', 'llm', 'systemPrompt', 'tokenMeter', 'tuiPrompt']

/** Model guidance for path-only file references selected through the TUI. */
export const FILE_REFERENCE_PROMPT = 'Paths prefixed with @ are files explicitly referenced by the user. Use the read tool when their contents are needed; do not claim to have inspected a file before reading it.'

/**
 * Transcript row standing in for one compacted range. The conversation the
 * compaction replaced stays rendered above it: the marker reports where the
 * model stopped seeing that history, not that the history is gone.
 */
const COMPACTION_MARKER = '… earlier context was compacted …'

interface RunningStatus {
  turn: number | undefined
  timer: ReturnType<typeof setInterval>
  /** Render clock when the turn began; origin of the glyph fade-in. */
  startedAt: number
  /** The most recently rendered phase glyph, handed to the fade-out. */
  lastGlyph: string
}

/** A running glyph fading out after its turn ended, before the caret returns. */
interface FadingStatus {
  glyph: string
  /** Render clock when the turn ended; origin of the glyph fade-out. */
  endedAt: number
  timer: ReturnType<typeof setInterval>
}

/** Width/height adapter for a modal component rendered inside the base TUI flow. */
class InlineModalComponent extends Container {
  constructor(
    component: Component,
    private readonly width: number,
    private readonly maxHeight: number,
  ) {
    super()
    this.addChild(component)
  }

  override render(width: number): string[] {
    const lines = super.render(Math.max(1, Math.min(width, this.width)))
    return lines.slice(0, Math.max(1, this.maxHeight))
  }
}

/** Lifecycle handle for a mounted interactive terminal channel. */
export interface TuiController {
  /** Stop rendering, restore the terminal, and reject pending questions. */
  dispose(): Promise<void>
}

/**
 * Start the interactive pi-tui channel for an already-created target agent.
 * @param ctx - agent, tools, session-event, and user-interaction context.
 * @param config - target agent, banner, and TUI presentation config.
 * @param runtime - terminal and process-exit boundary.
 * @returns lifecycle controller used by the Cordis effect disposer.
 */
export function createTuiChat(
  ctx: Context,
  config: Config,
  runtime: TuiRuntime,
): TuiController {
  const sessionId = SessionId(config.sessionId ?? 'main')
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`ui-tui: session "${sessionId}" is not running`)
  const resolved = resolveTuiConfig(config)
  // Named-theme state: `undefined` is the adaptive `deepseek` default.
  const initialPreset = resolved.theme.name === 'deepseek' ? undefined : THEME_PRESETS[resolved.theme.name]
  let currentPreset: ThemePreset | undefined = initialPreset
  let currentThemeName = initialPreset === undefined ? 'deepseek' : resolved.theme.name
  const paletteOptions = (): { preset?: ThemePreset; truecolor?: boolean } => currentPreset === undefined
    ? {}
    : { preset: currentPreset, truecolor: resolved.theme.truecolor }
  const palette = createPalette(resolved.theme.color, 'dark', paletteOptions())
  // The highlighter reads the live palette per call; once the lazily-loaded
  // module lands, blocks that rendered plain get a transcript rebuild.
  const codeHighlighter = createCodeHighlighter(palette, resolved.theme.color, () => {
    if (!disposed) rebuildTranscript(false)
  })
  const mdTheme = markdownTheme(palette, codeHighlighter.highlightCode)
  codeHighlighter.preload()
  const ui = new TUI(runtime.terminal, resolved.showHardwareCursor)
  const chat = new Container()
  const todoContainer = new Container()
  const questionContainer = new Container()
  const inputTemplate = parseTuiPromptTemplate(displayInlineText(resolved.theme.inputPrompt))
  const renderInputPrompt = (): string => renderTuiPromptTemplate(inputTemplate, valueName => ctx.tuiPrompt.get(valueName))
  const initialInputPrompt = renderInputPrompt()
  const editor = new HintEditor(ui, {
    borderColor: palette.dim,
    selectList: selectTheme(palette),
  } satisfies EditorTheme, {
    paddingX: 1,
    frame: 'none',
    prompt: {
      first: initialInputPrompt,
      continuation: ' '.repeat(visibleWidth(initialInputPrompt)),
    },
  })
  editor.hintPrefix = initialInputPrompt
  const todo = new TodoComponent(palette)
  const compactionStatusLine = new Text('', 0, 0)
  let showReasoning = resolved.showReasoning
  // Ctrl+O cycles collapsed -> expanded -> hidden. Codex-style: hidden drops
  // tool cards entirely, collapsed previews, expanded shows full bodies.
  let toolsVisibility: ToolCardVisibility = 'collapsed'
  let streaming: StreamingAssistantComponent | undefined
  let completedStreaming: StreamingAssistantComponent | undefined
  // Assistant step components in model order per turn, for hidden-mode folding:
  // with tool cards hidden, a turn keeps one Assistant header and later steps
  // render as headerless continuations (see applyTurnFolding).
  const assistantSteps = new Map<number, StreamingAssistantComponent[]>()
  let runningStatus: RunningStatus | undefined
  let fadingStatus: FadingStatus | undefined
  /**
   * Live standalone compaction observed by this process. Never derive this
   * state from history: a resumed log may contain a stale orphaned start.
   */
  let compacting: {
    startedAt: number
    timer: ReturnType<typeof setInterval>
  } | undefined
  // TUI steering submissions that the inbox has not yet claimed or discarded.
  // Correlation ids avoid guessing whether a running-state submission actually
  // joined steering or fell back to the queued-turn FIFO during turn close.
  const pendingSteering = new Set<MessageId>()
  let disposed = false
  let shuttingDown: Promise<void> | undefined
  // Optional: skills mount conditionally, so read the global service store
  // rather than declaring an injection that would make the TUI require them.
  const skills = ctx.get('skills')
  const cwd = agent.session.header.cwd ?? process.cwd()
  const fileSearch = new WorkspaceFileSearch(cwd, {
    maxResults: resolved.fileSearchMaxResults,
    maxEntries: resolved.fileSearchMaxEntries,
    excludedDirectories: resolved.fileSearchExcludedDirectories,
  })
  const skillAbort = new AbortController()
  const tokens = sessionTokens(agent.session)
  const toolCards = new Map<string, ToolCardComponent>()
  const allToolCards = new Set<ToolCardComponent>()
  const contextCards = new Set<ContextCardComponent>()
  const liveErrors = new Set<string>()
  const commandControllers = new Set<AbortController>()
  const referenceControllers = new Set<AbortController>()
  let tuiServiceFiber: Fiber | undefined
  const target: ModelSelectionRef = { current: initialTarget(agent), assembled: undefined }
  // `updatePromptValues` (defined below) closes over the model controller, but
  // the controller needs `appendNotice`/`overlayManager`, defined after that
  // closure. Declare here, assign once after those exist, and defer the first
  // `updatePromptValues()` call until after the assignment so no read precedes it.
  // oxlint-disable-next-line prefer-const -- single assignment is a forward-reference, not a const.
  let modelController!: ModelController
  const now = (): number => runtime.now?.() ?? Date.now()
  const agentStatus = (): AgentStatus => agent.status
  const isDisposed = (): boolean => disposed

  // A configured subtitle renders as a banner line; when absent, the banner has
  // no subtitle. The banner itself sweeps in on start (see startBannerReveal).
  let sessionTitle = foldSessionTitle(agent.session.events)?.title
  const header = new HeaderComponent(
    () => sessionTitle ?? config.welcome,
    palette,
    resolved.theme.color && resolved.theme.truecolor,
  )
  const formattedCwd = displayText(runtime.formatCwd?.(agent.session.header.cwd) ?? formatCwd(agent.session.header.cwd))
  const branch = runtime.gitBranch?.(cwd) ?? gitBranch(cwd)
  const promptValues: TuiPromptValueHandle[] = [
    ctx.tuiPrompt.register('cwd', palette.bold(palette.accent(formattedCwd))),
    ctx.tuiPrompt.register('git/worktree', branch === undefined ? undefined : palette.dim(` (${displayText(branch)})`)),
    ctx.tuiPrompt.register('token_meter/cache_hit_rate'),
    ctx.tuiPrompt.register('model'),
    ctx.tuiPrompt.register('context'),
    ctx.tuiPrompt.register('queued'),
    ctx.tuiPrompt.register('symbol', palette.bold(palette.accent('dsh'))),
    ctx.tuiPrompt.register('indicator', palette.dim('> ')),
    ctx.tuiPrompt.register('permission'),
    ctx.tuiPrompt.register('plan'),
    ctx.tuiPrompt.register('stats'),
  ]
  const [
    cwdValue, gitValue, tokenValue, modelValue, contextValue, queuedValue,
    symbolValue, indicatorValue, permissionValue, planValue, statsValue,
  ] = promptValues
  /* v8 ignore next -- the fixed built-in registration list always supplies each handle. */
  if (cwdValue === undefined || gitValue === undefined || tokenValue === undefined || modelValue === undefined
    || contextValue === undefined || queuedValue === undefined || symbolValue === undefined || indicatorValue === undefined
    || permissionValue === undefined || planValue === undefined || statsValue === undefined) {
    throw new Error('TUI prompt built-ins failed to initialize')
  }
  /**
   * The context-pressure projection when the projection registry is mounted
   * (the base bundle always mounts it): projected next-request tokens over the
   * route's context window. Absent, callers fall back to the token-meter
   * measure the footer already uses.
   */
  const contextPressure = (): { projectedTokens?: number; pressureTokens?: number; contextWindow?: number } | undefined => {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) return undefined
    try {
      const snapshot = (projections as {
        snapshot?: (session: unknown) => { values?: Record<string, unknown> } | undefined
      }).snapshot?.(agent.session)
      const pressure = snapshot?.values?.contextPressure
      return pressure === undefined ? undefined : pressure as NonNullable<ReturnType<typeof contextPressure>>
    } catch {
      // An unavailable projection never breaks the prompt footer.
      return undefined
    }
  }

  const updatePromptValues = (): void => {
    const renderTime = now()
    cwdValue.set(palette.bold(palette.accent(formattedCwd)))
    gitValue.set(branch === undefined ? undefined : palette.dim(` (${displayText(branch)})`))
    const rate = cacheHitRate(tokens)
    const usage = `↑${formatTokens(tokens.input)} ↓${formatTokens(tokens.output)}`
    modelValue.set(`  ${palette.dim(displayText(target.current === undefined ? 'model unset' : compactTargetLabel(target.current)))}`)
    tokenValue.set(`  ${palette.dim(rate === undefined ? usage : `${usage}  cache ${rate}%`)}`)
    const pressure = contextPressure()
    const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
      ?? ctx.tokenMeter.measure(agent.session).totalTokens
    const effectiveWindow = pressure?.contextWindow ?? modelController.contextWindow()
    const occupancy = effectiveWindow === undefined || effectiveWindow <= 0
      ? undefined
      : Math.min(100, usedTokens / effectiveWindow * 100)
    if (occupancy === undefined) {
      contextValue.set(undefined)
    } else {
      // The meter segments and the percent number share the pressure color
      // (dim → warning → error); the surrounding text stays dim. Colored
      // pieces are concatenated rather than nested (single-Colored rule).
      const level = contextPressureLevel(occupancy)
      const percentText = `${Math.round(occupancy)}%`
      const percent = level === 'critical'
        ? palette.error(percentText)
        : level === 'warning'
          ? palette.warning(percentText)
          : palette.dim(percentText)
      contextValue.set(`  ${contextMeter(occupancy, palette)} ${percent}${palette.dim(' context')}`)
    }
    const queued = runningStatus === undefined ? undefined : formatQueuedStatus(pendingSteering.size)
    queuedValue.set(queued === undefined ? undefined : palette.dim(queued))
    // Shift+Tab's preset ring and the plan-mode chip; absent services render nothing.
    const preset = permissionController.chip()
    permissionValue.set(preset === undefined || preset === 'custom' ? undefined : palette.dim(` [${preset}]`))
    planValue.set(foldPlanMode(agent.session.events)
      ? palette.bold(palette.accent(' ⎇ plan'))
      : undefined)
    const stats = statsStrip(insights)
    statsValue.set(stats === undefined ? undefined : palette.dim(`  ${stats}`))
    symbolValue.set(palette.bold(palette.accent('dsh')))
    compactionStatusLine.setText(compacting !== undefined
      ? palette.dim(`Context being compacted ${formatStatusDuration(renderTime - compacting.startedAt)}`)
      : occupancy !== undefined && contextPressureLevel(occupancy) === 'critical'
        ? palette.error(`Context low · ${Math.round(occupancy)}% used · run /compact to free space`)
        : '')
    // `${indicator}` owns the caret column and its trailing gap before the
    // cursor. The active status glyph replaces the `>` caret in place — same
    // width every frame — fading in when work starts, throbbing while it runs,
    // and fading out after it ends before the plain `>` returns. Only the gray
    // brightness changes, so the cursor never shifts.
    const statusGlyph = runningPhaseGlyph(
      agent.session.events,
      runningStatus !== undefined,
      compacting !== undefined,
    )
    // Remember the live phase glyph so the fade-out shows it, not the ttft
    // fallback the derivation returns once the closing turn's step has ended.
    if (runningStatus !== undefined && statusGlyph !== undefined) runningStatus.lastGlyph = statusGlyph
    // The fade envelope gates appear/disappear; the active throb breathes the
    // glyph throughout the operation. Truecolor opacity is envelope × throb; the
    // non-truecolor fallback keys visibility off the envelope alone, so the
    // throb never blinks it. `envelope` clamps to [0, 1].
    const activeSince = runningStatus?.startedAt ?? compacting?.startedAt
    const envelope = activeSince !== undefined && statusGlyph !== undefined
      ? { glyph: statusGlyph, level: Math.min(1, (renderTime - activeSince) / STATUS_FADE_MS) }
      : fadingStatus !== undefined
        ? { glyph: fadingStatus.glyph, level: Math.max(0, 1 - (renderTime - fadingStatus.endedAt) / STATUS_FADE_MS) }
        : undefined
    const caret = envelope === undefined
      ? palette.dim('>')
      : fadeGlyph(
        envelope.glyph,
        palette,
        resolved.theme.color,
        resolved.theme.color && resolved.theme.truecolor,
        envelope.level * pulseLevel(renderTime),
        envelope.level >= 0.5,
      )
    indicatorValue.set(`${caret}${palette.dim(' ')}`)
  }
  const promptContext = new PromptContextComponent(
    parseTuiPromptTemplate(displayInlineText(resolved.theme.leftPrompt)),
    parseTuiPromptTemplate(displayInlineText(resolved.theme.rightPrompt)),
    valueName => ctx.tuiPrompt.get(valueName),
  )
  ui.addChild(header)
  ui.addChild(chat)
  ui.addChild(new Spacer(1))
  todoContainer.addChild(todo)
  ui.addChild(todoContainer)
  // Docks (goal bar, steering queue) mount into this slot in order once their
  // controllers exist; an empty container renders nothing.
  const docks = new Container()
  ui.addChild(docks)
  ui.addChild(compactionStatusLine)
  ui.addChild(questionContainer)
  // Claude Code chrome: the working status line sits directly above the
  // rounded input box, and the prompt's context row moves below it.
  const workingLine = new WorkingLineComponent(palette, now)
  ui.addChild(workingLine)
  const editorFrame = new FramedEditorComponent(editor)
  ui.addChild(editorFrame)
  ui.addChild(promptContext)
  ui.setFocus(editor)
  const updateTerminalTitle = (): void => {
    runtime.terminal.setTitle(displayText(
      sessionTitle === undefined ? resolved.title : `${sessionTitle} — ${resolved.title}`,
    ))
  }
  updateTerminalTitle()

  const requestRender = (): void => {
    if (disposed) return
    updatePromptValues()
    const inputPrompt = renderInputPrompt()
    editor.setPrompt({ first: inputPrompt, continuation: ' '.repeat(visibleWidth(inputPrompt)) })
    editor.hintPrefix = inputPrompt
    promptContext.invalidate()
    ui.requestRender()
  }
  // A prompt value that changes on its own schedule (e.g. a plugin-owned
  // `${custom}` fragment) redraws through the registry's coalesced notification;
  // built-ins are already covered by the state-change callers of requestRender.
  const disposePromptChanges = ctx.tuiPrompt.subscribe(requestRender)

  const appendNotice = (message: string, kind: 'info' | 'warning' | 'error' = 'info'): void => {
    const color = kind === 'error' ? palette.error : kind === 'warning' ? palette.warning : palette.dim
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(color(displayText(message)), 0, 0))
    requestRender()
  }

  // Claude Code's Notifications slot: one transient row at the very bottom for
  // lightweight operation receipts (state-switch feedback) that must not
  // pollute the durable transcript. Errors, warnings, and anything the user
  // may need to scroll back to keep going through appendNotice.
  const noticeSlot = new NoticeSlotComponent(palette, requestRender)
  ui.addChild(noticeSlot)
  const showTransientNotice = (message: string, kind: NoticeKind = 'info'): void => {
    noticeSlot.show(message, kind)
  }

  const extensionTheme: TuiTheme = Object.freeze({
    text: (value: string) => palette.text(value),
    brand: (value: string) => resolved.theme.color
      ? resolved.theme.truecolor ? brandText(value) : palette.brand(value)
      : value,
    dim: (value: string) => palette.dim(value),
    accent: (value: string) => palette.accent(value),
    success: (value: string) => palette.success(value),
    warning: (value: string) => palette.warning(value),
    error: (value: string) => palette.error(value),
    bold: (value: string) => palette.bold(value),
  })
  const overlayManager = new TuiOverlayManager({
    viewport: () => Object.freeze({
      columns: runtime.terminal.columns,
      rows: runtime.terminal.rows,
    }),
    theme: () => extensionTheme,
    display: displayText,
    show: (component, options, placement) => {
      if (placement === 'overlay') {
        return ui.showOverlay(component, options === undefined
          ? undefined
          : {
            ...options,
            ...typeof options.margin === 'object'
              ? { margin: { ...options.margin } }
              : {},
          })
      }
      const modal = new InlineModalComponent(
        component,
        resolved.questionDialogWidth,
        resolved.questionDialogMaxHeight,
      )
      questionContainer.clear()
      questionContainer.addChild(modal)
      ui.setFocus(component)
      return {
        hide(): void {
          questionContainer.clear()
          ui.setFocus(editor)
        },
      }
    },
    invalidate: requestRender,
    reportError: (error) => {
      const message = errorChain(error)
      ctx.logger.warn(`ui-tui: overlay failed: ${message}`)
      /* v8 ignore next -- shutdown removes overlays before the terminal stops */
      if (disposed) return
      appendNotice(`TUI overlay failed: ${message}`, 'error')
    },
  })

  const disposeTargetListeners = installModelSelection(agent.ctx, target)

  modelController = createModelController({
    ctx,
    resolved,
    palette,
    overlayManager,
    target,
    appendNotice,
    requestRender,
    isDisposed,
  })

  // Shift+Tab preset ring with the danger-preset risk confirmation overlay.
  const permissionController = createPermissionController({
    ctx, resolved, palette, overlayManager, requestRender, isDisposed, appendNotice, agent,
    confirmRisk: (message, onChoice) => {
      const session = overlayManager.open({
        create: () => new ConfirmDialog(
          'Full access',
          message,
          palette,
          onChoice,
          () => { void session.close() },
        ),
        options: { width: 64, anchor: 'center', margin: 1 },
      })
      requestRender()
    },
  })

  // The goal dock (Ctrl+G actions) and the steering queue dock (/queue sheet).
  const goalBar = createGoalBar({ ctx, resolved, palette, overlayManager, requestRender, isDisposed, appendNotice, agent })
  const queueDock = createQueueDock({
    ctx, resolved, palette, overlayManager, requestRender, isDisposed, appendNotice, agent,
    loadIntoEditor: (text) => {
      editor.setText(text)
      requestRender()
    },
    showTransientNotice,
  })
  docks.addChild(goalBar.component)
  docks.addChild(queueDock.component)

  // Insight surfaces (/context, /agents, /jobs, /settings, /export, stats strip).
  const insights: InsightsDeps = { ctx, resolved, palette, overlayManager, requestRender, isDisposed, appendNotice, agent }

  /** Resolve one stored image attachment's bytes through the optional store. */
  const loadAttachmentImage = (attachmentId: string): Promise<Uint8Array | undefined> => {
    const attachments = ctx.get('attachments') as {
      readImage?: (ref: { attachmentId: string; mediaType: string }, signal?: AbortSignal) => Promise<{ data: Uint8Array }>
    } | undefined
    if (attachments?.readImage === undefined) return Promise.resolve(undefined)
    return attachments.readImage({ attachmentId, mediaType: 'image/png' }).then(
      stored => stored.data,
      () => undefined,
    )
  }

  updatePromptValues()

  const renderStatus = (): void => {
    streaming?.invalidate()
    requestRender()
  }

  /** Stop the turn-phase running and fade-out timers and drop both states. */
  const clearTurnStatus = (): void => {
    if (runningStatus !== undefined) {
      clearInterval(runningStatus.timer)
      runningStatus = undefined
    }
    if (fadingStatus !== undefined) {
      clearInterval(fadingStatus.timer)
      fadingStatus = undefined
    }
    runtime.terminal.setProgress(compacting !== undefined)
  }

  /** Hard clear: drop every indicator, including a live compaction bracket. */
  const clearStatus = (): void => {
    if (compacting !== undefined) {
      clearInterval(compacting.timer)
      compacting = undefined
    }
    clearTurnStatus()
  }

  /**
   * Hand the last active glyph to a fade-out that re-renders until it settles
   * on the `>` caret, then stops its own timer. A hard clear (teardown) skips
   * this via {@link clearStatus}.
   */
  const beginFadeOut = (glyph: string): void => {
    clearTurnStatus()
    const fading: FadingStatus = {
      glyph,
      endedAt: now(),
      timer: setInterval(() => {
        if (now() - fading.endedAt >= STATUS_FADE_MS) clearTurnStatus()
        renderStatus()
      }, STATUS_ANIMATION_INTERVAL_MS),
    }
    fadingStatus = fading
  }

  /** Status-priority placeholder text for the empty editor (dim; the hint editor paints it). */
  const editorHintFor = (status: AgentStatus): string => {
    if (status === 'running') return palette.dim(displayInlineText(resolved.theme.inputPlaceholder))
    if (foldPlanMode(agent.session.events)) {
      return palette.dim('plan mode — present a plan; the review runs before any edit')
    }
    // Queued messages are more actionable than examples: ↑ pops the newest
    // one back into the editor (see the input listener's Key.up branch).
    if (queueDock.pendingCount() > 0) return palette.dim('press ↑ to edit queued messages')
    return palette.dim('type / for commands, @ for files')
  }

  /**
   * Re-derive the editor placeholder from the live status, plan mode, and
   * queue. The Ctrl+C/Ctrl+D exit arm hint outranks every status-derived hint
   * for the lifetime of its window; the disarm timeout re-applies this.
   */
  const applyEditorHint = (): void => {
    if (exitArmedAt !== undefined) return
    editor.hint = editorHintFor(agent.status)
  }

  /**
   * Re-derive the queue dock from the inbox and refresh the editor hint with
   * it: the queue-emptying/queue-filling edge is exactly when the idle
   * placeholder flips between the queue hint and the examples hint.
   */
  const refreshQueueDock = (): void => {
    queueDock.refresh()
    applyEditorHint()
  }

  const setStatus = (status: AgentStatus): void => {
    const priorTurn = runningStatus?.turn
    const fadeOutGlyph = status !== 'running' ? runningStatus?.lastGlyph : undefined
    if (status === 'running') clearTurnStatus()
    else if (fadeOutGlyph !== undefined) beginFadeOut(fadeOutGlyph)
    else clearTurnStatus()
    editor.borderColor = status === 'running' ? text => palette.accent(text) : text => palette.dim(text)
    // Running keeps the steering placeholder; idle plan mode carries its own;
    // plain idle carries the queue hint or the example-commands hint.
    applyEditorHint()
    if (status === 'running') {
      const turn = priorTurn ?? openTurn(agent.session.events)
      const running: RunningStatus = {
        turn,
        startedAt: now(),
        // Seed with the current phase (ttft before the first step opens) so the
        // fade-out always has a glyph, even for a turn that ends before a render.
        lastGlyph: TIMING_BUCKET_GLYPHS[openStepPhase(agent.session.events) ?? 'ttft'],
        // Refresh every tick so the fading prompt phase glyph animates even
        // before the first token, when no streaming component exists yet.
        timer: setInterval(renderStatus, STATUS_ANIMATION_INTERVAL_MS),
      }
      runningStatus = running
      runtime.terminal.setProgress(true)
      // Show the working line immediately; the spinner tick takes over on its
      // first frame (≤100 ms later).
      workingLine.update(true, running.startedAt, undefined, undefined)
    }
    requestRender()
  }

  const refreshStatus = (): void => {
    renderStatus()
  }

  const parsedTool = (event: Extract<SessionEvent, { type: 'tool/call' }>): ToolCardComponent => {
    const parsed = parseArguments(event.data.arguments)
    const card = new ToolCardComponent(
      event.data.name,
      parsed,
      ctx.tools.get(event.data.name, agent),
      resolved.maxToolOutputLines,
      resolved.maxDiffEditLength,
      palette,
      mdTheme,
      event.time,
    )
    card.setVisibility(toolsVisibility)
    toolCards.set(event.data.callId, card)
    allToolCards.add(card)
    return card
  }

  // One process-wide spinner tick: the newest pending tool card animates its
  // braille frame, and the working line above the input mirrors the same
  // frame plus the call's verb label. While nothing pends (or the agent is
  // idle) the card update is skipped; the working line itself renders empty
  // when idle, so the tick is effectively self-gating.
  let spinnerFrame = 0
  let workShown = false
  // Working-line extras: one random fun verb per turn (seeded off the turn
  // number so the word stays stable within a turn), streamed-token estimate
  // (chars/4) for the status segment, and the last stream output time for
  // the stall warning.
  const verbBase = Date.now() % 997
  let streamedChars = 0
  let lastOutputAt: number | undefined
  const spinnerTimer = setInterval(() => {
    if (disposed) return
    const frame = TOOL_SPINNER_FRAMES[spinnerFrame++ % TOOL_SPINNER_FRAMES.length] ?? TOOL_SPINNER_FRAMES[0]
    let pending: ToolCardComponent | undefined
    for (const card of allToolCards) {
      if (card.isPending()) pending = card
    }
    const running = runningStatus !== undefined || compacting !== undefined
    // Idle steady state (nothing pending, nothing running): the previous tick
    // already rendered the empty line, so skip — this keeps the timer free.
    if (pending === undefined && !running) {
      if (workShown) {
        workShown = false
        workingLine.update(false, undefined, undefined, undefined)
        requestRender()
      }
      return
    }
    workShown = true
    if (pending !== undefined) pending.setSpinner(frame)
    workingLine.update(
      running,
      runningStatus?.startedAt ?? compacting?.startedAt,
      pending?.label(),
      frame,
      {
        verb: pickSpinnerVerb(verbBase + (runningStatus?.turn ?? 0)),
        emittedTokens: Math.floor(streamedChars / 4),
        ...lastOutputAt === undefined ? {} : { lastOutputAt },
      },
    )
    requestRender()
  }, TOOL_SPINNER_INTERVAL_MS)

  /**
   * Re-derive hidden-mode folding for one turn: the first step with a visible
   * body owns the turn's single Assistant header, every other step renders as a
   * headerless continuation (empty ones render nothing). Any other visibility
   * restores the per-step headers.
   */
  const applyTurnFolding = (turn: number): void => {
    const steps = assistantSteps.get(turn)
    if (steps === undefined) return
    let headerSeen = false
    for (const step of steps) {
      if (toolsVisibility !== 'hidden') {
        step.setFoldedContinuation(false)
      } else if (!headerSeen && step.hasVisibleBody()) {
        headerSeen = true
        step.setFoldedContinuation(false)
      } else {
        step.setFoldedContinuation(true)
      }
    }
  }

  const registerAssistantStep = (component: StreamingAssistantComponent): void => {
    const steps = assistantSteps.get(component.position.turn) ?? []
    steps.push(component)
    assistantSteps.set(component.position.turn, steps)
    applyTurnFolding(component.position.turn)
  }

  const removeStreaming = (current: StreamingAssistantComponent | undefined): void => {
    if (current === undefined) return
    const index = chat.children.indexOf(current)
    /* v8 ignore next -- streaming components are retained only while attached to the chat. */
    if (index >= 0) chat.children.splice(index, 1)
    const steps = assistantSteps.get(current.position.turn)
    /* v8 ignore next -- every attached streaming component is registered in the fold map. */
    if (steps === undefined) return
    const stepIndex = steps.indexOf(current)
    /* v8 ignore next -- registration precedes attachment, so the component is present until this removal. */
    if (stepIndex < 0) return
    steps.splice(stepIndex, 1)
    // A retracted step may have owned the turn's hidden-mode header.
    applyTurnFolding(current.position.turn)
  }

  const clearStreaming = (): void => {
    removeStreaming(streaming)
    streaming = undefined
  }

  const retractFailedStreaming = (): void => {
    removeStreaming(streaming ?? completedStreaming)
    streaming = undefined
    completedStreaming = undefined
  }

  const startAssistantStep = (position: StepPosition, startedAt?: number): void => {
    streaming = new StreamingAssistantComponent(
      position,
      showReasoning,
      palette,
      mdTheme,
    )
    streaming.markStart(startedAt)
    registerAssistantStep(streaming)
    chat.addChild(streaming)
  }

  const renderEvent = (
    event: SessionEvent,
    options: {
      addHistory: boolean
      renderChunks: boolean
    },
  ): void => {
    switch (event.type) {
      case 'user/message': {
        // Injected context (plugin/goal source) renders as a dim context card,
        // not a human bubble; only a direct human prompt is a user message. The
        // boolean avoids narrowing `source`, so the label keeps its full union.
        const source = event.data.source
        if (source.kind !== 'user') {
          const references = sessionReferenceCard(event.data.source)
          if (references !== undefined) {
            chat.addChild(new Spacer(1))
            chat.addChild(new Text(palette.dim(`Referenced sessions · ${references.map(displayText).join(', ')}`), 0, 0))
            break
          }
          const text = contentText(event.data.content).trim()
          /* v8 ignore next -- context events with empty content are rejected by their owning producers. */
          if (text) {
            // The tui type view lacks plugin-augmented source kinds (e.g. goal),
            // so read the display label without narrowing on `kind`. The session
            // log is a durable/replay boundary: a corrupt or foreign injected
            // source may not match the typed shape, so fall back to `context`.
            const labelled = source as { kind?: unknown; plugin?: unknown }
            const label = typeof labelled.plugin === 'string' ? labelled.plugin
              : typeof labelled.kind === 'string' ? labelled.kind
                : 'context'
            const card = new ContextCardComponent(label, text, resolved.maxToolOutputLines, palette)
            card.setExpanded(toolsVisibility === 'expanded')
            contextCards.add(card)
            chat.addChild(new Spacer(1))
            chat.addChild(card)
          }
          break
        }
        const text = displayText(contentText(event.data.content).trim())
        const images = event.data.content
          .filter((block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image')
          .map(block => ({ attachmentId: String(block.attachment.attachmentId), mediaType: block.attachment.mediaType }))
        if (text || images.length > 0) {
          chat.addChild(new Spacer(1))
          chat.addChild(new UserMessageComponent(text, palette, images, loadAttachmentImage))
          if (options.addHistory && text) editor.addToHistory(text)
        }
        break
      }
      case 'step/start':
        startAssistantStep(event.data, event.time)
        break
      case 'assistant/chunk':
        // Working-line extras: every streamed character feeds the token
        // estimate and refreshes the stall clock, regardless of whether this
        // pass renders the chunk.
        {
          const chunk = event.data.chunk
          if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') streamedChars += chunk.text.length
          lastOutputAt = event.time
        }
        if (options.renderChunks && streaming !== undefined) {
          streaming.update(event.data.chunk)
          // The first streamed text/reasoning may make this step the turn's
          // hidden-mode header owner (or a continuation with a visible body).
          applyTurnFolding(streaming.position.turn)
        }
        break
      case 'assistant/message':
        completedStreaming = undefined
        // A settled component stays attached but never absorbs a later message
        // of the same step; both the live and replay paths start a new one.
        if (streaming === undefined || streaming.isSettled() || !chat.children.includes(streaming)) {
          startAssistantStep(event.data, event.time)
        }
        if (streaming !== undefined) {
          streaming.settle(event.data.message.content, event.time)
          applyTurnFolding(streaming.position.turn)
        }
        break
      case 'llm/retry': {
        retractFailedStreaming()
        const retryLimit = event.data.mode === 'always' ? '∞' : String(event.data.maxRetries)
        appendNotice(
          `Retrying model request (${event.data.retry}/${retryLimit}) in ${event.data.delayMs}ms: ${event.data.failure.message}`,
          'warning',
        )
        break
      }
      // No external Spacer for tool cards: the card renders its own leading
      // gap, so the hidden state removes the row and the gap together.
      case 'tool/call':
        chat.addChild(parsedTool(event))
        break
      case 'tool/result': {
        const callId = event.data.message.source.callId
        let card = toolCards.get(callId)
        if (card === undefined) {
          card = new ToolCardComponent(
            'tool',
            { value: {}, valid: true },
            undefined,
            resolved.maxToolOutputLines,
            resolved.maxDiffEditLength,
            palette,
            mdTheme,
            event.time,
          )
          card.setVisibility(toolsVisibility)
          chat.addChild(card)
          allToolCards.add(card)
        }
        card.updateResult(event.data, event.time)
        toolCards.delete(callId)
        break
      }
      case 'todo/write':
        todo.update(event.data.todos)
        break
      case 'turn/start':
        // Plan strip is turn-scoped: keep it after turn/end for reading, clear on the next turn.
        todo.update([])
        streamedChars = 0
        lastOutputAt = undefined
        break
      case 'session/title':
        sessionTitle = event.data.title
        header.invalidate()
        updateTerminalTitle()
        break
      case 'step/end':
        if (streaming === undefined) startAssistantStep(event.data, event.time)
        completedStreaming = streaming
        streaming = undefined
        break
      // Every turn/end kind presents why the agent stopped: `completed` is
      // presented by the settled assistant message and its Completed timing
      // header; every other kind appends an explicit notice.
      case 'turn/end': {
        clearStreaming()
        const reason = event.data.reason
        switch (reason.kind) {
          case 'completed':
            break
          case 'error': {
            appendNotice(reason.error.message, 'error')
            break
          }
          case 'aborted':
            appendNotice('Turn cancelled.', 'warning')
            break
          case 'max-tokens':
            appendNotice('The model reached its output-token limit.', 'warning')
            break
          case 'interrupted':
            appendNotice('The previous process ended during this turn.', 'warning')
            break
          default:
            // TurnEndReasonMap is merge-extensible: a plugin-added outcome
            // still names why the agent stopped rather than ending silently.
            appendNotice(`Turn ended: ${(reason as { kind: string }).kind}.`, 'warning')
            break
        }
        break
      }
      default:
        break
    }
  }

  const renderCompactionMarker = (): void => {
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.dim(COMPACTION_MARKER), 0, 0))
  }

  /**
   * Replay the human transcript from the append-only log. The model-visible
   * surface shadows compacted ranges, so it is not the source here: every
   * append-origin message stays rendered, and a replacement contributes at most
   * the compaction marker at its own log position.
   *
   * The `tool/call` pairing check has no live counterpart, because only replay
   * can meet an orphan: `tool/call` carries no `surfaceOp` of its own, so it
   * inherits transcript membership from the `assistant/message` that advertised
   * it, which the live listener has necessarily just rendered. A loaded log is a
   * replay boundary, so the pairing is re-derived here instead of assumed.
   */
  const rebuildTranscript = (populateHistory: boolean): void => {
    chat.clear()
    toolCards.clear()
    allToolCards.clear()
    contextCards.clear()
    assistantSteps.clear()
    streaming = undefined
    todo.update([])
    const transcriptCalls = transcriptToolCallIds(agent.session)
    for (const event of agent.session.events) {
      if (isReplacementSurfaceEvent(event)) {
        if (isCompactCheckpoint(event)) renderCompactionMarker()
        continue
      }
      if (event.type === 'tool/call' && !transcriptCalls.has(event.data.callId)) continue
      renderEvent(event, { addHistory: populateHistory, renderChunks: false })
    }
    requestRender()
  }

  const questions = createQuestionQueue({
    ctx,
    resolved,
    palette,
    overlayManager,
    requestRender,
    isDisposed,
    questionMaxHeight: () => {
      const width = runtime.terminal.columns
      const editorRows = editor.render(width).length
      return Math.max(1, Math.min(
        resolved.questionDialogMaxHeight,
        runtime.terminal.rows - editorRows,
      ))
    },
  })

  // The keyboard answerer behind `approval/request` — without it, a tool call
  // the sandbox wants to ask about fails closed ("no approval channel").
  const approvals = createApprovalAnswerer({
    ctx,
    resolved,
    palette,
    overlayManager,
    requestRender,
    isDisposed,
    appendNotice,
    agent,
    questionMaxHeight: () => {
      const width = runtime.terminal.columns
      const editorRows = editor.render(width).length
      return Math.max(1, Math.min(
        resolved.questionDialogMaxHeight,
        runtime.terminal.rows - editorRows,
      ))
    },
    pendingCallLabel: callId => callId === undefined ? undefined : toolCards.get(callId)?.label(),
  })

  const resume = createResumeController({
    ctx,
    agent,
    runtime,
    resolved,
    palette,
    overlayManager,
    // Optional and independently mounted. Cordis transiently leaves this sibling
    // non-ACTIVE during command callbacks, so the non-strict read is intentional;
    // terminal fiber states still exclude failed, closing, and closed providers.
    sessionQuery: () => {
      const implementation = ctx.reflect._getImpl('sessionQuery', false)
      if (implementation === undefined || implementation.fiber.state >= FIBER_FAILED) return undefined
      return ctx.get('sessionQuery', false)
    },
    ui,
    editor,
    appendNotice,
    requestRender,
    isDisposed,
    agentStatus,
  })

  // Ctrl+C/Ctrl+D at an idle empty prompt require a second press within
  // EXIT_DOUBLE_PRESS_MS (the Claude Code convention) — a stray press shows a
  // dim hint on the editor instead of killing the session.
  const EXIT_DOUBLE_PRESS_MS = 800
  // Hard ceiling on the shutdown dispose chain before the exit fires anyway.
  const SHUTDOWN_EXIT_FALLBACK_MS = 3_000
  let exitArmedAt: number | undefined
  const doublePressExit = (key: string): void => {
    const pressedAt = now()
    if (exitArmedAt !== undefined && pressedAt - exitArmedAt <= EXIT_DOUBLE_PRESS_MS) {
      exitArmedAt = undefined
      editor.hint = undefined
      requestExit()
      return
    }
    exitArmedAt = pressedAt
    editor.hint = palette.dim(`press ${key} again to exit`)
    requestRender()
    setTimeout(() => {
      // Disarm quietly once the window lapses; restore the state-appropriate
      // placeholder (steer / plan / queue / examples).
      if (exitArmedAt !== undefined && now() - exitArmedAt >= EXIT_DOUBLE_PRESS_MS) {
        exitArmedAt = undefined
        applyEditorHint()
        requestRender()
      }
    }, EXIT_DOUBLE_PRESS_MS + 50)
  }

  const shutdown = (exitProcess: boolean): Promise<void> => {
    // The exit boundary is idempotent and reached from three places: the end
    // of the dispose chain, the chain's rejection, and a hard fallback timer
    // — a turn that ran can leave a dispose step unresolved, and the process
    // must never hang with the terminal already torn down.
    let exitedRuntime = false
    const finish = (): void => {
      if (!exitProcess || exitedRuntime) return
      exitedRuntime = true
      if (runtime.goodbyeMessage !== undefined) {
        runtime.terminal.write(`${palette.dim(displayText(runtime.goodbyeMessage))}\n`)
      }
      runtime.exit(0)
    }
    shuttingDown ??= (async () => {
      disposed = true
      overlayManager.beginShutdown()
      modelController.resetContextResolution()
      clearStatus()
      clearInterval(spinnerTimer)
      for (const controller of commandControllers) controller.abort(new Error('TUI disposed'))
      commandControllers.clear()
      for (const controller of referenceControllers) controller.abort(new Error('TUI disposed'))
      referenceControllers.clear()
      await tuiServiceFiber?.dispose()
      tuiServiceFiber = undefined
      approvals.drain()
      approvals.unregister()
      questions.rejectAll()
      await overlayManager.dispose()
      modelController.clearOverlay()
      questions.unregister()
      await runtime.terminal.drainInput(100, 20)
      ui.stop()
      finish()
    })()
    if (exitProcess) {
      void shuttingDown.catch(() => {}).then(finish)
      setTimeout(finish, SHUTDOWN_EXIT_FALLBACK_MS)
    }
    return shuttingDown
  }

  const requestExit = (): void => {
    if (agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      appendNotice('Cancelling the active turn before exit…', 'warning')
      void agent.whenIdle().then(() => shutdown(true))
      return
    }
    void shutdown(true)
  }

  /** Swap the palette and all derived themes for the given terminal color scheme. */
  const applyColorScheme = (scheme: TerminalColorScheme): void => {
    if (scheme === currentScheme) return
    currentScheme = scheme
    Object.assign(palette, createPalette(resolved.theme.color, scheme, paletteOptions()))
    Object.assign(mdTheme, markdownTheme(palette, codeHighlighter.highlightCode))
    // Rows cached under the prior palette's roles must not outlive it.
    codeHighlighter.invalidate()
    // `setStatus` below re-derives `editor.borderColor` from the new palette.
    rebuildTranscript(false)
    setStatus(agent.status)
    requestRender()
  }
  let currentScheme: TerminalColorScheme = 'dark'

  // Apply any color scheme the terminal reports. Registering before the query
  // below means even a synchronous reply reaches `applyColorScheme`; in practice
  // the startup query's reply is the only report, since dsh-tui leaves
  // unsolicited color-scheme notifications disabled.
  const disposeSchemeListener = ui.onTerminalColorSchemeChange(applyColorScheme)

  // Ask the terminal for its color scheme via device-status report; the reply,
  // if any, arrives through the listener above. Most terminals do not respond,
  // so we keep the dark-optimised palette. Swallow a query-write failure for the
  // same reason.
  ui.queryTerminalColorScheme({ timeoutMs: 2000 }).catch(() => {})

  const setToolsVisibility = (next: ToolCardVisibility): void => {
    toolsVisibility = next
    for (const card of allToolCards) card.setVisibility(toolsVisibility)
    // Context cards carry injected instructions rather than tool traffic, so
    // they never hide: the hidden phase reads as their collapsed preview.
    for (const card of contextCards) card.setExpanded(toolsVisibility === 'expanded')
    // Hidden mode folds each turn's steps into one assistant message; other
    // modes restore the per-step Assistant headers.
    for (const turn of assistantSteps.keys()) applyTurnFolding(turn)
    // State-switch feedback: transient receipt, not transcript history.
    showTransientNotice(toolsVisibility === 'hidden' ? 'Tool cards hidden.' : `Tool and context cards ${toolsVisibility}.`)
  }

  const toggleTools = (): void => {
    // The cycle order puts the two common reading modes adjacent: preview ->
    // full detail -> conversation-only, then back to the preview default.
    setToolsVisibility(toolsVisibility === 'collapsed' ? 'expanded'
      : toolsVisibility === 'expanded' ? 'hidden' : 'collapsed')
  }

  const setReasoning = (show: boolean): void => {
    showReasoning = show
    const activeStreaming = streaming
    rebuildTranscript(false)
    /* v8 ignore next -- the non-streaming command path is covered; this branch preserves an active stream across rebuild. */
    if (activeStreaming !== undefined) {
      streaming = activeStreaming
      streaming.setShowReasoning(showReasoning)
      registerAssistantStep(activeStreaming)
      chat.addChild(activeStreaming)
    }
    // State-switch feedback: transient receipt, not transcript history.
    showTransientNotice(`Reasoning ${showReasoning ? 'expanded' : 'collapsed'}.`)
  }

  const toggleReasoning = (): void => { setReasoning(!showReasoning) }

  // The selector and the argument grammar mutate the same closure state the
  // Ctrl+O cycle and Ctrl+R toggle drive, so every entry converges.
  let detailsOverlay: TuiOverlaySession | undefined
  const showDetailsSelector = (): void => {
    void detailsOverlay?.close()
    const session = overlayManager.open({
      create: () => new DetailsDialog(
        toolsVisibility,
        showReasoning,
        palette,
        // Each Tab applies immediately; one dimension changes per call.
        (selection: DetailsSelection) => {
          if (selection.showReasoning !== showReasoning) setReasoning(selection.showReasoning)
          if (selection.visibility !== toolsVisibility) setToolsVisibility(selection.visibility)
        },
        () => { void session.close() },
      ),
      options: { width: resolved.detailsDialogWidth, anchor: 'center', margin: 1 },
    })
    detailsOverlay = session
    void session.closed.then(() => {
      if (detailsOverlay === session) detailsOverlay = undefined
    })
    requestRender()
  }

  /**
   * Swap the active named theme in place: rebuild the palette and derived
   * themes over the SAME palette object (the whole component tree holds it),
   * invalidate highlight rows cached under the old roles, and re-render.
   */
  const applyTheme = (name: string): boolean => {
    const preset = THEME_PRESETS[name]
    if (preset === undefined) {
      appendNotice(`Unknown theme "${name}". Available: ${THEME_PRESET_NAMES.join(', ')}.`, 'warning')
      return false
    }
    currentPreset = name === 'deepseek' ? undefined : preset
    currentThemeName = name
    Object.assign(palette, createPalette(resolved.theme.color, currentScheme, paletteOptions()))
    Object.assign(mdTheme, markdownTheme(palette, codeHighlighter.highlightCode))
    codeHighlighter.invalidate()
    rebuildTranscript(false)
    setStatus(agent.status)
    requestRender()
    return true
  }

  /** Rename the session through the (optional) session-title service. */
  const renameSession = (title: string): void => {
    const titles = ctx.get('sessionTitle') as {
      rename(session: unknown, title: string): unknown
    } | undefined
    if (titles === undefined) {
      appendNotice('Session titles are not available in this session.', 'warning')
      return
    }
    try {
      titles.rename(agent.session, title)
      showTransientNotice(`Session renamed to "${title}".`)
    } catch (error) {
      appendNotice(`Rename failed: ${errorChain(error)}`, 'error')
    }
  }

  // The `/theme` picker overlay; Tab previews live, Enter keeps, Esc restores.
  let themeOverlay: TuiOverlaySession | undefined
  const showThemeSelector = (): void => {
    void themeOverlay?.close()
    const session = overlayManager.open({
      create: () => new ThemeDialog(
        THEME_PRESET_NAMES.map(name => ({
          name,
          description: THEME_PRESETS[name]?.description ?? '',
          dark: THEME_PRESETS[name]?.dark ?? false,
        })),
        currentThemeName,
        palette,
        applyTheme,
        () => { void session.close() },
      ),
      options: { width: resolved.detailsDialogWidth, anchor: 'center', margin: 1 },
    })
    themeOverlay = session
    void session.closed.then(() => {
      if (themeOverlay === session) themeOverlay = undefined
    })
    requestRender()
  }

  // `/details` names the same transcript-detail state the Ctrl+O cycle and
  // Ctrl+R toggle mutate, so a user can jump to a mode without cycling.
  const runDetails = (rawInput: string): CommandResult => {
    const tokens = rawInput.split(/\s+/u).filter(token => token !== '')
    if (tokens.length === 0) {
      showDetailsSelector()
      return { kind: 'success' }
    }
    let visibility: ToolCardVisibility | undefined
    let reasoning: boolean | undefined
    for (let token = tokens.shift(); token !== undefined; token = tokens.shift()) {
      if (token === 'collapsed' || token === 'expanded' || token === 'hidden') {
        visibility = token
      } else if (token === 'reasoning') {
        const value = tokens[0]
        if (value === 'on' || value === 'off') {
          tokens.shift()
          reasoning = value === 'on'
        } else {
          reasoning = !showReasoning
        }
      } else {
        return { kind: 'error', text: `Unknown /details argument "${token}". Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]` }
      }
    }
    // Reasoning first: its transcript rebuild would drop the visibility notice.
    if (reasoning !== undefined) setReasoning(reasoning)
    if (visibility !== undefined) setToolsVisibility(visibility)
    return { kind: 'success' }
  }

  const showHelp = (): void => {
    const commandLines = ctx.commands.list(agent).map((command) => {
      const input = command.input === undefined ? '' : ` ${command.input.hint}`
      return `/${command.name}${input} — ${command.description}`
    })
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.bold(palette.accent('Keyboard shortcuts')), 0, 0))
    chat.addChild(new Text([
      'Enter send • Shift/Alt+Enter newline • Up/Down prompt history',
      'Esc cancel turn • Ctrl+O cycle cards (collapse/expand/hide) • Ctrl+R toggle reasoning • Ctrl+L redraw',
      'Shift+Tab cycle permission preset • Ctrl+G goal actions • Ctrl+C cancel/clear/exit • Ctrl+D exit',
      '',
      ...commandLines,
      '/skill:<name> [instructions] — load a skill into the conversation',
    ].map(line => palette.dim(line)).join('\n'), 0, 0))
    requestRender()
  }

  const showPalette = (): void => {
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(
      renderPalette(palette, currentScheme, resolved.theme.color, paletteOptions()).join('\n'), 0, 0,
    ))
    requestRender()
  }

  const showStatus = async (signal: AbortSignal): Promise<void> => {
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent, signal))
    /* v8 ignore next -- disposal during the awaited assembly is covered by command-owner teardown tests. */
    if (disposed) return
    /* v8 ignore next -- SystemPrompt always emits at least its required base section. */
    const systemPrompt = displayText(renderPrompt(assembly)) || '(empty)'
    const registeredTools = assembly.tools.map(tool => displayText(tool.name)).join(', ') || '(none)'
    const events = agent.session.events
    const latestActivity = agent.session.header.createdAt
    const pressure = contextPressure()
    const usedContext = Math.max(0, Math.round(
      pressure?.projectedTokens ?? pressure?.pressureTokens ?? ctx.tokenMeter.measure(agent.session).totalTokens,
    ))
    let context = `${formatDiagnosticNumber(usedContext)} used · capacity unknown`
    const contextWindow = pressure?.contextWindow ?? modelController.contextWindow()
    if (contextWindow !== undefined && contextWindow > 0) {
      const contextPercent = Math.round(usedContext / contextWindow * 100)
      context = `${diagnosticMeter(contextPercent, palette)} ${String(contextPercent)}% used (${formatDiagnosticNumber(usedContext)} / ${formatDiagnosticNumber(contextWindow)})`
    }
    const rate = cacheHitRate(tokens)
    const turns = events.filter(event => event.type === 'turn/start').length
    const steps = events.filter(event => event.type === 'step/start').length
    const toolCalls = events.filter(event => event.type === 'tool/call').length
    const model = target.current === undefined ? 'unset' : displayText(targetLabel(target.current))
    const effort = target.current === undefined
      ? 'unset'
      : target.current.reasoningEffort === undefined
        ? 'default'
        : displayText(target.current.reasoningEffort)
    const groups: readonly (readonly StatusCardRow[])[] = [
      [
        ['Session', displayText(agent.session.id)],
        ['Title', displayText(sessionTitle ?? 'untitled')],
        ['Directory', displayText(cwd)],
        ['Model', `${model} ${palette.dim(`(effort ${effort}; reasoning blocks ${showReasoning ? 'shown' : 'hidden'})`)}`],
      ],
      [
        ['Agent', [
          agent.status,
          formatDiagnosticCount(events.length, 'event'),
          formatDiagnosticCount(turns, 'turn'),
          formatDiagnosticCount(steps, 'step'),
          formatDiagnosticCount(toolCalls, 'tool call'),
        ].join(' · ')],
      ],
      [
        ['Tokens', `${formatDiagnosticNumber(tokens.input)} input + ${formatDiagnosticNumber(tokens.output)} output`],
        ['KV cache', rate === undefined
          ? `n/a (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`
          : `${diagnosticMeter(rate, palette)} ${String(rate)}% hit (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`],
        ['Context', context],
      ],
      [
        ['Created', formatDiagnosticTime(agent.session.header.createdAt)],
        ['Active', formatDiagnosticTime(latestActivity)],
      ],
    ]
    const card = new StatusCardComponent(groups, palette)
    chat.addChild(new Spacer(1))
    chat.addChild(card)
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.bold(palette.accent('System prompt')), 0, 0))
    chat.addChild(new Text(systemPrompt, 0, 0))
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.bold(palette.accent('Registered tools')), 0, 0))
    chat.addChild(new Text(registeredTools, 0, 0))
    requestRender()
  }

  // Skill listing is async while `createTuiChat` is synchronous, so the TUI
  // retains the last complete invocation-neutral catalog for synchronous
  // editor completion, filters it for user invocation, and refreshes it after
  // registry invalidation.
  let skillCommands: SlashCommand[] = []
  let skillCommandScan = 0
  const refreshCommandAutocomplete = (): void => {
    const base = new CombinedAutocompleteProvider(
      [
        ...ctx.commands.list(agent).map(command => ({
          name: command.name,
          description: command.description,
          ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
        })),
        ...skillCommands,
      ],
      agent.session.header.cwd ?? process.cwd(),
    )
    const sessionReferences = ctx.get('sessionReferences')
    editor.setAutocompleteProvider(new ReferenceAutocompleteProvider(
      base,
      fileSearch,
      sessionReferences,
      agent,
    ))
  }
  const refreshVisibleSlashAutocomplete = (): void => {
    const cursor = editor.getCursor()
    const textBeforeCursor = editor.getLines().slice(cursor.line, cursor.line + 1).join('').slice(0, cursor.col)
    if (cursor.line === 0 && textBeforeCursor.startsWith('/') && !textBeforeCursor.includes(' ')) {
      // pi-tui's provider setter closes an existing menu but does not query
      // the replacement for the current draft. Tab in a slash-name context
      // only requests suggestions, so it refreshes without editing the text.
      editor.handleInput('\t')
    }
  }
  const disposeCommandChanges = ctx.on('commands/change', refreshCommandAutocomplete)
  refreshCommandAutocomplete()

  const refreshSkillCommands = (service: SkillRegistry): void => {
    const scan = ++skillCommandScan
    service.snapshot({ cwd, signal: skillAbort.signal }).then(
      (snapshot) => {
        if (disposed || scan !== skillCommandScan || !snapshot.complete) return
        const invocable = snapshot.skills.filter(skill => skill.invocation.userInvocable)
        // The argument-hint slot shows in the menu but is never inserted on
        // selection, so it carries the skill's scope instead of an
        // instructions placeholder. `SkillSource` is open-ended; every
        // non-project source (user, custom, bundled, runtime, …) collapses
        // to `(user)`.
        skillCommands = invocable.map(skill => ({
          name: `skill:${skill.name}`,
          description: skill.description,
          argumentHint: skill.source.startsWith('project-') ? '(project)' : '(user)',
        }))
        refreshCommandAutocomplete()
        refreshVisibleSlashAutocomplete()
        requestRender()
      },
      () => {
        // Discovery failed or was aborted on dispose; keep the base slash
        // commands so autocomplete still works without skill entries.
      },
    )
  }
  const disposeSkillChanges = skills === undefined
    ? () => {}
    : ctx.on('skills/change', () => { refreshSkillCommands(skills) })
  if (skills !== undefined) refreshSkillCommands(skills)

  // The agent scope is minted by agent-loop and intentionally inherits only
  // that core plugin's dependencies. A child command producer declares its own
  // UI-service dependency while retaining the parent agent scope and lifetime.
  const commandFiber = agent.ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'help',
      description: 'Show keyboard shortcuts and commands',
      handler: () => { showHelp(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'model',
      description: 'Show or switch this session\'s model',
      input: { hint: '[[provider/]model]' },
      handler: ({ rawInput }) => {
        modelController.queueModelCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'clear',
      description: 'Clear the transcript view (session history is unchanged)',
      handler: () => { chat.clear(); requestRender(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'details',
      description: 'Select tool-card visibility and reasoning display',
      input: { hint: '[collapsed|expanded|hidden] [reasoning [on|off]]' },
      handler: ({ rawInput }) => runDetails(rawInput),
    })
    commandCtx.commands.register({
      name: 'palette',
      description: 'Show every color and attribute role this terminal renders',
      handler: () => { showPalette(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'theme',
      description: 'Show or switch the TUI color theme',
      input: { hint: '[name]' },
      handler: ({ rawInput }) => {
        const name = rawInput.trim()
        if (name === '') {
          showThemeSelector()
        } else {
          applyTheme(name)
        }
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'reload',
      description: 'EXPERIMENTAL (dev): re-read loader config files and apply the diff (idle only)',
      handler: () => { runReload(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'resume',
      description: 'List this workspace\'s resumable sessions',
      handler: () => { resume.showResume(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'queue',
      description: 'Review queued steering messages (edit or remove)',
      handler: () => { queueDock.showSheet(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'rename',
      description: 'Rename this session',
      input: { hint: '[title]' },
      handler: ({ rawInput }) => {
        const title = rawInput.trim()
        if (title !== '') {
          renameSession(title)
          return { kind: 'success' }
        }
        const session = overlayManager.open({
          create: () => new RenameDialog(
            sessionTitle ?? '',
            palette,
            renameSession,
            () => { void session.close() },
          ),
          options: { width: 64, anchor: 'center', margin: 1 },
        })
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'fork',
      description: 'Branch this session at its last completed turn',
      handler: async () => {
        await forkSession({
          ctx, resolved, palette, overlayManager, requestRender, isDisposed, appendNotice, agent,
          ...runtime.handoffResume === undefined ? {} : { handoffResume: runtime.handoffResume },
        })
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'status',
      description: 'Show session diagnostics, system prompt, and registered tools',
      handler: async ({ signal }) => { await showStatus(signal); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'context',
      description: 'Show context occupancy and its system/tools/messages breakdown',
      handler: () => {
        openStaticDialog(insights, 'Context', contextLines(insights, palette), () => contextLines(insights, palette))
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'agents',
      description: 'List this session\'s subagent sessions and their activity',
      handler: async ({ signal }) => {
        const lines = await agentsLines(insights, signal)
        if (!isDisposed()) openStaticDialog(insights, 'Subagents', lines)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'jobs',
      description: 'List this session\'s background jobs',
      handler: () => {
        openStaticDialog(insights, 'Background jobs', jobsLines(insights), () => jobsLines(insights))
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'settings',
      description: 'Show settings namespaces and where overrides live',
      handler: () => {
        openStaticDialog(insights, 'Settings', settingsLines(insights), () => settingsLines(insights))
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'export',
      description: 'Write this session\'s transcript to a markdown file',
      input: { hint: '[path]' },
      handler: ({ rawInput }) => {
        const argument = rawInput.trim()
        if (argument !== '') {
          appendNotice('Writing to a chosen path is not supported yet; the export lands in the workspace root.', 'warning')
        }
        try {
          const path = writeExport(cwd, agent.session)
          showTransientNotice(`Exported to ${path}`)
        } catch (error) {
          appendNotice(`Export failed: ${errorChain(error)}`, 'error')
        }
        return { kind: 'success' }
      },
    })
    const exitHandler = (): CommandResult => {
      requestExit()
      return { kind: 'success' }
    }
    commandCtx.commands.register({
      name: 'exit',
      description: 'Exit after the active turn reaches idle',
      handler: exitHandler,
    })
    commandCtx.commands.register({
      name: 'quit',
      description: 'Exit after the active turn reaches idle',
      handler: exitHandler,
    })
  })
  const fileReferencePromptFiber = agent.ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'ui:tui-file-reference',
      order: 99,
      // Tool visibility can change dynamically or by agent scope. Empty
      // sections are omitted by renderPrompt, so guidance never names a tool
      // that this agent cannot call.
      text: () => agent.ctx.tools.get('read', agent) === undefined ? '' : FILE_REFERENCE_PROMPT,
    })
  })

  const runCommand = (text: string): void => {
    const controller = new AbortController()
    commandControllers.add(controller)
    void ctx.commands.execute(agent, text, controller.signal).then(
      (execution) => {
        if (disposed) return
        if (execution === undefined) {
          appendNotice(`Unknown command: ${text}`, 'warning')
        } else if (execution.result.text !== undefined && execution.result.text !== '') {
          appendNotice(execution.result.text, execution.result.kind === 'error' ? 'error' : 'info')
        }
      },
      (error: unknown) => {
        if (!disposed) {
          appendNotice(`Command failed: ${errorChain(error)}`, 'error')
        }
      },
    ).finally(() => { commandControllers.delete(controller) })
  }

  const dispatchMessage = (content: ContentBlock[], attachedContext?: UserMessage): void => {
    if (disposed) {
      appendNotice(`Agent "${agent.id}" is disposed.`, 'error')
      return
    }
    if (attachedContext !== undefined) {
      agent.inject(attachedContext)
    }
    const message = createUserMessage({ content, source: { kind: 'user' } })
    if (agent.status === 'running') {
      agent.steer(message)
      pendingSteering.add(message.id)
      refreshStatus()
    } else {
      agent.followup(message)
    }
  }

  /** Deliver a user turn to the agent: steer while running, send while idle, or report a disposed agent. */
  const deliver = (payload: string): void => {
    dispatchMessage([{ type: 'text', text: payload }])
  }

  /** Load a manually invoked skill and deliver its rendered body as a user turn, reporting lookup outcomes as notices. */
  const invokeSkill = (name: string, instructions: string): void => {
    if (skills === undefined) {
      appendNotice('Skills are not available in this session.', 'warning')
      return
    }
    const lookup = { cwd, signal: skillAbort.signal }
    const reportFailure = (error: unknown): void => {
      if (disposed) return
      appendNotice(`Skill "${name}" failed to load: ${errorChain(error)}`, 'error')
    }
    skills.list(lookup).then(
      (summaries) => {
        if (disposed) return
        const summary = summaries.find(skill => skill.name === name)
        if (summary === undefined) {
          appendNotice(`Unknown skill: ${name}`, 'warning')
          return
        }
        if (!summary.invocation.userInvocable) {
          appendNotice(`Skill "${name}" is not available for user invocation.`, 'warning')
          return
        }
        skills.get(name, lookup).then(
          (skill) => {
            if (disposed) return
            if (skill === undefined) {
              appendNotice(`Unknown skill: ${name}`, 'warning')
              return
            }
            if (!skill.invocation.userInvocable) {
              appendNotice(`Skill "${name}" is not available for user invocation.`, 'warning')
              return
            }
            deliver(renderSkillInvocation(skill, instructions))
          },
          reportFailure,
        )
      },
      reportFailure,
    )
  }

  // EXPERIMENTAL, dev-only: manually re-read every file-backed loader config
  // tree and apply the diff to the running app — the same path the HMR
  // watcher's config-change branch drives, minus the watcher. Useful when the
  // watcher misses an edit (replace-by-rename saves) or HMR is not mounted.
  // Module-source hot reload stays watcher-owned; this refreshes configs only.
  let reloadInFlight = false
  const runReload = (): void => {
    // Idle-only: a reload can dispose and re-mount entries mid-flight; doing
    // that under an active turn could tear tools or the adapter out from
    // under in-flight calls. Idleness is advisory (a send can race in after
    // the check), but it removes the common footgun.
    if (agent.status !== 'idle') {
      appendNotice(`/reload requires an idle agent (status: ${agent.status}).`, 'warning')
      return
    }
    // Re-entrancy guard: concurrent refreshes over a genuinely changed file
    // would race unmutexed tree updates (create/remove interleaving); one
    // reload at a time keeps the update pass single-writer.
    if (reloadInFlight) {
      appendNotice('A config reload is already running.', 'warning')
      return
    }

    // Optional-service lookup: the TUI must not depend on the Loader (tests
    // and embedders run without one), so `loader` stays out of `inject` and
    // is read through the non-throwing `ctx.get` accessor — a bare `ctx.loader`
    // proxy read would throw `cannot get property without inject` in a fiber.
    const loader = ctx.get('loader') as { entries(): Iterable<{ subtree?: { refresh?(): Promise<void> } }> } | undefined
    if (loader === undefined) {
      appendNotice('/reload needs the cordis Loader; this runtime has none.', 'warning')
      return
    }
    const refreshes: Promise<void>[] = []
    for (const entry of loader.entries()) {
      if (entry.subtree?.refresh !== undefined) refreshes.push(entry.subtree.refresh())
    }
    reloadInFlight = true
    showTransientNotice(`Reloading ${refreshes.length} config tree(s)… (experimental)`)
    // refresh() never rejects (it warns and keeps the running tree), so the
    // join can only fulfill; the catch arm guards a future contract change.
    void Promise.all(refreshes).then(() => {
      showTransientNotice('Config reload complete. Unchanged files were skipped; invalid files keep the running tree (see logs).')
    }).catch((error: unknown) => {
      appendNotice(`Config reload failed: ${errorChain(error)}`, 'error')
    }).finally(() => {
      reloadInFlight = false
    })
  }

  editor.onSubmit = (value: string) => {
    const text = value.trim()
    if (text === '') return
    const restoreSubmittedInput = (): void => {
      if (editor.getText() === '') editor.setText(value)
    }
    // An armed inbox edit REPLACES its queued message instead of dispatching.
    const editTarget = queueDock.takeEditTarget()
    if (editTarget !== undefined) {
      editor.addToHistory(text)
      editor.setText('')
      const replacement = replaceQueuedMessage(editTarget, [{ type: 'text', text }])
      if (agent.inbox.replace(editTarget.id, replacement)) {
        pendingSteering.add(replacement.id)
        showTransientNotice('Queued message updated.')
      } else if (agent.status === 'running') {
        // The target left the queue while editing; deliver as fresh steering.
        agent.steer(replacement)
        pendingSteering.add(replacement.id)
      } else {
        agent.followup(replacement)
      }
      refreshQueueDock()
      refreshStatus()
      return
    }
    // `/skill:<name>` carries a colon, which the command registry's name
    // grammar rejects, so it is intercepted before generic command routing.
    if (text.startsWith(SKILL_COMMAND_PREFIX)) {
      editor.addToHistory(text)
      editor.setText('')
      const { name: skillName, instructions } = parseSkillCommand(text)
      if (skillName === '') appendNotice('Usage: /skill:<name> [instructions]', 'warning')
      else invokeSkill(skillName, instructions)
      return
    }
    if (value.startsWith('/')) {
      editor.addToHistory(text)
      editor.setText('')
      runCommand(value)
      return
    }
    let parsed: ReturnType<typeof parseSessionReferenceText>
    try {
      parsed = parseSessionReferenceText(text)
    } catch (error: unknown) {
      restoreSubmittedInput()
      appendNotice(`Invalid session reference: ${errorChain(error)}`, 'error')
      return
    }
    if (parsed.references.length === 0) {
      editor.addToHistory(text)
      editor.setText('')
      dispatchMessage([{ type: 'text', text: parsed.text }])
      return
    }
    const sessionReferences = ctx.get('sessionReferences')
    if (sessionReferences === undefined) {
      restoreSubmittedInput()
      appendNotice('Session reference capability unavailable.', 'error')
      return
    }
    const controller = new AbortController()
    referenceControllers.add(controller)
    editor.disableSubmit = true
    void sessionReferences.prepare(
      agent,
      [{ type: 'text', text: parsed.text }],
      parsed.references,
      controller.signal,
    ).then((prepared: { content: ContentBlock[]; additionalContext?: UserMessage }) => {
      if (disposed) return
      editor.addToHistory(text)
      if (editor.getText() === value) editor.setText('')
      // The snapshot travels with the prompt so a blocking admission hook
      // discards them together — see dispatchMessage's attached-context path.
      dispatchMessage(prepared.content, prepared.additionalContext)
    }, (error: unknown) => {
      if (!disposed && !controller.signal.aborted) {
        restoreSubmittedInput()
        appendNotice(`Session reference failed: ${errorChain(error)}`, 'error')
      }
    }).finally(() => {
      referenceControllers.delete(controller)
      editor.disableSubmit = false
      requestRender()
    })
  }

  const removeInputListener = ui.addInputListener((data) => {
    if (overlayManager.hasActiveOverlay()) return undefined
    // Empty-input ↑ with queued messages pops the newest queued message back
    // into the editor (Claude Code's queue editing): the next submit REPLACES
    // it through the same armed-edit path the /queue sheet uses. With nothing
    // queued (or the editor non-empty) ↑ falls through to the editor's own
    // prompt history / cursor movement. An open autocomplete menu keeps ↑ for
    // itself.
    if (
      matchesKey(data, Key.up)
      && editor.focused
      && editor.getText() === ''
      && !editor.isShowingAutocomplete()
      && queueDock.armLatestForEdit()
    ) {
      return { consume: true }
    }
    // Shift+Tab cycles permission presets (Claude Code's mode ring); the
    // danger preset confirms through the risk dialog first.
    if (matchesKey(data, Key.shift(Key.tab))) {
      permissionController.cycle()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('g'))) {
      goalBar.showActions()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      toggleTools()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      toggleReasoning()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('l'))) {
      ui.invalidate()
      ui.requestRender(true)
      return { consume: true }
    }
    if (matchesKey(data, Key.escape) && agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      if (agent.status === 'running') {
        agent.cancel({ kind: 'user' })
      } else if (editor.getText() !== '') {
        editor.setText('')
      } else {
        doublePressExit('ctrl+c')
      }
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      if (agent.status === 'running') appendNotice('Cancel the active turn before exiting.', 'warning')
      else doublePressExit('ctrl+d')
      return { consume: true }
    }
    return undefined
  })

  const disposeSessionEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'tool/result') fileSearch.invalidate()
    recordEventUsage(tokens, event)
    if (event.type === 'turn/start' && runningStatus !== undefined) runningStatus.turn = event.data.turn
    // Docks re-derive from the log: the goal bar on goal changes, the queue
    // dock on inbox-affecting events; plan-mode switches re-derive the hint.
    if (event.type === 'goal/change' || event.type === 'turn/start') goalBar.refresh()
    if (event.type === 'agent/inbox/spliced' || event.type === 'user/message') refreshQueueDock()
    if (event.type === 'plan/mode' || event.type === 'permission/preset') setStatus(agent.status)
    // Track live standalone compaction state.
    if (event.type === 'compaction/start' && event.data.turn === null) {
      if (compacting === undefined) {
        const startedAt = now()
        compacting = {
          startedAt,
          timer: setInterval(renderStatus, STATUS_ANIMATION_INTERVAL_MS),
        }
        runtime.terminal.setProgress(true)
      }
      requestRender()
      return
    }
    if (event.type === 'compaction/end' && event.data.turn === null && compacting !== undefined) {
      const fadeOutGlyph = runningPhaseGlyph(agent.session.events, false, true)
      clearInterval(compacting.timer)
      compacting = undefined
      if (event.data.error !== undefined) {
        appendNotice(`Compaction failed: ${event.data.error}`, 'warning')
      }
      // A concurrently running turn owns the indicator. Keep its timer and
      // progress bit instead of letting the compaction fade clear that state.
      if (runningStatus === undefined && fadeOutGlyph !== undefined) beginFadeOut(fadeOutGlyph)
      requestRender()
      return
    }
    // A replacement mutates only the model surface, so the rendered transcript
    // keeps what it already showed; a landed summary checkpoint adds its marker.
    if (isReplacementSurfaceEvent(event)) {
      if (isCompactCheckpoint(event)) renderCompactionMarker()
      requestRender()
      return
    }
    renderEvent(event, { addHistory: false, renderChunks: true })
    requestRender()
  })
  const settlePendingSteering = (id: MessageId): void => {
    if (pendingSteering.delete(id)) refreshStatus()
  }
  const disposeDequeued = ctx.on('agent/inbox/claimed', ({ agent: source, message }) => {
    if (source === agent) settlePendingSteering(message.id)
  })
  const disposeDiscarded = ctx.on('agent/inbox/discarded', ({ agent: source, message }) => {
    if (source !== agent) return
    if (pendingSteering.delete(message.id)) refreshStatus()
  })
  const disposeInserted = ctx.on('agent/inbox/inserted', ({ agent: source }) => {
    if (source === agent) refreshQueueDock()
  })
  const disposeStatus = ctx.on('agent/status', ({ agent: source, status }) => {
    if (source !== agent) return
    // Leaving 'running' ends the turn's status line; clear any badge so the
    // next running turn starts from zero (and a cancellation, which discards
    // the queue without logging drains, cannot strand a stale count).
    if (status !== 'running') pendingSteering.clear()
    setStatus(status)
  })
  const disposeError = ctx.on('agent/error', ({ agent: source, turn, step, error }) => {
    if (source !== agent) return
    liveErrors.add(`${turn}:${step}`)
    // Full cause chain: wrapper messages like `fetch failed` carry the
    // actionable transport detail on `cause`.
    appendNotice(errorChain(error), 'error')
  })
  const disposeAgent = ctx.on('agent/disposed', ({ agent: source }) => {
    if (source !== agent) return
    // The agent left the registry (e.g. an agent-loop-only reload) while the
    // TUI stays mounted. Retained agents accept deliveries after detachment, so
    // without this a later send would drive a zombie agent/session; mark
    // disposed so dispatchMessage reports it instead.
    // The hard clear also retires live compaction. A later compact/end is
    // intentionally presentation-silent: this disposal notice owns the
    // terminal outcome, and no animation may survive agent detachment.
    clearStatus()
    appendNotice(`Agent "${agent.id}" was disposed.`, 'warning')
    disposed = true
  })

  const detachListeners = (): void => {
    skillAbort.abort()
    fileSearch.dispose()
    noticeSlot.dispose()
    removeInputListener()
    disposeCommandChanges()
    disposeSkillChanges()
    disposePromptChanges()
    for (const value of promptValues) value.dispose()
    stopBannerReveal()
    stopLogoShimmer()
    disposeSessionEvents()
    disposeDequeued()
    disposeDiscarded()
    disposeInserted()
    disposeStatus()
    disposeError()
    disposeAgent()
    disposeSchemeListener()
    disposeTargetListeners()
    modelController.detach()
  }

  // Sweep reveal of the whole banner: the header wipes in left-to-right over
  // ~BANNER_REVEAL_STEPS frames (started after `ui.start()` succeeds).
  // Configured subtitles skip it so deployments (and snapshot fixtures) stay
  // frame-deterministic.
  let revealTimer: ReturnType<typeof setInterval> | undefined
  const stopBannerReveal = (): void => {
    if (revealTimer === undefined) return
    clearInterval(revealTimer)
    revealTimer = undefined
    header.setRevealWidth(undefined)
  }
  const startBannerReveal = (): void => {
    // A configured welcome skips every startup animation (sweep AND shimmer)
    // so deployments and snapshot fixtures stay frame-deterministic.
    if (config.welcome !== undefined) return
    const total = Math.max(1, runtime.terminal.columns)
    const step = Math.max(1, Math.ceil(total / BANNER_REVEAL_STEPS))
    let shown = 0
    header.setRevealWidth(0)
    revealTimer = setInterval(() => {
      shown += step
      if (shown >= total) {
        stopBannerReveal()
        startLogoShimmer()
      } else {
        header.setRevealWidth(shown)
      }
      requestRender()
    }, BANNER_REVEAL_INTERVAL_MS)
  }

  // After the banner settles, a bright shimmer window sweeps across the
  // block-letter logo twice, then the gradient holds. Self-clearing; the
  // dispose path and terminal shrinking (logo no longer fits) both stop it.
  let shimmerTimer: ReturnType<typeof setInterval> | undefined
  const stopLogoShimmer = (): void => {
    if (shimmerTimer === undefined) return
    clearInterval(shimmerTimer)
    shimmerTimer = undefined
    header.setShimmerOffset(undefined)
  }
  const startLogoShimmer = (): void => {
    stopLogoShimmer()
    if (!resolved.theme.color || runtime.terminal.columns < logoSingleWordWidth()) return
    let offset = -SHIMMER_WIDTH
    const end = logoFullWidth() + SHIMMER_WIDTH
    const step = 2
    let frames = 0
    const maxFrames = Math.ceil((2 * (end + SHIMMER_WIDTH)) / step)
    shimmerTimer = setInterval(() => {
      frames += 1
      if (frames > maxFrames || disposed) {
        stopLogoShimmer()
        requestRender()
        return
      }
      header.setShimmerOffset(offset)
      offset += step
      if (offset > end) offset = -SHIMMER_WIDTH
      requestRender()
    }, SHIMMER_INTERVAL_MS)
  }

  rebuildTranscript(true)
  goalBar.refresh()
  refreshQueueDock()
  const restoredGoal = foldGoal(agent.session.events).goal
  /* v8 ignore next -- goal replay coverage lives with the goal seam; the TUI only formats its startup notice. */
  if (restoredGoal !== undefined && restoredGoal.phase !== 'complete') {
    appendNotice(
      `Goal restored (${restoredGoal.phase}) with automatic continuation disarmed. `
      + 'Human confirmation is required; send “继续” or run /goal resume.',
      'warning',
    )
  }
  setStatus(agent.status)
  try {
    ui.start()
  } catch (error: unknown) {
    disposed = true
    detachListeners()
    void Promise.all([
      commandFiber.dispose(),
      fileReferencePromptFiber.dispose(),
    ]).catch(
      /* v8 ignore next 2 -- command registration cleanup is non-throwing; this guards a future disposer regression */
      (cleanupError: unknown) => {
        ctx.logger.warn(`ui-tui: scoped cleanup after startup failure failed: ${errorChain(cleanupError)}`)
      },
    )
    clearStatus()
    clearInterval(spinnerTimer)
    approvals.drain()
    approvals.unregister()
    questions.unregister()
    ui.stop()
    throw error
  }
  tuiServiceFiber = ctx.inject([], (serviceCtx) => {
    new TuiExtensionServiceImpl(serviceCtx, agent, overlayManager)
  })
  startBannerReveal()

  // A launcher-seeded first turn (`dsh migrate`/`dsh upgrade`):
  // invoke the named skill exactly as a typed `/skill:<name>` would, once the
  // chat is live and the agent is idle. The launcher sets this only for a fresh
  // session, so there is no prior turn to collide with; invokeSkill reports an
  // unknown skill as a notice.
  if (config.initialSkill !== undefined) invokeSkill(config.initialSkill, '')

  // A configured theme name that matches no shipped preset falls back to the
  // adaptive default; say so once at startup rather than failing silently.
  if (resolved.theme.name !== 'deepseek' && THEME_PRESETS[resolved.theme.name] === undefined) {
    appendNotice(`Unknown theme "${resolved.theme.name}" in config; using the adaptive default. Available: ${THEME_PRESET_NAMES.join(', ')}.`, 'warning')
  }

  return {
    async dispose(): Promise<void> {
      detachListeners()
      await shutdown(false)
      await Promise.all([
        commandFiber.dispose(),
        fileReferencePromptFiber.dispose(),
      ])
    },
  }
}

/**
 * Open the pi-tui channel once its configured agent exists.
 *
 * @param ctx - Context supplying the agent registry, tools, and event stream.
 * @param config - Target agent and presentation configuration.
 * @param runtime - Terminal and process-exit boundary.
 */
export function mountTui(ctx: Context, config: Config, runtime: TuiRuntime): void {
  const sessionId = SessionId(config.sessionId ?? 'main')
  const matchesConfiguredIdentity = (agent: Agent): boolean =>
    agent.id === sessionId && ctx.agents.roots().includes(agent)
  let settled = false

  const stopWaiting = (): void => {
    disposeCreated()
    disposeFailure()
  }
  const start = (payload: { agent: Agent }): void => {
    if (settled || !matchesConfiguredIdentity(payload.agent)) return
    settled = true
    stopWaiting()
    ctx.effect(() => {
      const controller = createTuiChat(ctx, config, runtime)
      return () => controller.dispose()
    }, 'ui-tui')
  }
  const fail = (payload: { sessionId: SessionId; error: unknown }): void => {
    if (settled || payload.sessionId !== sessionId) return
    settled = true
    stopWaiting()
    runtime.terminal.write(displayText(`ui-tui: session "${sessionId}" failed to start: ${errorChain(payload.error)}\n`))
    runtime.exit(1)
  }

  const disposeCreated = ctx.on('agent/created', start)
  const disposeFailure = ctx.on('agent-loop/config-start-failed', fail)
  const existing = ctx.agents.roots().find(agent => agent.id === sessionId)
  if (existing !== undefined) start({ agent: existing })
}

const ROOT_DISPOSE_TIMEOUT_MS = 5_000

/**
 * Dispose the whole application before process exit, with a bounded fallback.
 * @param ctx - The TUI plugin context whose root owns sibling resources.
 * @param code - Process status to report.
 * @param exit - Exit boundary, replaceable by tests.
 */
export function disposeRootAndExit(
  ctx: Context,
  code: number,
  exit: (status: number) => void = (status) => { process.exit(status) },
): void {
  let exited = false
  const exitOnce = (): void => {
    if (exited) return
    exited = true
    exit(code)
  }
  const timeout = setTimeout(exitOnce, ROOT_DISPOSE_TIMEOUT_MS)
  void ctx.root.fiber.dispose().then(
    () => { clearTimeout(timeout); exitOnce() },
    () => { clearTimeout(timeout); exitOnce() },
  )
}

/** Cordis entry point using the process terminal; explicit TUI composition requires a TTY pair. */
/* v8 ignore start -- production process wiring; fake-terminal tests cover mountTui/createTuiChat,
   and apps/cli PTY smokes cover the real entry */
export function apply(ctx: Context, config: Config): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('ui-tui: both stdin and stdout must be TTYs; use the one-shot @deepseek-ai/dsh-cli-demo app for pipes')
  }
  // Truecolor is a terminal capability, so detect it here at the process
  // boundary: COLORTERM is the standard signal, but Windows Terminal only
  // sets WT_SESSION and several other modern terminals announce themselves
  // through TERM_PROGRAM; an explicit theme value still wins.
  const truecolor = config.theme?.truecolor ?? (
    ['truecolor', '24bit'].includes(process.env.COLORTERM ?? '')
    || process.env.WT_SESSION !== undefined
    || ['vscode', 'WezTerm', 'ghostty', 'iTerm.app', 'Hyper'].includes(process.env.TERM_PROGRAM ?? '')
  )
  const resumeHost = ctx.get('tuiResumeHost')
  const goodbyeMessage = ctx.get('tuiGoodbyeMessage')
  // The launcher seeds a guided fresh session's first turn through this key; a
  // config value still wins. Consumed in createTuiChat via config.initialSkill.
  const initialSkill = config.initialSkill ?? ctx.get('tuiInitialSkill')
  mountTui(ctx, Object.assign(
    {},
    config,
    { theme: Object.assign({}, config.theme, { truecolor }) },
    initialSkill === undefined ? {} : { initialSkill },
  ), {
    terminal: new ProcessTerminal(),
    exit: (code) => { disposeRootAndExit(ctx, code) },
    ...resumeHost === undefined ? {} : { handoffResume: (sessionId, cwd) => resumeHost.handoff(sessionId, cwd) },
    ...goodbyeMessage === undefined ? {} : { goodbyeMessage },
  })
}
/* v8 ignore stop */
