import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import * as VisionSkill from '../src/skill.js'

describe('bundled vision-bridge skill', () => {
  it('registers readable content for model and user invocation and unloads cleanly', async () => {
    const ctx = new Context()
    const registryFiber = await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(VisionSkill)
    const loaded = await ctx.skills.get('vision-bridge')
    expect(VisionSkill.name).toBe('vision-bridge-skill')
    expect(loaded).toMatchObject({
      name: 'vision-bridge',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
    })
    expect(loaded?.description).toContain('`Attached image` links')
    expect(loaded?.description).toContain('local image paths')
    expect(loaded?.description).toContain('HTTP(S) image URLs')
    expect(loaded?.content).toContain('visual delegation')
    expect(loaded?.content).toContain('untrusted evidence')
    expect(loaded?.content).toContain('current default scheme at call time')
    expect(loaded?.content).toContain('every Web image')
    expect(loaded?.content).toContain('disabled session remains entirely on DSH')
    expect(loaded?.content).toContain('exactly one')
    expect(loaded?.resourceBase).toMatchObject({ kind: 'directory' })
    await fiber.dispose()
    expect(await ctx.skills.get('vision-bridge')).toBeUndefined()
    await registryFiber.dispose()
  })

  it('ships a concise frontmatter file and both progressive-disclosure references', () => {
    const skill = readFileSync(new URL('../skills/vision-bridge/SKILL.md', import.meta.url), 'utf8')
    const usage = readFileSync(new URL('../skills/vision-bridge/references/usage.md', import.meta.url), 'utf8')
    const security = readFileSync(new URL('../skills/vision-bridge/references/security.md', import.meta.url), 'utf8')
    expect(skill).toMatch(/^---\nname: vision-bridge\ndescription:/u)
    expect(skill.split('\n').length).toBeLessThan(80)
    expect(skill).toContain('references/usage.md')
    expect(skill).toContain('references/security.md')
    expect(usage).toContain('vision_analyze')
    expect(usage).toContain('dsh plugin --profile')
    expect(security).toContain('third-party vision provider')
  })
})
