import { describe, it, expect } from 'vitest'
import { Collection } from '../src'

interface TestItem {
  title?: string
  count?: number
}

interface Mutation {
  type: string
  item: TestItem
}

describe(`Collection`, () => {
  it(`should track mutations on inserted items`, async () => {
    const mutations: Mutation[] = []
    const collection = new Collection<TestItem>({
      onMutation: async (changes) => {
        mutations.push(...changes)
      },
    })

    const item = collection.insert({ title: `Test todo` })
    expect(item.title).toBe(`Test todo`)

    const updatedItem = collection.update(item, (todo) => {
      todo.title = `Updated todo`
    })
    expect(updatedItem.title).toBe(`Updated todo`)

    // Wait for microtasks to complete
    await Promise.resolve()

    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      type: `insert`,
      item: { title: `Updated todo` },
    })
  })

  it(`should combine multiple updates`, async () => {
    const mutations: Mutation[] = []
    const collection = new Collection<TestItem>({
      onMutation: async (changes) => {
        mutations.push(...changes)
      },
    })

    const item = collection.insert({ count: 0 })
    expect(item.count).toBe(0)

    collection.update(item, (obj) => {
      obj.count++
    })
    collection.update(item, (obj) => {
      obj.count++
    })
    collection.update(item, (obj) => {
      obj.count++
    })

    expect(item.count).toBe(3)

    // Wait for microtasks to complete
    await Promise.resolve()

    expect(mutations).toHaveLength(1) // insert + updates combined
    expect(mutations[0]).toMatchObject({
      type: `insert`,
      item: { count: 3 },
    })
  })
})
