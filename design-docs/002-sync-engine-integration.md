# Sync Engine Integration

## Problem Statement

The mutations library needs to integrate with sync engines (like Electric SQL) to support real-time data synchronization. The sync engine will stream changes to collections which need to be applied in a way that maintains data consistency and provides a smooth user experience.

## Requirements

### Functional Requirements

1. Collections must be able to receive change messages from a sync engine
2. Changes must be accumulated until an "up-to-date" signal is received
3. Changes must be applied in order based on their offset
4. Support insert, update, and delete operations
5. Changes must be applied atomically when marked as up-to-date
6. Must maintain existing collection transaction semantics

### Non-Functional Requirements

1. Minimize UI re-renders by batching changes
2. Maintain type safety throughout the sync process
3. Keep the sync engine interface simple and flexible
4. Make testing straightforward with a mock implementation

## Design Decisions

### Message-Based Integration

The sync engine will emit messages following the Electric protocol format. Messages are either change messages for data updates or control messages for sync status:

```typescript
// Base type for all data objects
type Row = Record<string, unknown>

type ChangeMessage<T extends Row = Row> = {
  key: string
  value: T
  headers: {
    operation: 'insert' | 'update' | 'delete'
  }
  offset: number
}

type ControlMessage = {
  headers: {
    control: 'up-to-date'
  }
}

type SyncMessage<T extends Row = Row> = ChangeMessage<T> | ControlMessage
```

For update operations, the `value` field will contain only the changed top-level fields. For example:

```typescript
// Original record
const user = {
  id: '1',
  name: 'John',
  address: {
    street: '123 Main St',
    city: 'SF',
  },
  tags: ['customer'],
}

// If the address is updated, the change message contains the complete new address:
const changeMessage = {
  key: '1',
  value: {
    address: {
      street: '456 Market St',
      city: 'SF',
    },
  },
  headers: {
    operation: 'update',
  },
  offset: 1,
}

// If multiple top-level fields change, all changed fields are included:
const multiChangeMessage = {
  key: '1',
  value: {
    name: 'Johnny',
    tags: ['customer', 'vip'],
  },
  headers: {
    operation: 'update',
  },
  offset: 2,
}
```

This format ensures that:

1. Updates are atomic at the field level
2. No need for deep merging as changed fields contain complete values
3. Unchanged fields are not included in the message
4. Nested objects are updated as a unit

### Separation of Concerns

- Sync engines emit both change and control messages
- Collections handle accumulation and applying of changes
- Collections manage transaction conflicts with existing local changes
- This separation makes it easier to implement different sync engines

### Atomic Change Application

All accumulated changes will be applied in a single transaction when marked as up-to-date. This ensures:

- Data consistency
- Proper ordering of changes
- Single UI update
- Clean rollback if needed
- No optimistic updates until transaction is committed
- Respect for existing transaction locks

### Lock Management

Changes from the sync engine are accumulated until a control message signals up-to-date status. At this point:

1. Check all accumulated changes for locks
2. If any items are locked:
   - Keep all changes in pending state
   - Wait for the locking transaction to complete
   - Try applying changes again after lock release
3. If no locks:
   - Apply all changes in a single non-optimistic transaction

This approach ensures:

- Server changes don't interfere with in-progress client transactions
- All sync changes are applied atomically
- Maintains causal ordering of changes

### Non-Optimistic Transactions

The current Collection implementation immediately updates the UI on changes through the `pendingItems` map. For sync changes, we need different behavior:

```typescript
interface Transaction {
  options: {
    // When false, changes won't be reflected in UI until commit
    optimistic: boolean
  }
}

class Collection<T extends Row> {
  private applyPendingChanges() {
    // 1. First check all locks
    const changes = Array.from(this.context.pendingSyncChanges.values()).sort(
      (a, b) => a.offset - b.offset
    )

    const hasLocks = changes.some((change) =>
      this.isItemLocked(this.getTrackingId(change.value))
    )

    if (hasLocks) {
      // Keep changes pending and wait for locks to clear
      return
    }

    // 2. Create non-optimistic transaction
    const transaction = new Transaction({
      optimistic: false,
    })

    // 3. Apply all changes
    for (const change of changes) {
      switch (change.headers.operation) {
        case 'insert':
          this.insert(change.value, { transaction })
          break
        case 'update':
          this.update(
            change.value,
            (it) => {
              // Shallow merge is fine as updates send complete values for changed fields
              Object.assign(it, change.value)
            },
            { transaction }
          )
          break
        case 'delete':
          this.remove(change.value, { transaction })
          break
      }
    }

    // 4. Commit changes - this will:
    // - Not update pendingItems map
    // - Not trigger UI updates until commit completes
    // - Apply all changes atomically
    transaction.commit()

    // 5. Clear all pending changes as they've been applied
    this.actor.send({
      type: 'CLEAR_PENDING_CHANGES',
      changes: changes.map((c) => c.key),
    })
  }
}
```

Key differences from optimistic transactions:

1. No updates to `pendingItems` map
2. No UI updates until transaction commits
3. All changes applied atomically
4. Locks checked before starting transaction
5. Changes kept pending if locks exist

## Technical Design

### Sync Engine Interface

```typescript
interface SyncEngine<T extends Row> {
  subscribe(onMessage: (message: SyncMessage<T>) => void): () => void
}
```

### Collection Changes

The Collection class requires a sync engine:

```typescript
interface CollectionOptions<T extends Row, S extends Schema = Schema> {
  // ... existing options ...
  syncEngine: SyncEngine<T> // required
}
```

2. Add pending sync changes to the context:

```typescript
interface CollectionContext<T extends Row> {
  // ... existing context ...
  pendingSyncChanges: Map<string, ChangeMessage<T>>
}
```

3. Add new methods:

```typescript
class Collection<T extends Row> {
  private initializeSync(syncEngine: SyncEngine<T>) {
    return syncEngine.subscribe((message) => {
      if ('control' in message.headers) {
        if (message.headers.control === 'up-to-date') {
          this.applyPendingChanges()
        }
      } else {
        this.actor.send({
          type: 'ACCUMULATE_SYNC_CHANGE',
          message,
        })
      }
    })
  }

  // ... rest of the class implementation ...
}
```

### Mock Implementation

```typescript
class MockSyncEngine<T extends Row> implements SyncEngine<T> {
  private subscribers: ((message: SyncMessage<T>) => void)[] = []

  subscribe(onMessage: (message: SyncMessage<T>) => void) {
    this.subscribers.push(onMessage)
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== onMessage)
    }
  }

  // Test helpers
  simulateChange(message: ChangeMessage<T>) {
    this.subscribers.forEach((s) => s(message))
  }

  simulateUpToDate() {
    this.subscribers.forEach((s) =>
      s({
        headers: { control: 'up-to-date' },
      })
    )
  }

  // Helper to simulate initial sync
  simulateInitialSync(items: T[]) {
    items.forEach((item, i) => {
      this.simulateChange({
        key: item.id,
        value: item,
        headers: { operation: 'insert' },
        offset: i,
      })
    })
    this.simulateUpToDate()
  }
}
```

## Testing Strategy

### Unit Tests

1. Sync Message Handling:

   - Accumulates changes in correct order
   - Respects offset ordering
   - Handles all operation types correctly
   - Properly processes control messages

2. Lock Management:

   - Detects locked items correctly
   - Keeps changes pending when locks exist
   - Applies changes after locks clear

3. Non-Optimistic Transactions:
   - No UI updates until commit
   - Proper atomic application of changes
   - Correct handling of field updates

### Integration Tests

1. Sync Scenarios:

   - Initial sync with many items
   - Concurrent client and server changes
   - Lock conflicts and resolution
   - Multiple up-to-date cycles

2. UI Behavior:
   - No flicker during sync
   - Correct final state
   - Proper handling of errors

## Observability

1. Debug logging for sync events:

   - Change accumulation
   - Up-to-date marking
   - Change application
   - Errors

2. State tracking:
   - Number of pending changes
   - Last sync timestamp
   - Sync errors

## Future Considerations

### Potential Enhancements

1. Conflict resolution strategies
2. Offline support
3. Sync progress indicators
4. Selective sync of collections
5. Custom change handlers

### Known Limitations

1. No built-in conflict resolution
2. All changes in memory until up-to-date
3. Changes blocked by locked items remain pending
4. No timeout for waiting on locked items

## Dependencies

1. Existing Collection implementation
2. Transaction system
3. TypeScript 4.x+
