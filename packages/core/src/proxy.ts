import {
  createProxy as createTrackingProxy,
  getUntracked as compareGetUntracked,
} from 'proxy-compare'
import { DeltaOperation } from './delta'

export function createMutationProxy<T extends object>(
  target: T
): T & { getDelta: () => DeltaOperation } {
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

  function createNestedProxy(
    obj: T,
    currentPath: (string | number | symbol)[] = []
  ): T {
    if (obj === null || typeof obj !== `object`) return obj
    if (obj.__isProxy) return obj

    // Don't proxy Date objects
    if (obj instanceof Date) return obj

    // Don't proxy RegExp objects
    if (obj instanceof RegExp) return obj

    // Create a function to build path string
    function buildPath(path: (string | number | symbol)[]): string | symbol {
      // If path has only one element and it's a symbol, return it as is
      if (path.length === 1 && typeof path[0] === `symbol`) {
        return path[0]
      }
      // Otherwise join with dots, converting symbols to their description
      return path
        .map((p) => (typeof p === `symbol` ? p.description : p))
        .join(`.`)
    }

    // Handle Set objects
    if (obj instanceof Set) {
      const setProxy = new Proxy(obj, {
        get(target, prop, receiver) {
          if (prop === `add`) {
            return function (this: Set<unknown>, value: unknown): boolean {
              const result = target.add(value)
              const fullPath = buildPath(currentPath)
              delta.$set[fullPath] = new Set([...target])
              return result
            }
          }
          return Reflect.get(target, prop, receiver)
        },
      })
      return setProxy as Set<unknown>
    }

    // Handle Map objects
    if (obj instanceof Map) {
      const mapProxy = new Proxy(obj, {
        get(target, prop, receiver) {
          if (prop === `set`) {
            return function (
              this: Map<unknown, unknown>,
              key: unknown,
              value: unknown
            ): this {
              const result = target.set(key, value)
              const fullPath = buildPath(currentPath)
              delta.$set[fullPath] = new Map(target)
              return result
            }
          }
          return Reflect.get(target, prop, receiver)
        },
      })
      return mapProxy as Map<unknown, unknown>
    }

    // Create a tracking proxy for change detection
    const trackingProxy = createTrackingProxy(obj, affected, proxyCache)

    // Create mutation proxy
    const nestedProxy = new Proxy(trackingProxy, {
      get(target, prop, receiver) {
        if (prop === `__isProxy`) return true
        if (prop === `getDelta`) {
          return () => {
            const result: DeltaOperation = {}

            // Only include non-empty operations
            for (const key of Object.keys(delta)) {
              const op = key as keyof DeltaOperation
              if (Object.keys(delta[op]).length > 0) {
                if (!result[op]) {
                  result[op] = {}
                }
                result[op] = { ...delta[op] }
              }
            }

            return result
          }
        }

        const value = Reflect.get(target, prop, receiver)

        if (typeof value === `function`) {
          // Handle method calls
          return function (this: unknown, ...args: unknown[]) {
            const result = value.apply(target, args)
            const fullPath = buildPath(currentPath)
            const method = prop.toString()

            switch (method) {
              case `push`:
                if (!delta.$push) delta.$push = {}
                delta.$push[fullPath] = args.length === 1 ? args[0] : args
                break
              case `pop`:
                if (!delta.$pop) delta.$pop = {}
                delta.$pop[fullPath] = 1
                break
              case `shift`:
                if (!delta.$pop) delta.$pop = {}
                delta.$pop[fullPath] = -1
                break
              case `unshift`:
                if (!delta.$prepend) delta.$prepend = {}
                delta.$prepend[fullPath] = args
                break
              case `splice`:
                if (!delta.$splice) delta.$splice = {}
                delta.$splice[fullPath] = args
                break
              case `sort`:
              case `reverse`:
                // For sort/reverse, we need to capture the full new array
                if (!delta.$set) delta.$set = {}
                delta.$set[fullPath] = [...target]
                break
            }
            return result
          }
        }

        // If value is an object, create a new proxy for it
        if (value && typeof value === `object`) {
          return createNestedProxy(value as T, [...currentPath, prop])
        }

        return value
      },

      set(target, prop, value, receiver) {
        const prevValue = Reflect.get(target, prop, receiver)
        const result = Reflect.set(target, prop, value, receiver)

        // Only emit if the value has actually changed
        if (result && !Object.is(prevValue, value)) {
          const fullPath = buildPath([...currentPath, prop])
          if (!delta.$set) delta.$set = {}
          delta.$set[fullPath] = value
        }

        return result
      },

      deleteProperty(target, prop) {
        const result = Reflect.deleteProperty(target, prop)

        if (result) {
          const fullPath = buildPath([...currentPath, prop])
          if (!delta.$unset) delta.$unset = {}
          delta.$unset[fullPath] = true
        }

        return result
      },
    })

    return nestedProxy as T
  }

  const proxy = createNestedProxy(target)

  // Add getDelta method to the root proxy
  const getDeltaFn = () => {
    const result: DeltaOperation = {}

    // Only include non-empty operations
    for (const key of Object.keys(delta)) {
      const op = key as keyof DeltaOperation
      if (Object.keys(delta[op]).length > 0) {
        if (!result[op]) {
          result[op] = {}
        }
        result[op] = { ...delta[op] }
      }
    }

    return result
  }

  // Create a new proxy with the getDelta method
  const rootProxy = new Proxy(proxy, {
    get(target, prop, receiver) {
      if (prop === `getDelta`) {
        return getDeltaFn
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  return rootProxy as T & { getDelta: () => DeltaOperation }
}

export function getUntracked<T>(proxy: T): T {
  return compareGetUntracked(proxy)
}
