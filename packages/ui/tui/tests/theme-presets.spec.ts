import { describe, expect, it } from 'vitest'
import { createPalette, renderPalette } from '../src/components/theme.ts'
import { THEME_PRESETS, THEME_PRESET_NAMES } from '../src/components/theme-presets.ts'

describe('theme presets', () => {
  it('ships the adaptive default plus three dark themes', () => {
    expect(THEME_PRESET_NAMES).toEqual(['deepseek', 'dracula', 'nord', 'catppuccin-mocha'])
    expect(THEME_PRESETS.deepseek?.colors).toEqual({})
    for (const name of ['dracula', 'nord', 'catppuccin-mocha']) {
      const preset = THEME_PRESETS[name]
      expect(preset?.dark).toBe(true)
      expect(Object.keys(preset?.colors ?? {}).length).toBeGreaterThan(0)
    }
  })

  it('paints preset roles as 24-bit SGR on truecolor terminals', () => {
    const dracula = THEME_PRESETS.dracula
    expect(dracula).toBeDefined()
    const palette = createPalette(true, 'dark', { preset: dracula, truecolor: true })
    // Dracula accent #bd93f9 → 189;147;249.
    expect(palette.accent('x')).toBe('\x1b[38;2;189;147;249mx\x1b[39m')
    // Roles the preset leaves out keep the adaptive spec (dim's fallback ansi16
    // keeps the SGR-2 relative treatment even though its rgb exists for truecolor).
    expect(palette.text('x')).toBe('x')
  })

  it('falls back to the preset ANSI-16 codes without truecolor', () => {
    const nord = THEME_PRESETS.nord
    expect(nord).toBeDefined()
    const palette = createPalette(true, 'dark', { preset: nord, truecolor: false })
    // Nord accent #88c0d0 → ANSI 36.
    expect(palette.accent('x')).toBe('\x1b[36mx\x1b[39m')
    // The relative dim stays adaptive rather than a fixed hue.
    expect(palette.dim('x')).toBe('\x1b[2;39mx\x1b[22;39m')
  })

  it('colors with a preset disabled emits no escapes', () => {
    const palette = createPalette(false, 'dark', { preset: THEME_PRESETS.dracula, truecolor: true })
    expect(palette.accent('x')).toBe('x')
  })

  it('/palette prints the themed SGR pairs, not the adaptive defaults', () => {
    const palette = createPalette(true, 'dark', { preset: THEME_PRESETS.dracula, truecolor: true })
    const rows = renderPalette(palette, 'dark', true, { preset: THEME_PRESETS.dracula, truecolor: true }).join('\n')
    expect(rows).toContain('38;2;189;147;249')
  })
})
