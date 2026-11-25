import { describe, expect, it } from 'vitest'
import {
  BLANK_COUNT,
  BLANK_SPECS,
  CODE_ALPHABET,
  CODE_LENGTH,
  STORY_PAGES,
  cleanName,
  cleanWord,
  dealBlanks,
  fillTemplate,
  generateCode,
  isExpired,
  isValidCode,
  normalizeCode,
  pickSafety,
  shuffle,
} from './game'

describe('room codes', () => {
  it('generates codes of the right length from the alphabet only', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode()
      expect(code).toHaveLength(CODE_LENGTH)
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
      expect(isValidCode(code)).toBe(true)
    }
  })

  it('alphabet has no look-alike characters', () => {
    for (const ch of '01OIL') expect(CODE_ALPHABET).not.toContain(ch)
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length)
  })

  it('normalizes case and whitespace', () => {
    expect(normalizeCode(' ab c2 3 ')).toBe('ABC23')
    expect(normalizeCode('a\tb\nc')).toBe('ABC')
  })

  it('rejects malformed codes', () => {
    expect(isValidCode('ABCD')).toBe(false)
    expect(isValidCode('ABCD0')).toBe(false) // 0 is not in the alphabet
    expect(isValidCode('abcde')).toBe(false) // must be normalized first
  })
})

describe('cleanName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace')
    expect(cleanName('a\t\nb')).toBe('a b')
  })
  it('enforces 1-20 chars', () => {
    expect(cleanName('')).toBeNull()
    expect(cleanName('   ')).toBeNull()
    expect(cleanName('x'.repeat(20))).toHaveLength(20)
    expect(cleanName('x'.repeat(21))).toBeNull()
  })
  it('rejects control characters and non-strings', () => {
    expect(cleanName('bad\u0000name')).toBeNull()
    expect(cleanName('bell\u0007')).toBeNull()
    expect(cleanName(42)).toBeNull()
    expect(cleanName(undefined)).toBeNull()
  })
})

describe('cleanWord', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanWord('  big   fat   cat ')).toBe('big fat cat')
  })
  it('enforces 1-24 chars', () => {
    expect(cleanWord('')).toBeNull()
    expect(cleanWord('y'.repeat(24))).toHaveLength(24)
    expect(cleanWord('y'.repeat(25))).toBeNull()
  })
  it('rejects control characters', () => {
    expect(cleanWord('a\u001bb')).toBeNull()
    expect(cleanWord('del\u007f')).toBeNull()
  })
  it('keeps quotes, braces and unicode as plain text', () => {
    expect(cleanWord('{0} "hi" \u{1F980}')).toBe('{0} "hi" \u{1F980}')
  })
})

describe('shuffle', () => {
  it('returns a permutation and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6]
    const out = shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6])
    expect([...out].sort()).toEqual(input)
  })
})

describe('dealBlanks', () => {
  for (let n = 1; n <= 6; n++) {
    it(`deals every blank exactly once to ${n} player(s), evenly`, () => {
      const players = Array.from({ length: n }, (_, i) => `u${i}`)
      for (let trial = 0; trial < 50; trial++) {
        const deal = dealBlanks(players)
        expect(deal.map((d) => d.idx)).toEqual([0, 1, 2, 3, 4, 5])
        const counts = new Map<string, number>()
        for (const d of deal) {
          expect(players).toContain(d.assignedTo)
          counts.set(d.assignedTo, (counts.get(d.assignedTo) ?? 0) + 1)
        }
        const sizes = players.map((p) => counts.get(p) ?? 0)
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(BLANK_COUNT)
      }
    })
  }

  it('actually shuffles (not always the same assignment)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) seen.add(dealBlanks(['a', 'b', 'c']).map((d) => d.assignedTo).join())
    expect(seen.size).toBeGreaterThan(1)
  })

  it('throws without players', () => {
    expect(() => dealBlanks([])).toThrow()
  })
})

describe('pickSafety', () => {
  it('returns one of the blank\'s own safety words', () => {
    for (let idx = 0; idx < BLANK_COUNT; idx++) {
      for (let i = 0; i < 20; i++) expect(BLANK_SPECS[idx].safety).toContain(pickSafety(idx))
    }
  })
  it('every safety word is a valid word', () => {
    for (const spec of BLANK_SPECS) for (const w of spec.safety) expect(cleanWord(w)).toBe(w)
  })
  it('rejects an unknown blank', () => {
    expect(() => pickSafety(99)).toThrow()
  })
})

describe('fillTemplate', () => {
  it('replaces every placeholder, including repeats', () => {
    expect(fillTemplate('{0} and {1} and {0}', ['a', 'b'])).toBe('a and b and a')
  })
  it('leaves unknown placeholders alone', () => {
    expect(fillTemplate('{0} {7}', ['a'])).toBe('a {7}')
  })
  it('does not re-expand placeholders inside player words', () => {
    expect(fillTemplate('{0} {1}', ['{1}', 'x'])).toBe('{1} x')
  })
  it('the fixed story uses exactly the six blanks and fills completely', () => {
    const used = new Set<number>()
    for (const page of STORY_PAGES) for (const m of page.matchAll(/\{(\d+)\}/g)) used.add(Number(m[1]))
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(STORY_PAGES).toHaveLength(6)
    const values = BLANK_SPECS.map((s) => s.safety[0])
    for (const page of STORY_PAGES) expect(fillTemplate(page, values)).not.toMatch(/\{\d+\}/)
  })
})

describe('isExpired', () => {
  it('is live strictly before expiresAt and expired exactly at it', () => {
    expect(isExpired({ expiresAt: 1000 }, 999)).toBe(false)
    expect(isExpired({ expiresAt: 1000 }, 1000)).toBe(true)
    expect(isExpired({ expiresAt: 1000 }, 1001)).toBe(true)
  })
  it('treats a missing or zero expiresAt (legacy rooms) as expired', () => {
    expect(isExpired({}, 5)).toBe(true)
    expect(isExpired({ expiresAt: 0 }, 5)).toBe(true)
  })
})
