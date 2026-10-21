import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')

test('encounter file and artwork handlers are declared exactly once', () => {
  const handlerNames = [
    'handleExportEncounter',
    'handleImportEncounter',
    'handleArtworkChange',
    'handleArtworkRemove',
  ]

  handlerNames.forEach((handlerName) => {
    const declarations = appSource.match(new RegExp(`const\\s+${handlerName}\\s*=`, 'g')) ?? []
    assert.equal(declarations.length, 1, `${handlerName} should have one declaration`)
  })
})

