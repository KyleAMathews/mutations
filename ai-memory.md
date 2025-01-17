# AI Memory File

## Instructions for AI

1. Always add new entries at the top under the "Timeline" section
2. Use ISO 8601 timestamps (from the provided current time)
3. Format each entry as:

   ```markdown
   ### YYYY-MM-DDTHH:mm:ssZ

   - Main topic/decision
   - Details and context
   - Any important code changes
   - Next steps or open questions
   ```

4. Keep entries factual and concise
5. Include links to relevant files and line numbers when applicable
6. Tag entries with categories in brackets: [setup], [feature], [refactor], [test], [docs]

## Timeline

### 2024-12-24T09:40:34-07:00 [refactor]

- Replaced `id` with `__tracking_id` for internal item tracking
- Key changes:
  - Added `__tracking_id` to items in collections and transactions
  - Remove `__tracking_id` before sending mutations to onMutation handlers
  - Updated all item lookups to use `__tracking_id` instead of `id`
  - Ensure `__tracking_id` is not exposed in public APIs
- Rationale:
  - Avoid conflicts with user's own `id` fields
  - Keep internal tracking separate from item data
  - Prevent tracking IDs from leaking into mutation events

### 2024-12-24T09:27:01-07:00 [refactor]

- Fixed direct context mutations in state machines
- Key learnings:
  - Never mutate state machine context directly
  - All state changes must go through events
  - Use assign action to update context in response to events
  - Keep state transitions explicit and trackable
- Updated collection.ts and transaction.ts to follow these principles
- Removed direct mutations from insert/update/delete operations
- Added proper event handling for all state changes

### 2024-12-24T08:31:20-07:00 [docs]

- Always use pnpm for installing packages to ensure consistent dependency management and faster installations

### 2024-12-23T09:18:30-07:00 [feat]

- Implemented PostgreSQL mutation application
- Added direct PGlite integration
- Support for nested JSONB operations
- Comprehensive array operation support
- Transaction handling
- Reorganized test structure into dedicated directory

### 2024-12-23T08:36:00-07:00 [docs]

- Updated AI memory with latest changes
- Added project overview and key components
- Documented delta operations, proxy system, collection management, and PostgreSQL integration
- Outlined implementation details and recent changes

### 2024-12-23T08:35:00-07:00 [feature] [test]

- Updated mutation tracking system to work correctly for:
  - Simple property changes
  - Nested object mutations
  - Array operations (push, pop, shift, unshift, splice)
  - Special types (RegExp, BigInt)
  - Set and Map operations

### 2024-12-23T08:33:30-07:00 [feature] [test]

- Added support and tests for RegExp and BigInt handling
- Special handling for RegExp objects to maintain method bindings
- Tests cover:
  - RegExp objects and arrays of RegExp
  - BigInt values and operations
  - Mixed RegExp and BigInt in complex objects
- All 22 tests now passing

### 2024-12-23T08:32:00-07:00 [feature]

- Added support for Set and Map data structures
- Implemented proxy handlers for Set/Map methods
- Added tests for Set/Map operations

### 2024-12-23T08:30:00-07:00 [feature]

- Added support for array operations:
  - push, pop, shift, unshift
  - splice, slice
  - sort, reverse
  - map, filter, reduce
- Added tests for array operations

### 2024-12-23T08:29:14-07:00 [docs]

- Created this AI memory file
- Purpose: Track progress, decisions, and context across sessions
- Will be updated in reverse chronological order

### 2024-12-23T08:07:44-07:00 [test]

- Fixed final test issues with array splice operations
- Updated test expectations to correctly handle array extension cases
- All 19 tests now passing

### 2024-12-23T08:04:47-07:00 [feature] [test]

- Added comprehensive test suite for proxy system
- New tests cover:
  - Array operations (push, pop, shift, unshift, splice, sort)
  - Nested data structures
  - Set and Map handling
  - Deep object mutations
  - Edge cases and special types
- Fixed Set/Map method handling by binding methods to original objects

### 2024-12-23T08:03:56-07:00 [refactor]

- Integrated proxy-compare library for efficient change tracking
- Replaced custom proxy implementation with battle-tested solution
- Added proper handling for array operations and nested objects

### 2024-12-23T08:00:00-07:00 [init]

- Initial project setup
- Added core mutation tracking system
- Set up TypeScript configuration and build system
- Added vitest for testing

### 2024-12-22T16:45:00-07:00 [feat]

- Initial implementation of mutation tracking
- Added support for:
  - Basic property changes
  - Array operations
  - Nested objects
  - Special types (RegExp, BigInt)
  - Set and Map operations

## Changes

# AI Memory for @electric-sql/mutations

## Project Overview

This library implements client-side mutations for ElectricSQL using a proxy-based system for change tracking. It allows tracking changes to JavaScript objects and arrays, and applying those changes to a PostgreSQL database.

## Key Components

### Delta Operations (`delta.ts`)

- Defines the mutation operations ($set, $unset, $push, etc.)
- Handles nested paths using -> notation for JSONB fields
- Supports array operations (push, pull, splice, etc.)

### Proxy System (`proxy.ts`)

- Uses JavaScript Proxy to track changes to objects and arrays
- Converts mutations into delta operations
- Handles nested objects and array methods

### Collection Management (`collection.ts`)

- Manages collections of objects
- Tracks changes using the proxy system
- Aggregates deltas for batch updates

### PostgreSQL Integration (`postgres.ts`)

- Implements mutation application to PostgreSQL
- Uses PGlite for database operations
- Supports:
  - Direct field updates
  - Nested JSONB operations
  - Array manipulations
  - Transaction management

## Implementation Details

### Mutation Operations

- **Simple Updates**: Direct field modifications
- **Nested Updates**: Using JSONB operations (jsonb_set, #-)
- **Array Operations**:
  - push/pull using array_append/array_remove
  - splice using array_cat and array slicing
  - Advanced operations (sort, filter, map)

### Transaction Batching

- Multiple updates in the same frame (microtask) are batched into a single transaction
- The Collection class maintains a `currentTransaction` that's shared across all updates in the frame
- Updates are collected and committed at the end of the frame using `queueMicrotask`
- The mutation callback receives a single mutation that combines all changes:
  - Type is based on the first operation (e.g., 'insert')
  - Item reflects the final state after all updates
- This approach ensures efficient batching while maintaining proper state management

### Browser and Node.js Compatibility

- Core functionality relies on standard features:
  - `queueMicrotask`: Available in all modern browsers and Node.js since v11.0.0
  - `crypto.randomUUID()`: Available in modern browsers (Chrome 92+, Firefox 95+, Safari 15.4+) and Node.js v14.17.0+
- Fallback implementation provided for `crypto.randomUUID()` using Math.random() for older environments
- All other features (Proxies, Maps, Sets, etc.) are well-supported in modern environments

### Testing

- Unit tests for each component
- Integration tests for PostgreSQL operations
- Test structure:
  ```
  tests/
  ├── setup/
  │   └── setup-db.ts
  └── unit/
      ├── collection.test.ts
      ├── delta.test.ts
      ├── postgres.test.ts
      └── proxy.test.ts
  ```
- Always use `--run` flag when running tests to ensure they complete and output is visible

## Next Steps (Prioritized)

1. Implement transaction support for batching multiple mutations
2. Add schema validation for mutations
3. Add support for optimistic updates
4. Implement conflict resolution strategies
5. Add performance optimizations for large datasets
