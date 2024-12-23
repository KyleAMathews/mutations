# Architectural Decisions - @electric-sql/mutations

## Historical Context

The evolution of client-side mutation systems reflects the changing nature of web applications:

1. **Early Web (1990s-2000s)**
   - Form submissions with full page reloads
   - Server-side state management
   - Limited client-side state

2. **Ajax Era (2000s)**
   - Client-side state management emerges
   - Callback-based mutations
   - Manual optimistic updates
   - Complex error handling

3. **SPA Era (2010s)**
   - Client-side state becomes crucial
   - Frameworks like Backbone introduce structured mutations
   - Promise-based APIs
   - More sophisticated optimistic updates

4. **Modern Era (2020s)**
   - Real-time synchronization
   - Sophisticated caching layers
   - Automatic background revalidation
   - Strong typing support
   - Focus on developer experience

## Current State of the Art

Several modern systems handle client-side mutations:

### React Query/TanStack Query
- Strengths:
  - Mature caching system
  - Strong TypeScript support
  - Excellent dev tools
- Limitations:
  - Manual optimistic updates
  - Verbose mutation definitions
  - No direct proxy-based mutations

### Firebase/Firestore
- Strengths:
  - Real-time by default
  - Simple API
  - Built-in offline support
- Limitations:
  - Tied to specific backend
  - Limited transaction support
  - Less control over synchronization

### Apollo Client
- Strengths:
  - Strong GraphQL integration
  - Normalized caching
  - Good optimistic UI support
- Limitations:
  - GraphQL-specific
  - Complex cache manipulation
  - Heavy-weight

### SWR
- Strengths:
  - Simple mental model
  - Good stale-while-revalidate pattern
  - Lightweight
- Limitations:
  - Basic mutation support
  - Manual optimistic updates
  - Limited transaction support

## Design Goals

Our library focuses on several key objectives:

1. **Natural Mutation API**
   - Direct manipulation of data structures
   - Proxy-based change tracking
   - Minimal boilerplate

2. **Strong Optimistic Update Support**
   - Immediate UI updates
   - Automatic rollback on failure
   - Clear pending state handling

3. **Flexible Backend Integration**
   - Support various API patterns
   - Custom mutation handlers
   - Transaction support

4. **Performance First**
   - Automatic dependency tracking
   - Efficient change batching
   - Minimal rerender overhead

## Core API Design

### Collection Operations

```typescript
// Each collection gets its own mutations with automatic validation
const { data: todos, mutations: todoMutations } = useSyncedCollection('todos');
const { data: tags, mutations: tagMutations } = useSyncedCollection('tags');

// Insert with immediate feedback
const { pending: todo, committed } = todoMutations.insert({ 
  title: "New Todo" 
});

// Update with proxy tracking
await todoMutations.update(todo, it => {
  it.title = "Updated";
  it.count += 1;
});

// Remove items
await todoMutations.remove(todo);
```

### Cross-Collection Transactions

```typescript
// Transaction hook returns stable transaction object
const transaction = useTransaction();

const addTodoWithTags = async () => {
  // Use transaction directly
  todoMutations.insert({ text: "New Todo" }, { transaction });
  tagMutations.insert({ name: "urgent" }, { transaction });
  
  // Commit all changes
  await transaction.commit();
};

// Multiple independent transactions
function ComplexOperation() {
  const mainTx = useTransaction();
  const sideEffectTx = useTransaction();
  
  const performOperation = async () => {
    todoMutations.update(todo, it => it.status = 'done', { transaction: mainTx });
    statsMutations.update(stats, it => it.count++, { transaction: sideEffectTx });
    
    await mainTx.commit();
    await sideEffectTx.commit();
  };
}
```

### Schema Validation

```typescript
// Collections automatically validate against their schemas
const { mutations } = useSyncedCollection('todos', {
  // Sync options
  schema: todosSchema, // Zod schema for todos
});

// This will throw if it doesn't match schema
mutations.insert({
  title: "New Todo",
  invalidField: "oops" // Type error + runtime validation error
});
```

### Error Handling

```typescript
## Error Handling

Multiple levels of error handling are supported:

### Operation Level
### Key Design Decisions

### 1. Proxy-Based Change Tracking
We chose to use proxies for change tracking because:
- Natural JavaScript mutation syntax
- Automatic change detection
- No manual diff tracking needed
- Efficient dependency tracking

### 2. Transaction Locking
Our transaction system:
- Locks items when changed until commit
- Prevents concurrent modifications
- Stable transaction references from hook
- Automatic cleanup on component unmount
- Clear error handling
- Multiple independent transactions when needed

### 3. The `{ pending, committed }` Pattern
We return both immediate and committed states because:
- Enables immediate UI updates
- Clear way to track server confirmation
- Consistent API for all operations
- Simple loading state handling

### 4. Automatic Dependency Tracking
We track component dependencies automatically:
- No manual subscription management
- Efficient rerenders
- Natural code organization
- No explicit queries needed

### 5. Backend Flexibility

Each collection configures its own mutation handling:
```typescript
const { mutations } = useSyncedCollection('todos', {
  // Sync options including schema
  schema: todosSchema,
  // Mutation options
  mutations: {
    handleMutations: async (changes) => {
      await yourApi.applyChanges(changes);
      await waitForSync();
    }
  }
});
```

Collections maintain their own validation and sync behavior while still participating in shared transactions.

## Error Handling

Multiple levels of error handling are supported:

### Operation Level
```typescript
try {
  await mutations.update(item, it => {
    it.title = "New Title";
  });
} catch (error) {
  // Automatic rollback has occurred
  handleError(error);
}
```

### Transaction Level
```typescript
const transaction = useTransaction();
try {
  mutations.update(item1, it => it.title = "New", { transaction });
  mutations.update(item2, it => it.status = "active", { transaction });
  await transaction.commit();
} catch (error) {
  // All operations in transaction rolled back
  handleError(error);
}
```

### Global Error Handling
```typescript
function App() {
  // Access all transactions across the app
  const { transactions } = useGlobalTransactionState();

  useEffect(() => {
    const subscription = transactions.subscribe(tx => {
      if (tx.error) {
        toast.error(`Operation failed: ${tx.error.message}`);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return <YourApp />;
}

// Components can also access their own transaction errors
function TodoList() {
  const { transactions } = useTransactionState();
  
  return (
    <div>
      {transactions.map(tx => 
        tx.error && (
          <ErrorBanner key={tx.id} error={tx.error} />
        )
      )}
      {/* rest of component */}
    </div>
  );
}
```

All error handling includes automatic rollback of affected changes.

## Key Design Decisions

### 1. Proxy-Based Change Tracking

We chose to use proxies for change tracking because:
- Natural JavaScript mutation syntax
- Automatic change detection
- No manual diff tracking needed
- Efficient dependency tracking

### 2. Transaction Locking

Our transaction system:
- Locks items when changed until commit
- Prevents concurrent modifications
- Stable transaction references from hook
- Automatic cleanup on component unmount
- Clear error handling
- Multiple independent transactions when needed

### 3. The `{ pending, committed }` Pattern

We return both immediate and committed states because:
- Enables immediate UI updates
- Clear way to track server confirmation
- Consistent API for all operations
- Simple loading state handling

### 4. Automatic Dependency Tracking

We track component dependencies automatically:
- No manual subscription management
- Efficient rerenders
- Natural code organization
- No explicit queries needed

### 5. Backend Flexibility

Each collection configures its own mutation handling:

```typescript
const { mutations } = useSyncedCollection('todos', {
  // Sync options including schema
  schema: todosSchema,
  // Mutation options
  mutations: {
    handleMutations: async (changes) => {
      await yourApi.applyChanges(changes);
      await waitForSync();
    }
  }
});
```

Collections maintain their own validation and sync behavior while still participating in shared transactions.

This enables:
- Custom backend integration
- Legacy API support
- Complex workflow handling
- Flexible sync patterns

## Developer Experience

### Dev Tools

We provide comprehensive dev tools:
- Time-travel debugging
- Transaction monitoring
- Network logging
- Performance metrics
- State inspection

### Error Handling

Multiple levels of error handling:
- Per-operation error handling
- Transaction-level errors
- Global error monitoring
- Automatic rollbacks

## Future Considerations

1. **TanStack Query Integration**
   - Potential to integrate with their ecosystem
   - Leverage their infrastructure
   - Add our proxy-based mutations

2. **Performance Optimizations**
   - Batching strategies
   - Change compaction
   - Dependency optimization

3. **Advanced Features**
   - Offline support
   - Conflict resolution
   - Real-time collaboration

## Implementation Strategy

Initial implementation focus:
1. Core proxy tracking system
2. Basic mutation operations
3. Transaction support
4. Error handling
5. Dev tools
6. Performance optimization

## Migration Strategy

For existing codebases:
1. Introduce parallel usage
2. Gradually migrate operations
3. Add transaction support
4. Enhance error handling

This allows for incremental adoption while maintaining existing functionality.
