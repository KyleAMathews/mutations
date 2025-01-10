import { describe, test, expect } from 'vitest'
import { Collection, type Row } from '../src/collection'
import { MockSyncEngine } from './mock-sync-engine'

interface TestItem extends Row {
  id: string
  title: string
  count?: number
  tags?: string[]
}

class MockSyncEngine<T extends Row> implements SyncEngine<T> {
  private listeners: Array<
    (msg: ChangeMessage<T> | { headers: { control: `up-to-date` } }) => void
  > = []
  private offset = 0

  subscribe(
    listener: (
      msg: ChangeMessage<T> | { headers: { control: `up-to-date` } }
    ) => void
  ) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  simulateChange(change: Omit<ChangeMessage<T>, `offset`>) {
    const msg: ChangeMessage<T> = {
      ...change,
      offset: this.offset++,
    }
    this.listeners.forEach((l) => l(msg))
  }

  simulateUpToDate() {
    const msg = {
      headers: {
        control: `up-to-date` as const,
      },
    }
    this.listeners.forEach((l) => l(msg))
  }
}

describe(`Sync Engine Integration`, () => {
  test(`should handle basic insert from sync engine`, async () => {
    const syncEngine = new MockSyncEngine<TestItem>()
    const collection = new Collection<TestItem>({
      syncEngine,
      debug: true,
    })

    // Simulate receiving an insert
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Test Item` },
      headers: {
        operation: `insert`,
      },
    })

    // No items yet since we haven't marked as up-to-date
    let items = collection.getItems()
    expect(items).toHaveLength(0)

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    // Now items should be present
    items = collection.getItems()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(`1`)
    expect(items[0].title).toBe(`Test Item`)
  })

  test(`should handle basic update from sync engine`, async () => {
    const syncEngine = new MockSyncEngine<TestItem>()
    const collection = new Collection<TestItem>({
      syncEngine,
      debug: true,
    })

    // First simulate receiving an insert
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Original Title` },
      headers: {
        operation: `insert`,
      },
    })

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    // Get the inserted item
    const items = collection.getItems()
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.title).toBe(`Original Title`)

    // Simulate receiving an update
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Updated Title` },
      headers: {
        operation: `update`,
      },
    })

    // Title shouldn't change yet
    expect(item.title).toBe(`Original Title`)

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    await Promise.resolve()

    const items2 = collection.getItems()
    // Now title should be updated
    expect(items2[0].title).toBe(`Updated Title`)
  })

  test(`should apply changes in order based on offset`, async () => {
    const syncEngine = new MockSyncEngine<TestItem>()
    const collection = new Collection<TestItem>({
      syncEngine,
      debug: true,
    })

    // Simulate receiving multiple changes
    syncEngine.simulateChange({
      key: `1a`,
      value: { id: `1`, title: `First Change`, count: 1 },
      headers: { operation: `insert` },
    })

    syncEngine.simulateChange({
      key: `1a`,
      value: { id: `1`, title: `Second Change`, count: 2 },
      headers: { operation: `update` },
    })

    syncEngine.simulateChange({
      key: `1a`,
      value: { id: `1`, title: `Third Change`, count: 3 },
      headers: { operation: `update` },
    })

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    await Promise.resolve()

    // Check final state reflects all changes in order
    const items = collection.getItems()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe(`Third Change`)
    expect(items[0].count).toBe(3)
  })

  test(`should handle delete from sync engine`, async () => {
    const syncEngine = new MockSyncEngine<TestItem>()
    const collection = new Collection<TestItem>({
      syncEngine,
      debug: true,
    })

    // First simulate receiving an insert
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Test Item` },
      headers: { operation: `insert` },
    })

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    // Verify item exists
    let items = collection.getItems()
    expect(items).toHaveLength(1)

    // Simulate receiving delete
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Test Item` },
      headers: { operation: `delete` },
    })

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    await Promise.resolve()

    // Verify item is deleted
    items = collection.getItems()
    expect(items).toHaveLength(0)
  })

  test(`should handle multiple items from sync engine`, async () => {
    const syncEngine = new MockSyncEngine<TestItem>()
    const collection = new Collection<TestItem>({
      syncEngine,
      debug: true,
    })

    // Simulate receiving multiple inserts
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Item 1` },
      headers: { operation: `insert` },
    })

    syncEngine.simulateChange({
      key: `2`,
      value: { id: `2`, title: `Item 2` },
      headers: { operation: `insert` },
    })

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    await Promise.resolve()

    // Verify both items exist
    let items = collection.getItems()
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.title).sort()).toEqual([`Item 1`, `Item 2`])

    // Update one item
    syncEngine.simulateChange({
      key: `1`,
      value: { id: `1`, title: `Updated Item 1` },
      headers: { operation: `update` },
    })

    // Delete the other
    syncEngine.simulateChange({
      key: `2`,
      value: { id: `2`, title: `Item 2` },
      headers: { operation: `delete` },
    })

    // Mark as up-to-date to apply changes
    syncEngine.simulateUpToDate()

    await Promise.resolve()

    // Verify final state
    items = collection.getItems()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe(`Updated Item 1`)
  })
})
