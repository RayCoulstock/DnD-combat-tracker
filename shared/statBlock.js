const sectionHeadings = ['Traits', 'Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions']

function getSection(text, heading) {
  const nextHeadings = sectionHeadings.filter((item) => item !== heading).join('|')
  return text.match(new RegExp(`(?:^|\\s)${heading}\\s+([\\s\\S]*?)(?=\\s(?:${nextHeadings})\\s|$)`, 'i'))?.[1]?.trim() || ''
}

function parseFeatures(text, category) {
  if (!text) return []
  const titlePattern = /(?:^|\.\s+)([A-Z][\w’'-]*(?:\s+(?:(?:and|or|of|the|to)|[A-Z][\w’':-]*))*)\.\s+/g
  const matches = [...text.matchAll(titlePattern)]
  return matches.map((match, index) => ({
    name: match[1],
    text: text.slice(match.index + match[0].length, matches[index + 1] ? matches[index + 1].index + 1 : text.length).trim(),
    category,
  }))
}

export function parseStatBlock(text, initiative, side) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const findNumber = (label, fallback) => Number(normalized.match(new RegExp(`${label}\\s+(\\d+)`, 'i'))?.[1] ?? fallback)
  const scores = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((ability) => [ability, Number(text.match(new RegExp(`${ability}\\s+(\\d+)`, 'i'))?.[1] ?? 10)])
  const hp = findNumber('(?:Hit Points?|HP)', 10)
  const name = normalized.match(/^(.+?)(?=\s+(?:Tiny|Small|Medium|Large|Huge|Gargantuan)\s)/i)?.[1] || text.split('\n').find((line) => line.trim())?.trim() || 'Unknown Combatant'
  const role = normalized.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(.+?)(?=\\s+(?:AC|Armor Class)\\s+\\d+)`, 'i'))?.[1]
  const importedInitiative = normalized.match(/Initiative\s+[+−-]?\d+\s*\((\d+)\)/i)?.[1]
  const details = [
    ['Skills', normalized.match(/Skills\s+(.+?)(?=\s+Senses\s)/i)?.[1]],
    ['Senses', normalized.match(/Senses\s+(.+?)(?=\s+Languages\s)/i)?.[1]],
    ['Languages', normalized.match(/Languages\s+(.+?)(?=\s+CR\s)/i)?.[1]],
    ['Challenge', normalized.match(/CR\s+(.+?)(?=\s+Traits\s|\s+Actions\s|$)/i)?.[1]],
  ].filter(([, value]) => value)
  const actions = sectionHeadings.flatMap((heading) => parseFeatures(getSection(normalized, heading), heading))

  return {
    id: Date.now(),
    initiative: Number(initiative || importedInitiative || 10),
    name,
    short: name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase(),
    role: role || (side === 'hero' ? 'Player character' : 'Creature'),
    side,
    hp,
    maxHp: hp,
    ac: findNumber('(?:Armor Class|AC)', 10),
    speed: normalized.match(/Speed\s+(.+?)(?=\s+(?:Mod|STR|Skills|Senses|Languages|CR|Traits|Actions)\s)/i)?.[1]?.trim() || '30 ft',
    conditions: [],
    saves: scores,
    details,
    actions: actions.length ? actions : [{ name: 'Imported stat block', text: 'No named traits or actions were found in this stat block.', category: 'Notes' }],
  }
}
