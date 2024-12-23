import { DeltaOperation } from './delta'

export function merge<T>(target: T, delta: DeltaOperation): T {
  const result = { ...target }

  // Apply $set operations
  if (delta.$set) {
    Object.entries(delta.$set).forEach(([path, value]) => {
      const parts = path.split(`.`)
      let current = result as Record<string, unknown>
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        if (!current[part]) {
          current[part] = {}
        }
        current = current[part] as Record<string, unknown>
      }
      current[parts[parts.length - 1]] = value
    })
  }

  // Apply $unset operations
  if (delta.$unset) {
    Object.entries(delta.$unset).forEach(([path, value]) => {
      if (value) {
        const parts = path.split(`.`)
        let current = result as Record<string, unknown>
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]
          if (!current[part]) {
            return
          }
          current = current[part] as Record<string, unknown>
        }
        delete current[parts[parts.length - 1]]
      }
    })
  }

  // Apply array operations
  if (Array.isArray(result)) {
    // Apply $push operations
    if (delta.$push) {
      Object.entries(delta.$push).forEach(([path, value]) => {
        const parts = path.split(`.`)
        let current = result as Record<string, unknown>
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!current[part]) {
            current[part] = []
          }
          current = current[part] as Record<string, unknown>
        }
        if (Array.isArray(current)) {
          current.push(value)
        }
      })
    }

    // Apply $append operations
    if (delta.$append) {
      Object.entries(delta.$append).forEach(([path, values]) => {
        const parts = path.split(`.`)
        let current = result as Record<string, unknown>
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!current[part]) {
            current[part] = []
          }
          current = current[part] as Record<string, unknown>
        }
        if (Array.isArray(current) && Array.isArray(values)) {
          current.push(...values)
        }
      })
    }

    // Apply $prepend operations
    if (delta.$prepend) {
      Object.entries(delta.$prepend).forEach(([path, values]) => {
        const parts = path.split(`.`)
        let current = result as Record<string, unknown>
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!current[part]) {
            current[part] = []
          }
          current = current[part] as Record<string, unknown>
        }
        if (Array.isArray(current) && Array.isArray(values)) {
          current.unshift(...values)
        }
      })
    }

    // Apply $pop operations
    if (delta.$pop) {
      Object.entries(delta.$pop).forEach(([path, value]) => {
        const parts = path.split(`.`)
        let current = result as Record<string, unknown>
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!current[part]) {
            return
          }
          current = current[part] as Record<string, unknown>
        }
        if (Array.isArray(current)) {
          if (value > 0) {
            current.pop()
          } else {
            current.shift()
          }
        }
      })
    }

    // Apply $splice operations
    if (delta.$splice) {
      Object.entries(delta.$splice).forEach(([path, args]) => {
        const parts = path.split(`.`)
        let current = result as Record<string, unknown>
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!current[part]) {
            return
          }
          current = current[part] as Record<string, unknown>
        }
        if (Array.isArray(current) && Array.isArray(args)) {
          current.splice(...args)
        }
      })
    }
  }

  return result
}
