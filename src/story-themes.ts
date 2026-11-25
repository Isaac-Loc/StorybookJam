/** The shared catalog contains only public theme metadata and style directions. */
export const STORY_THEMES = [
  {
    id: 'silly',
    name: 'Silly Surprise',
    description: 'Big laughs, everyday oddities, and a splash of bright watercolor.',
    setting: 'A familiar everyday setting turned upside down by a ridiculous surprise.',
    artStyle: "Children's picture book illustration, soft watercolor and ink, warm friendly colors, simple shapes, no text, no letters, no words.",
  },
  {
    id: 'space',
    name: 'Space Trouble',
    description: 'Odd planets, tiny aliens, and wonky spaceships in retro comic color.',
    setting: 'A warm, funny space adventure with odd planets, tiny aliens, or wonky spaceships. Use blank prompts that fit the adventure.',
    artStyle: "Children's picture book illustration in a retro space comic style, bold ink outlines, brightly colored halftone dots and playful rockets or planets, no text, no letters, no words.",
  },
  {
    id: 'quest',
    name: 'Tiny Quest',
    description: 'Tiny heroes and unlikely treasures in an oversized cut-paper world.',
    setting: 'An epic-but-silly backyard adventure told from the point of view of a very small hero. Make everyday objects feel enormous and use blank prompts that fit the adventure.',
    artStyle: "Children's picture book illustration in layered cut-paper collage, oversized backyard details, visible paper edges, friendly shapes and soft shadows, no text, no letters, no words.",
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
