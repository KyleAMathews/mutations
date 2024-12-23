import {
  createProxy,
  isChanged,
  getUntracked,
  markToTrack,
} from 'proxy-compare'
import { DeltaOperation, isDeltaEmpty } from './delta'

type ProxyHandler = {
  onMutation?: (delta: DeltaOperation) => void
}

export function createMutationProxy<T extends object>(
  target: T,
  handler: ProxyHandler,
  path: (string | number)[] = []
): T {
  // Create WeakMaps for tracking state and cache
  const affected = new WeakMap()
  const proxyCache = new WeakMap()

  // Initialize affected WeakMap with the target object
  affected.set(target, new Map())

  const delta: DeltaOperation = {
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

  // Helper to emit delta
  const emitDelta = () => {
    if (handler.onMutation && !isDeltaEmpty(delta)) {
      handler.onMutation({ ...delta })
      // Reset delta after emitting
      delta.$set = {}
      delta.$unset = {}
      delta.$push = {}
      delta.$pull = {}
      delta.$pop = {}
      delta.$addToSet = {}
      delta.$append = {}
      delta.$prepend = {}
      delta.$splice = {}
    }
  }

  // Create a proxy to track property access
  const trackingProxy = createProxy(target, affected, proxyCache)

  // Create mutation proxy
  const proxy = new Proxy(trackingProxy, {
    get(target, prop, receiver) {
      if (typeof prop === `symbol`) {
        return Reflect.get(target, prop, receiver)
      }

      // Special handling for RegExp objects
      if (target instanceof RegExp) {
        const value = target[prop as keyof RegExp]
        if (typeof value === `function`) {
          return value.bind(target)
        }
        return value
      }

      // Get value from target
      const value = Reflect.get(target, prop, receiver)

      // Track access using proxy-compare
      Reflect.get(trackingProxy, prop)

      // Special handling for array methods that modify the array
      if (Array.isArray(target) && typeof value === `function`) {
        const arrayMethods = [
          `push`,
          `pop`,
          `shift`,
          `unshift`,
          `splice`,
          `sort`,
          `reverse`,
        ]
        if (arrayMethods.includes(prop as string)) {
          return function (...args: unknown[]) {
            const result = value.apply(target, args)
            const currentPath = path.join(`.`)

            switch (prop) {
              case `push`:
                if (args.length === 1) {
                  delta.$push![currentPath] = args[0]
                } else {
                  delta.$append![currentPath] = args
                }
                break

              case `unshift`:
                if (args.length === 1) {
                  delta.$prepend![currentPath] = [args[0]]
                } else {
                  delta.$prepend![currentPath] = args
                }
                break

              case `pop`:
                delta.$pop![currentPath] = 1
                break

              case `shift`:
                delta.$pop![currentPath] = -1
                break

              case `splice`:
                delta.$splice![currentPath] = args
                break

              case `sort`:
              case `reverse`:
                // For sort/reverse, we need to capture the full new array
                delta.$set![currentPath] = [...target]
                break
            }

            emitDelta()
            return result
          }
        }
      }

      // Special handling for Set and Map methods
      if (
        (target instanceof Set || target instanceof Map) &&
        typeof value === `function`
      ) {
        const currentPath = path.join(`.`)
        const methodsToTrack =
          target instanceof Set
            ? [`add`, `delete`, `clear`]
            : [`set`, `delete`, `clear`]

        if (methodsToTrack.includes(prop as string)) {
          return function (...args: unknown[]) {
            const result = value.apply(target, args)
            // For Set/Map mutations, we track the entire new value
            delta.$set![currentPath] =
              target instanceof Set ? new Set(target) : new Map(target)
            emitDelta()
            return result
          }
        }
        return value.bind(target)
      }

      if (value && typeof value === `object` && !(value instanceof RegExp)) {
        // Initialize affected WeakMap for nested objects
        if (!affected.has(value)) {
          affected.set(value, new Map())
        }

        return createMutationProxy(
          value,
          {
            onMutation: (childDelta) => {
              // Merge child delta into our delta
              Object.entries(childDelta).forEach(([op, values]) => {
                if (values && Object.keys(values).length > 0) {
                  delta[op as keyof DeltaOperation] = {
                    ...(delta[op as keyof DeltaOperation] || {}),
                    ...values,
                  }
                }
              })
              emitDelta()
            },
          },
          [...path, prop]
        )
      }
      return value
    },

    set(target, prop, value, receiver) {
      if (typeof prop === `symbol`) {
        return Reflect.set(target, prop, value, receiver)
      }

      // Initialize affected WeakMap for new object values
      if (value && typeof value === `object`) {
        if (!affected.has(value)) {
          affected.set(value, new Map())
        }
      }

      const prevValue = Reflect.get(target, prop, receiver)
      const result = Reflect.set(target, prop, value, receiver)

      // Only emit if the value has actually changed
      if (result && prevValue !== value) {
        // Create objects for comparison with only the changed property
        const prevObj = { [prop]: prevValue }
        const nextObj = { [prop]: value }

        if (isChanged(prevObj, nextObj, affected)) {
          const currentPath = [...path, prop].join(`.`)
          delta.$set![currentPath] = value
          emitDelta()
        }
      }

      return result
    },

    deleteProperty(target, prop) {
      if (typeof prop === `symbol`) {
        return Reflect.deleteProperty(target, prop)
      }

      const prevValue = Reflect.get(target, prop)
      const result = Reflect.deleteProperty(target, prop)

      if (result) {
        // Create objects for comparison
        const prevObj = { [prop]: prevValue }
        const nextObj = { [prop]: undefined }

        if (isChanged(prevObj, nextObj, affected)) {
          const currentPath = [...path, prop].join(`.`)
          delta.$unset![currentPath] = true
          emitDelta()
        }
      }

      return result
    },
  })

  return proxy as T
}

// Export proxy-compare utilities that might be useful for consumers
export { isChanged, getUntracked, markToTrack }
