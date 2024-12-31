export type DeltaOperation = {
  $set?: Record<string, unknown>
  $unset?: Record<string, true>
  $push?: Record<string, unknown | unknown[]>
  $pull?: Record<string, unknown>
  $pop?: Record<string, 1 | -1> // 1 for last element, -1 for first
  $addToSet?: Record<string, unknown>
  // Postgres array operations
  $append?: Record<string, unknown[]> // Append multiple elements
  $prepend?: Record<string, unknown[]> // Prepend multiple elements
  $splice?: Record<string, [number, number, ...unknown[]]> // [start, deleteCount, ...items]
}

// Helper to create an empty delta
export function createEmptyDelta(): DeltaOperation {
  return {
    $set: {},
    $unset: {},
    $push: {},
    $pull: {},
    $pop: {},
    $addToSet: {},
    $append: {},
    $prepend: {},
    $splice: {},
  }
}

// Helper to check if a delta is empty
export function isDeltaEmpty(delta: DeltaOperation): boolean {
  return Object.values(delta).every((op) => !op || Object.keys(op).length === 0)
}

// Helper to merge deltas (useful for transactions)
export function mergeDelta(
  target: DeltaOperation,
  source: DeltaOperation
): DeltaOperation {
  const result = { ...target }

  for (const [op, values] of Object.entries(source)) {
    if (values && Object.keys(values).length > 0) {
      result[op as keyof DeltaOperation] = {
        ...(result[op as keyof DeltaOperation] || {}),
        ...values,
      }
    }
  }

  return result
}
