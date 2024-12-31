# Transaction Delta Tracking

## Problem Statement

Currently when a transaction completes, it sends the entire state of modified items to collections rather than just the specific changes (deltas) made during the transaction.

## Current Implementation

1. Collections own proxies and ensure single-transaction ownership
2. Proxies track all mutations via proxy-compare
3. Transactions have access to proxies but just don't use their deltas
4. So when sending changes back, we send the raw mutations back instead of just what actually changed

## Requirements

### Functional Requirements

1. When a transaction completes, send only the actual changes made to items
2. Preserve collection ownership of proxies for validation
3. Ensure only one transaction can modify an item at a time

### Non-Functional Requirements

1. Maintain collection's synchronous validation capability
2. No regression in proxy ownership/transaction isolation
3. Clear separation between validation (collection) and change tracking (proxies)

## Design Decisions

1. **Collection Proxy Ownership**

   - Collections create and own all proxies
   - Collections handle sync validation through proxies
   - Collections ensure single-transaction access
   - Collections pass proxy references to active transaction

2. **Proxy Change Tracking**

   - Proxies track all mutations via proxy-compare
   - Proxies store deltas internally
   - Proxies expose getDelta() to access changes
   - No duplicate tracking needed in transaction

3. **Transaction Responsibility**
   - Track which proxies are part of transaction
   - At commit time, call getDelta() on each proxy
   - Pass these deltas to collection
   - No need to track changes itself

## Technical Design

### 1. Delta Operation Interface

```typescript
interface DeltaOperation {
  $set?: Record<string, unknown> // Set operations
  $unset?: Record<string, boolean> // Delete operations
  $push?: Record<string, unknown> // Array push
  $pop?: Record<string, number> // Array pop/shift (-1 for shift, 1 for pop)
  $prepend?: Record<string, unknown[]> // Array unshift
  $splice?: Record<string, unknown[]> // Array splice
}
```

### 2. Collection API

```typescript
class Collection<T> {
  // Public mutation methods that userland calls
  insert(item: T, options: MutationOptions = {}): T
  update(
    item: T,
    updater: (item: T) => void,
    options: MutationOptions = {}
  ): void
  remove(item: T, options: MutationOptions = {}): void

  constructor(options: CollectionOptions<T> = {}) {
    // Initialize collection with optional onMutation handler
    // and other configuration
  }
}

interface CollectionOptions<T> {
  onMutation?: (changes: Array<{ type: string; item: T }>) => Promise<void>
  debug?: boolean
}

interface MutationOptions {
  transaction?: Transaction // Optional explicit transaction
}
```

### 3. Transaction Flow

1. **Mutation Initiation**

   ```typescript
   // Collection creates tracked proxy for item
   const item = collection.insert({ id: '1', title: 'Test todo' })

   // Updates are made through collection methods
   collection.update(item, (todo) => {
     todo.title = 'Updated todo'
   })
   ```

2. **Transaction Management**

   - If no explicit transaction provided, mutations batched within current tick
   - Multiple updates to same item in same tick are combined
   - Each item tracked with unique tracking ID

   ```typescript
   // These updates will be combined into single mutation
   collection.update(item, (obj) => {
     obj.count++
   })
   collection.update(item, (obj) => {
     obj.count++
   })
   collection.update(item, (obj) => {
     obj.count++
   })
   // Results in one mutation with count: 3
   ```

3. **Proxy Management**

   - Collections own and create all proxies
   - Proxies are created/retrieved within collection mutation methods
   - Collection ensures only one transaction can modify an item at a time

   ```typescript
   class Collection<T> {
     update(
       item: T,
       updater: (item: T) => void,
       options: MutationOptions = {}
     ) {
       // Get or create proxy for item
       const proxy = this.createTrackedProxy(item)

       // If item already in another transaction, this will throw
       if (this.isItemLocked(item)) {
         throw new Error('Item already in transaction')
       }

       // Apply update to proxy
       updater(proxy)

       // Add to transaction (batched or explicit)
       const transaction = options.transaction ?? this.batchTransaction
       transaction.update(item)
     }
   }
   ```

4. **Change Persistence**

   ```typescript
   interface DeltaOperation {
     $set?: Record<string, unknown> // Set operations
     $unset?: Record<string, true> // Delete properties
     $push?: Record<string, unknown> // Push to array
     $pull?: Record<string, unknown> // Remove from array
     $pop?: Record<string, 1 | -1> // Pop from array (1: last, -1: first)
     $addToSet?: Record<string, unknown> // Add unique to array
     $append?: Record<string, unknown[]> // Append multiple to array
     $prepend?: Record<string, unknown[]> // Prepend multiple to array
     $splice?: Record<string, [number, number, ...unknown[]]> // Array splice
   }

   class Collection<T> {
     constructor({
       onMutation = async (deltas: DeltaOperation[]) => {
         // User-provided handler for persisting deltas
         // Each delta represents atomic operations to be applied
         for (const delta of deltas) {
           if (delta.$set) {
             // Apply set operations
           }
           if (delta.$push) {
             // Apply array pushes
           }
           // etc.
         }
       },
     }) {}
   }
   ```

### 4. Delta Optimizations

1. **Update Batching**

   - Multiple updates in same tick combined into single mutation
   - Final state after all updates is what gets persisted
   - Reduces number of persistence operations

2. **Transaction Isolation**

   - Proxies locked to single transaction
   - Prevents concurrent modifications
   - Early conflict detection at proxy acquisition

3. **Change Tracking**
   - Track only actual changes via proxy
   - Combine multiple updates to same property
   - Only persist final state

## Testing Strategy

### Unit Tests

1. **Delta Collection Tests**

```typescript
describe('Transaction Delta Collection', () => {
  it('should collect changes from multiple proxies', async () => {
    const tx = new Transaction()
    const proxy1 = collection.getProxy(item1)
    const proxy2 = collection.getProxy(item2)

    proxy1.name = 'updated1'
    proxy2.status = 'active'

    const changes = await tx.collectChanges()
    expect(changes.size).toBe(2)
    expect(changes.get(item1.id)).toContainEqual({
      $set: { name: 'updated1' },
    })
    expect(changes.get(item2.id)).toContainEqual({
      $set: { status: 'active' },
    })
  })

  it('should ignore proxies with no changes', async () => {
    const tx = new Transaction()
    const proxy = collection.getProxy(item)

    // No changes made to proxy
    const changes = await tx.collectChanges()
    expect(changes.size).toBe(0)
  })
})
```

2. **Delta Optimization Tests**

```typescript
describe('Delta Optimization', () => {
  it('should merge consecutive sets on same path', () => {
    const deltas = [
      { $set: { 'user.name': 'test1' } },
      { $set: { 'user.name': 'test2' } },
    ]

    const optimized = optimizeDeltas(deltas)
    expect(optimized).toEqual([{ $set: { 'user.name': 'test2' } }])
  })

  it('should combine array operations when possible', () => {
    const deltas = [{ $push: { items: 'a' } }, { $push: { items: 'b' } }]

    const optimized = optimizeDeltas(deltas)
    expect(optimized).toEqual([{ $push: { items: ['a', 'b'] } }])
  })
})
```

### Integration Tests

1. **End-to-End Flow**

```typescript
describe('Transaction Delta Integration', () => {
  it('should persist optimized deltas to backend', async () => {
    const { mutations } = useSyncedCollection('todos')
    const tx = useTransaction()

    await mutations.update(
      todo,
      (it) => {
        it.title = 'New Title'
        it.tags.push('urgent')
        it.tags.push('important')
      },
      { transaction: tx }
    )

    await tx.commit()

    // Verify backend received optimized deltas
    expect(mockBackend.lastCall()).toMatchObject({
      changes: [
        {
          $set: { title: 'New Title' },
          $push: { tags: ['urgent', 'important'] },
        },
      ],
    })
  })
})
```

2. **Concurrency Tests**

```typescript
describe('Concurrent Transactions', () => {
  it('should prevent concurrent modifications', async () => {
    const tx1 = useTransaction();
    const tx2 = useTransaction();

    // First update succeeds
    collection.update(item, (it) => {
      it.value = 'changed1';
    }, { transaction: tx1 });

    // Second update fails as item is locked
    expect(() => {
      collection.update(item, (it) => {
        it.value = 'changed2';
      }, { transaction: tx2 });
    }).toThrow('Item already in transaction');
  });
});

## Implementation Plan

The implementation will be broken down into two main tasks:

1. **Collection Locking**
   - Add tracking of which items are locked in transactions
   - Update mutation methods to check locks before allowing modifications
   - Add tests for transaction locking

2. **Delta Persistence**
   - Update onMutation to receive deltas instead of changes
   - Get deltas from proxies when persisting
   - Add tests for delta persistence

## Dependencies
- proxy-compare (existing): For mutation tracking
- xstate (existing): For actor system

## Future Considerations
1. Optimize delta format for network transport
2. Add delta compression for large transactions
3. Support batched validation in collection
4. Consider proxy pooling for better memory usage
```
