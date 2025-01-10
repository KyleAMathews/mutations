import { describe, test, expect } from 'vitest'
import { Collection, type Row, type SyncEngine } from '../src/collection'
import { Transaction } from '../src/transaction'

interface TestItem extends Row {
  title?: string
  count?: number
  id?: string
  tags?: string[]
  items?: string[]
}

interface Mutation {
  type: string
  item: TestItem
}

class NoopSyncEngine<T extends Row> implements SyncEngine<T> {
  subscribe() {
    // Do nothing
    return () => {}
  }
}

describe(`Collection`, () => {
  test(`should track mutations on inserted items`, async () => {
    console.log(1)
    const mutations: Mutation[] = []
    const collection = new Collection<TestItem>({
      debug: true,
      syncEngine: new NoopSyncEngine(),
      onMutation: async (changes) => {
        console.log(`onMutation called`, changes)
        mutations.push(...changes)
      },
    })

    console.log(2)
    const item = collection.insert({ id: `1`, title: `Test todo` })
    expect(item.title).toBe(`Test todo`)

    console.log(3)
    collection.update(item, (todo) => {
      todo.title = `Updated todo`
    })
    console.log(4)
    expect(item.title).toBe(`Updated todo`)

    collection.update(item, (todo) => {
      todo.title = `Updated todo2`
    })
    expect(item.title).toBe(`Updated todo2`)

    // Wait for microtasks to complete
    await Promise.resolve()

    console.log({ item, mutations })
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      operation: `insert`,
      item: { id: `1`, title: `Updated todo2` },
    })
  })

  test(`should combine multiple updates`, async () => {
    const mutations: Mutation[] = []
    const collection = new Collection<TestItem>({
      debug: true,
      syncEngine: new NoopSyncEngine(),
      onMutation: async (changes) => {
        mutations.push(...changes)
      },
    })

    const item = collection.insert({ id: `1`, count: 0 })
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

    console.log(mutations[0])
    expect(mutations).toHaveLength(1) // insert + updates combined
    expect(mutations[0]).toMatchObject({
      operation: `insert`,
      item: { id: `1`, count: 3 },
    })
  })
})

describe(`Delta Tracking`, () => {
  test(`should track specific changes made to items`, () => {
    const collection = new Collection<TestItem>({
      syncEngine: new NoopSyncEngine(),
    })
    const tx = new Transaction({ parent: collection.actor })

    const item = collection.insert(
      { id: `1`, title: `Original`, tags: [] },
      { transaction: tx }
    )

    // Make multiple different types of changes
    collection.update(
      item,
      (it) => {
        it.title = `Updated Title` // Should generate $set
        it.tags.push(`urgent`) // Should generate $push
      },
      { transaction: tx }
    )

    // The proxy should have tracked these specific changes
    const proxy = collection.context.pendingItems.get(item.__tracking_id)
    expect(proxy).toBeDefined()
    const delta = proxy.getDelta()
    expect(delta.$set.title).toEqual(`Updated Title`)
    expect(delta.$push.tags).toEqual(`urgent`)
  })

  test(`should optimize multiple updates to same property`, () => {
    const collection = new Collection<TestItem>({
      syncEngine: new NoopSyncEngine(),
    })
    const tx = new Transaction({ parent: collection.actor })

    const item = collection.insert(
      { id: `1`, title: `Original`, count: 0 },
      { transaction: tx }
    )

    // Multiple updates to same property
    collection.update(
      item,
      (it) => {
        it.count++
      },
      { transaction: tx }
    )

    collection.update(
      item,
      (it) => {
        it.count++
      },
      { transaction: tx }
    )

    collection.update(
      item,
      (it) => {
        it.count++
      },
      { transaction: tx }
    )

    const proxy = collection.context.pendingItems.get(item.__tracking_id)
    expect(proxy?.count).toBe(3)
    const delta = proxy.getDelta()
    expect(delta.$set.count).toEqual(3)
  })

  test(`should handle array operations`, () => {
    const collection = new Collection<TestItem & { items: string[] }>({
      syncEngine: new NoopSyncEngine(),
    })
    const tx = new Transaction({ parent: collection.actor })

    const item = collection.insert(
      { id: `1`, title: `Test`, items: [] },
      { transaction: tx }
    )

    // Multiple array operations
    collection.update(
      item,
      (it) => {
        it.items.push(`a`) // Should generate $push
        it.items.push(`b`) // Should be combined with previous push
      },
      { transaction: tx }
    )

    const proxy = collection.context.pendingItems.get(item.__tracking_id)
    expect(proxy?.items).toEqual([`a`, `b`])
    // Should result in a single $push operation with both items
  })
})

describe(`Transaction Isolation`, () => {
  test(`should ensure single-transaction access to items`, () => {
    const collection = new Collection<TestItem>({
      syncEngine: new NoopSyncEngine(),
    })
    const tx1 = new Transaction({ parent: collection.actor })
    const tx2 = new Transaction({ parent: collection.actor })

    const item = collection.insert(
      { id: `1`, title: `Original` },
      { transaction: tx1 }
    )

    // First transaction can update the item.
    collection.update(
      item,
      (it) => {
        it.title = `Updated in tx1`
      },
      { transaction: tx1 }
    )

    // Second transaction should fail to access the same item
    expect(() => {
      collection.update(
        item,
        (it) => {
          it.title = `Updated in tx2`
        },
        { transaction: tx2 }
      )
    }).toThrow()
  })

  test(`should track deltas for updates`, () => {
    const collection = new Collection<TestItem>({
      debug: true,
      syncEngine: new NoopSyncEngine(),
    })
    const tx = new Transaction({ debug: true, parent: collection.actor })

    console.log(1)
    const item = collection.insert(
      { id: `1`, title: `Original` },
      { transaction: tx }
    )

    // Make multiple updates in the same transaction
    console.log(2, item)
    const proxy = collection.update(
      item,
      (it) => {
        it.title = `First update`
      },
      { transaction: tx }
    )
    console.log(3)

    collection.update(
      proxy,
      (it) => {
        it.title = `Second update`
      },
      { transaction: tx }
    )
    console.log(4)

    // The proxy should track all changes
    const delta = collection.context.pendingItems.get(item.__tracking_id)
    expect(delta?.title).toBe(`Second update`)
  })

  test(`should handle remove operation correctly`, () => {
    const collection = new Collection<TestItem>({
      debug: true,
      syncEngine: new NoopSyncEngine(),
    })
    const tx = new Transaction({ parent: collection.actor })

    const item = collection.insert(
      { id: `1`, title: `Test` },
      { transaction: tx }
    )

    // Remove in transaction
    collection.remove(item, { transaction: tx })

    // Further updates in same transaction should fail
    expect(() => {
      collection.update(
        item,
        (it) => {
          it.title = `Updated`
        },
        { transaction: tx }
      )
    }).toThrow()
  })

  test(`should batch mutations within same tick`, async () => {
    const mutations: Array<{ type: string; item: TestItem }> = []
    const collection = new Collection<TestItem>({
      syncEngine: new NoopSyncEngine(),
      onMutation: async (changes) => {
        mutations.push(...changes)
      },
    })

    const item = collection.insert({ id: `1`, title: `Original` })

    // Multiple updates in same tick
    collection.update(item, (it) => {
      it.title = `Update 1`
    })
    collection.update(item, (it) => {
      it.title = `Update 2`
    })

    // Wait for next tick
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should be combined into single mutation
    expect(mutations.length).toBe(1)
    expect(mutations[0].item.title).toBe(`Update 2`)
  })

  test(`should unlock after the initial transaction is committed`, async () => {
    const mutations: Array<{ type: string; item: TestItem }> = []
    const collection = new Collection<TestItem>({
      syncEngine: new NoopSyncEngine(),
      onMutation: async (changes) => {
        mutations.push(...changes)
      },
      debug: true,
    })
    const tx1 = new Transaction({ parent: collection.actor })
    const tx2 = new Transaction({ parent: collection.actor })

    const item = collection.insert(
      { id: `1`, title: `Original` },
      { transaction: tx1 }
    )

    await tx1.commit()

    // Multiple updates in same tick
    collection.update(
      item,
      (it) => {
        it.title = `Update 1`
      },
      { transaction: tx2 }
    )
    await tx2.commit()

    // Should be combined into single mutation
    expect(mutations.length).toBe(2)
  })
})
