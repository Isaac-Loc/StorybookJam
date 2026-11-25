/** The shared catalog contains only public theme metadata and style directions. */
export const STORY_THEMES = [
  {
    id: 'silly',
    name: 'Silly Surprise',
    description: 'Everyday life takes an absurd turn, in warm watercolor and ink.',
    setting: 'An everyday inconvenience escalates into something absurd. Play the characters straight and let their overly practical reactions carry the comedy.',
    artStyle: 'Warm editorial watercolor and ink illustration, textured paper, expressive gestures, understated visual comedy, no text, no letters, no words.',
  },
  {
    id: 'space',
    name: 'Space Trouble',
    description: 'Odd planets and interstellar mishaps in retro science fiction comic color.',
    setting: 'A retro science fiction caper in which a routine mission meets one very specific cosmic problem. Use genre parody, contrasting priorities, and blank prompts that fit the mission.',
    artStyle: 'Retro science fiction pulp comic illustration, bold ink lines, halftone dots, cinematic framing, expressive silhouettes, no text, no letters, no words.',
  },
  {
    id: 'quest',
    name: 'Tiny Quest',
    description: 'A pocket-sized expedition with oversized stakes, in layered cut paper.',
    setting: 'A miniature adventure that treats a backyard expedition with the seriousness of an epic quest. Make ordinary objects feel enormous and give the travelers distinct motives.',
    artStyle: 'Layered cut-paper adventure illustration, visible paper fibers and crisp edges, dramatic miniature perspective, soft directional light, no text, no letters, no words.',
  },
] as const

export type StoryThemeId = (typeof STORY_THEMES)[number]['id']
export const DEFAULT_STORY_THEME = STORY_THEMES[0].id

export function isStoryTheme(value: unknown): value is StoryThemeId {
  return STORY_THEMES.some(({ id }) => id === value)
}

/** Older rooms have no stored theme and keep the original look and feel. */
export function getStoryTheme(value: unknown) {
  return STORY_THEMES.find(({ id }) => id === value) ?? STORY_THEMES[0]
}
