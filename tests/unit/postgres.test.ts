import { describe, it, expect } from 'vitest'
import { createTestDb, applyMutations } from '../../src/postgres'
import { DeltaOperation } from '../../src/delta'

describe('postgres mutations', () => {
  it('should apply simple mutations', async () => {
    const db = await createTestDb()

    // Insert a test todo
    const { rows: [todo] } = await db.query(
      'INSERT INTO todos (title, completed) VALUES ($1, $2) RETURNING *',
      ['Test Todo', false]
    )

    const deltas: DeltaOperation[] = [
      {
        $set: { title: 'Updated Todo', completed: true },
        $push: { tags: 'important' }
      }
    ]

    const result = await applyMutations(db, 'todos', todo.id, deltas)
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.txid).toBeDefined()
    expect(result.changes).toHaveLength(3)

    // Verify changes were applied
    const { rows: [updated] } = await db.query(
      'SELECT * FROM todos WHERE id = $1',
      [todo.id]
    )
    expect(updated.title).toBe('Updated Todo')
    expect(updated.completed).toBe(true)
    expect(updated.tags).toEqual(['important'])
  })

  it('should handle complex nested mutations', async () => {
    const db = await createTestDb()

    // Insert a test todo
    const { rows: [todo] } = await db.query(
      "INSERT INTO todos (title, metadata) VALUES ($1, $2) RETURNING *",
      ['Test Todo', '{"user": {"profile": {}}}']
    )

    const deltas: DeltaOperation[] = [
      {
        $set: {
          'metadata->user->profile->name': 'John',
          'metadata->user->settings->theme': 'dark'
        }
      }
    ]

    const result = await applyMutations(db, 'todos', todo.id, deltas)
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.changes).toHaveLength(2)

    // Verify changes were applied
    const { rows: [updated] } = await db.query(
      'SELECT * FROM todos WHERE id = $1',
      [todo.id]
    )
    expect(updated.metadata.user.profile.name).toBe('John')
    expect(updated.metadata.user.settings.theme).toBe('dark')
  })

  it('should handle array operations', async () => {
    const db = await createTestDb()

    // Insert a test todo
    const { rows: [todo] } = await db.query(
      'INSERT INTO todos (title, tags) VALUES ($1, $2) RETURNING *',
      ['Test Todo', ['one', 'two']]
    )

    const deltas: DeltaOperation[] = [
      {
        $push: { tags: 'three' },
        $pull: { tags: 'one' }
      },
      {
        $splice: { tags: [1, 0, 'inserted'] }
      }
    ]

    const result = await applyMutations(db, 'todos', todo.id, deltas)
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.changes).toHaveLength(3)

    // Verify changes were applied
    const { rows: [updated] } = await db.query(
      'SELECT * FROM todos WHERE id = $1',
      [todo.id]
    )
    expect(updated.tags).toEqual(['two', 'inserted', 'three'])
  })
})
