import { describe, it, expect } from 'vitest'
import { Collection } from './collection'

describe('Collection', () => {
  it('should track mutations on inserted items', async () => {
    const mutations: any[] = []
    const collection = new Collection<{ title: string }>({
      onMutation: async (changes) => {
        mutations.push(...changes)
      }
    })

    const todo = await collection.insert({ title: 'Test todo' })
    expect(todo.title).toBe('Test todo')
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      type: 'insert',
      item: { title: 'Test todo' }
    })

    await collection.update(todo, it => {
      it.title = 'Updated todo'
    })
    expect(todo.title).toBe('Updated todo')
    expect(mutations).toHaveLength(2)
    expect(mutations[1]).toMatchObject({
      type: 'update',
      item: { title: 'Updated todo' }
    })

    await collection.remove(todo)
    expect(collection.getItems()).toHaveLength(0)
    expect(mutations).toHaveLength(3)
    expect(mutations[2]).toMatchObject({
      type: 'remove',
      item: { title: 'Updated todo' }
    })
  })
})
