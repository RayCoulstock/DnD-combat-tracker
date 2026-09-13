import { useMemo, useState } from 'react'
import { Check, ChevronRight, HeartPulse, Minus, Plus, RotateCcw, Shield, Skull, Sparkles, Swords, Upload, X } from 'lucide-react'

const initialCombatants = [
  { id: 1, initiative: 18, name: 'Fenra Ashwood', short: 'FA', role: 'Half-elf ranger · Level 5', side: 'hero', hp: 37, maxHp: 45, ac: 15, speed: '30 ft', conditions: ['Poisoned'], saves: [['STR', 13], ['DEX', 18], ['CON', 14], ['INT', 10], ['WIS', 15], ['CHA', 11]], actions: [{ name: 'Longbow', text: 'Ranged Weapon Attack: +7 to hit, range 150/600 ft, one target. 1d8 + 4 piercing damage.' }, { name: "Hunter’s Mark", text: 'Bonus action · Mark a target for an extra 1d6 damage on each hit.' }] },
  { id: 2, initiative: 15, name: 'Goblin Boss', short: 'GB', role: 'Goblinoid · Leader', side: 'enemy', hp: 16, maxHp: 35, ac: 17, speed: '30 ft', conditions: [], saves: [['STR', 10], ['DEX', 14], ['CON', 10], ['INT', 10], ['WIS', 8], ['CHA', 10]], actions: [{ name: 'Scimitar', text: 'Melee Weapon Attack: +4 to hit. 1d6 + 2 slashing damage.' }, { name: 'Redirect Attack', text: 'Reaction · Swap places with an adjacent goblin.' }] },
  { id: 3, initiative: 12, name: 'Goblin A', short: 'GA', role: 'Goblinoid · Minion', side: 'enemy', hp: 7, maxHp: 7, ac: 15, speed: '30 ft', conditions: [], saves: [['STR', 8], ['DEX', 14], ['CON', 10], ['INT', 10], ['WIS', 8], ['CHA', 8]], actions: [{ name: 'Shortbow', text: 'Ranged Weapon Attack: +4 to hit. 1d6 + 2 piercing damage.' }] },
  { id: 4, initiative: 9, name: 'Tomlin Brack', short: 'TB', role: 'Human wizard · Level 5', side: 'hero', hp: 0, maxHp: 28, ac: 12, speed: '30 ft', conditions: ['Unconscious'], saves: [['STR', 8], ['DEX', 14], ['CON', 12], ['INT', 18], ['WIS', 13], ['CHA', 10]], actions: [{ name: 'Fire Bolt', text: 'Ranged Spell Attack: +7 to hit. 2d10 fire damage.' }] },
  { id: 5, initiative: 7, name: 'Sir Colwyn', short: 'SC', role: 'Human paladin · Level 5', side: 'hero', hp: 33, maxHp: 50, ac: 18, speed: '30 ft', conditions: [], saves: [['STR', 17], ['DEX', 10], ['CON', 15], ['INT', 9], ['WIS', 12], ['CHA', 16]], actions: [{ name: 'Longsword', text: 'Melee Weapon Attack: +6 to hit. 1d8 + 3 slashing damage.' }, { name: 'Divine Smite', text: 'On hit · Expend a spell slot for 2d8 radiant damage.' }] },
]

const availableConditions = ['Blinded', 'Charmed', 'Frightened', 'Grappled', 'Poisoned', 'Prone', 'Stunned']
const exampleStatBlock = `Concavenator Large Beast (Theropod), Unaligned AC 14 (Scaly Skin) Initiative +4 (14) HP 56 (6d10 + 26) Speed 40 ft. Mod Save STR 16 +3 +3 DEX 14 +2 +2 CON 14 +2 +2 Mod Save INT 4 −3 −2 WIS 11 +0 +0 CHA 14 +2 +3 Skills Athletics +3, Intimidation +3, Stealth +3 Senses Passive Perception 12 Languages None CR 3 (XP 700; PB +2) Traits Mysterious Hump: Display. Concavenator has Advantage on Charisma checks. Mysterious Hump: Fatty Storage. Concavenator only needs to drink once per month. Muscular Forearms. Concavenator has Advantage on any check or Saving Throw to avoid the Grappled condition. Actions Combined Claw and Bite. Melee Attack Roll: +7, reach 5 ft., one target. Hit: 9 (2d6 + 2) Slashing damage plus 9 (2d6 + 2) Piercing damage. Reactions Mysterious Hump: Micro-thermoregulation. Trigger: Concavenator is hit by an attack or fails a Saving Throw. Response: Concavenator has Resistance to Cold or Fire damage until the end of the turn.`

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

function parseStatBlock(text, initiative, side) {
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

function HealthBar({ value, max }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100))
  const tone = percent <= 25 ? 'critical' : percent <= 50 ? 'wounded' : 'healthy'
  return <div className="health-track"><span className={tone} style={{ width: `${percent}%` }} /></div>
}

function App() {
  const [combatants, setCombatants] = useState(initialCombatants)
  const [selectedId, setSelectedId] = useState(1)
  const [activeId, setActiveId] = useState(1)
  const [round, setRound] = useState(3)
  const [amount, setAmount] = useState('')
  const [showConditions, setShowConditions] = useState(false)
  const [showAddCombatant, setShowAddCombatant] = useState(false)
  const [statBlock, setStatBlock] = useState('')
  const [newInitiative, setNewInitiative] = useState('')
  const [newSide, setNewSide] = useState('enemy')
  const [usedAbilities, setUsedAbilities] = useState({})
  const selected = combatants.find((item) => item.id === selectedId) ?? combatants[0]
  const activeIndex = combatants.findIndex((item) => item.id === activeId)
  const heroesStanding = useMemo(() => combatants.filter((c) => c.side === 'hero' && c.hp > 0).length, [combatants])

  const adjustHp = (direction) => {
    const parsed = Number.parseInt(amount, 10)
    if (!parsed || parsed < 1) return
    setCombatants((items) => items.map((item) => item.id === selected.id ? { ...item, hp: Math.max(0, Math.min(item.maxHp, item.hp + parsed * direction)) } : item))
    setAmount('')
  }

  const nextTurn = () => {
    const next = (activeIndex + 1) % combatants.length
    if (next === 0) setRound((value) => value + 1)
    setActiveId(combatants[next].id)
    setSelectedId(combatants[next].id)
  }

  const toggleCondition = (condition) => {
    setCombatants((items) => items.map((item) => item.id === selected.id ? { ...item, conditions: item.conditions.includes(condition) ? item.conditions.filter((c) => c !== condition) : [...item.conditions, condition] } : item))
  }

  const toggleAbility = (ability) => {
    const key = `${selected.id}:${ability.category}:${ability.name}`
    setUsedAbilities((items) => ({ ...items, [key]: !items[key] }))
  }

  const addCombatant = (event) => {
    event.preventDefault()
    if (!statBlock.trim()) return
    const combatant = parseStatBlock(statBlock, newInitiative, newSide)
    setCombatants((items) => [...items, combatant].sort((a, b) => b.initiative - a.initiative))
    setSelectedId(combatant.id)
    setStatBlock('')
    setNewInitiative('')
    setShowAddCombatant(false)
  }

  return (
    <main className="app-shell">
      <header>
        <div className="brand"><span className="brand-mark"><Swords size={20} /></span><span>ENCOUNTER <b>LEDGER</b></span></div>
        <div className="encounter-title"><div><span className="eyebrow">CURRENT ENCOUNTER</span><h1>Goblin Ambush</h1></div><div className="round"><span>ROUND</span><strong>{round}</strong></div></div>
        <div className="header-actions"><button className="ghost" onClick={() => setShowAddCombatant(true)}><Plus size={17} /> Add combatant</button><button className="primary" onClick={nextTurn}>Next turn <ChevronRight size={18} /></button></div>
      </header>

      <div className="workspace">
        <aside className="initiative-panel">
          <div className="panel-heading"><div><span className="eyebrow">COMBAT QUEUE</span><h2>Initiative order</h2></div><span className="count">{combatants.length}</span></div>
          <div className="initiative-list">
            {combatants.map((item) => (
              <button key={item.id} className={`initiative-item ${item.id === selectedId ? 'selected' : ''} ${item.hp === 0 ? 'down' : ''}`} onClick={() => setSelectedId(item.id)}>
                <span className="init-number">{item.initiative}</span><span className={`avatar ${item.side}`}>{item.hp === 0 ? <Skull size={16} /> : item.short}</span>
                <span className="init-info"><span className="name-line">{item.name}{item.id === activeId && <i>ACTIVE</i>}</span><span className="mini-hp"><HealthBar value={item.hp} max={item.maxHp} /></span></span>
              </button>
            ))}
          </div>
          <div className="party-status"><HeartPulse size={18} /><div><strong>{heroesStanding} heroes standing</strong><span>1 combatant is down</span></div></div>
        </aside>

        <section className="content">
          <article className="stat-card">
            <div className="stat-top">
              <div className={`portrait ${selected.side}`}>{selected.short}</div>
              <div className="identity"><span className="eyebrow">{selected.side === 'hero' ? 'PLAYER CHARACTER' : 'HOSTILE CREATURE'}</span><h2>{selected.name}</h2><p>{selected.role}</p></div>
              <div className="quick-stat"><Shield size={17} /><span>ARMOR CLASS<strong>{selected.ac}</strong></span></div>
              <div className="quick-stat"><span>SPD</span><span>SPEED<strong>{selected.speed}</strong></span></div>
            </div>

            <div className="vitals">
              <div className="vitals-label"><span>HIT POINTS</span><strong>{selected.hp} <em>/ {selected.maxHp}</em></strong></div><HealthBar value={selected.hp} max={selected.maxHp} />
              <div className="hp-controls"><div className="amount"><button onClick={() => setAmount(String(Math.max(0, (Number(amount) || 0) - 1)))}><Minus size={15} /></button><input aria-label="Hit point amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="Amount" inputMode="numeric" /><button onClick={() => setAmount(String((Number(amount) || 0) + 1))}><Plus size={15} /></button></div><button className="damage" onClick={() => adjustHp(-1)}>Damage</button><button className="heal" onClick={() => adjustHp(1)}>Heal</button></div>
            </div>

            <div className="conditions-block"><span className="section-label">CONDITIONS</span><div className="chips">{selected.conditions.length === 0 && <span className="no-condition">No active conditions</span>}{selected.conditions.map((condition) => <button className={`chip ${condition.toLowerCase()}`} onClick={() => toggleCondition(condition)} key={condition}>{condition}<X size={13} /></button>)}<button className="add-chip" onClick={() => setShowConditions(!showConditions)}><Plus size={14} /> Add condition</button></div>{showConditions && <div className="condition-menu">{availableConditions.map((condition) => <button className={selected.conditions.includes(condition) ? 'applied' : ''} onClick={() => toggleCondition(condition)} key={condition}>{condition}{selected.conditions.includes(condition) && ' ✓'}</button>)}</div>}</div>

            <div className="abilities">{selected.saves.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong><small>{value >= 12 ? `+${Math.floor((value - 10) / 2)}` : Math.floor((value - 10) / 2)}</small></div>)}</div>

            {selected.details?.length > 0 && <div className="creature-details">{selected.details.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
            <div className="actions"><div className="section-title"><span className="section-label">TRAITS, ACTIONS & REACTIONS</span><Sparkles size={16} /></div>{selected.actions.map((action) => {
              const key = `${selected.id}:${action.category}:${action.name}`
              const used = Boolean(usedAbilities[key])
              return <button type="button" className={`action ${used ? 'used' : ''}`} onClick={() => toggleAbility(action)} key={`${action.category}:${action.name}`}><span className="action-name"><small>{action.category || 'Action'}</small><strong>{action.name}</strong></span><p>{action.text}</p><span className="action-toggle">{used ? <><RotateCcw size={13} /> Reset</> : <><Check size={13} /> Mark used</>}</span></button>
            })}</div>
          </article>

          <section className="roster"><div className="roster-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>Battlefield</h2></div><div className="legend"><span><i className="hero-dot" /> Allies</span><span><i className="enemy-dot" /> Enemies</span></div></div><div className="roster-grid">{combatants.filter((c) => c.id !== selectedId).slice(0, 4).map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className="roster-card"><span className={`avatar ${item.side}`}>{item.hp === 0 ? <Skull size={16} /> : item.short}</span><span className="roster-data"><strong>{item.name}<small>AC {item.ac}</small></strong><HealthBar value={item.hp} max={item.maxHp} /><em>{item.hp} / {item.maxHp} HP</em></span></button>)}</div></section>
        </section>
      </div>
      {showAddCombatant && <div className="modal-backdrop" onMouseDown={() => setShowAddCombatant(false)}>
        <form className="combatant-modal" onSubmit={addCombatant} onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-heading"><span className="modal-icon"><Upload size={19} /></span><div><span className="eyebrow">IMPORT CREATURE</span><h2>Add a combatant</h2></div><button type="button" className="close-button" onClick={() => setShowAddCombatant(false)} aria-label="Close"><X size={19} /></button></div>
          <p className="modal-help">Paste a plain-text stat block. We’ll pull out its core stats, skills, senses, traits, actions, and reactions.</p>
          <label className="field-label" htmlFor="stat-block">STAT BLOCK</label>
          <textarea id="stat-block" value={statBlock} onChange={(event) => setStatBlock(event.target.value)} placeholder={exampleStatBlock} autoFocus />
          <div className="import-options">
            <label><span className="field-label">INITIATIVE <em>(AUTO IF BLANK)</em></span><input type="number" value={newInitiative} onChange={(event) => setNewInitiative(event.target.value)} placeholder="Auto" /></label>
            <fieldset><legend className="field-label">SIDE</legend><div className="side-picker"><button type="button" className={newSide === 'hero' ? 'active hero-choice' : ''} onClick={() => setNewSide('hero')}>Ally</button><button type="button" className={newSide === 'enemy' ? 'active enemy-choice' : ''} onClick={() => setNewSide('enemy')}>Enemy</button></div></fieldset>
          </div>
          <div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setShowAddCombatant(false)}>Cancel</button><button type="submit" className="primary" disabled={!statBlock.trim()}><Plus size={17} /> Add to encounter</button></div>
        </form>
      </div>}
    </main>
  )
}

export default App
