const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildSync } = require('esbuild')
const result = buildSync({ entryPoints: ['src/renderer/ready/readyBoard.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const helpers = { exports: {} }
new Function('module', 'exports', result.outputFiles[0].text)(helpers, helpers.exports)
const { readyColumns, readyMove } = helpers.exports
const task = (id, categoryId, position, extra = {}) => ({ id, categoryId, position, ready: true, plannedDate: null, completedAt: null, later: false, createdAt: 1, ...extra })

test('Ready board follows category order, hides empty categories and shows all unscheduled Ready tasks', () => {
  const categories = [{ id: 'b', name: 'Second alphabetically' }, { id: 'empty', name: 'Empty' }, { id: 'a', name: 'First alphabetically' }]
  const columns = readyColumns(categories, [task('a1', 'a', 0), task('b2', 'b', 3), task('b1', 'b', 1), task('u', null, 2), task('done', 'b', 4, { completedAt: 10 }), task('scheduled', 'b', 5, { plannedDate: '2026-10-06' }), task('later', 'b', 6, { later: true }), task('backlog', 'b', 7, { ready: false })])
  assert.deepEqual(columns.map(({ id, tasks }) => [id, tasks.map(({ id }) => id)]), [['b', ['b1', 'b2']], ['a', ['a1']], ['unassigned', ['u']]])
  assert.deepEqual(readyColumns(categories, []), [])
})

test('Ready reorder computes persistent insertion before the next task for moves up, down and to column end', () => {
  const items = ['a', 'b', 'c', 'd'].map((id, index) => task(id, 'work', index))
  assert.deepEqual(readyMove(items, 2, 0), { id: 'c', plannedDate: null, beforeEventId: null, beforeId: 'a' })
  assert.deepEqual(readyMove(items, 0, 2), { id: 'a', plannedDate: null, beforeEventId: null, beforeId: 'd' })
  assert.deepEqual(readyMove(items, 0, 4), { id: 'a', plannedDate: null, beforeEventId: null, beforeId: null })
  assert.equal(readyMove(items, 2, 2), null)
  assert.equal(readyMove(items, -1, 0), null)
  assert.deepEqual(items.map(({ id }) => id), ['a', 'b', 'c', 'd'])
})
