export type TransactionState = `pending` | `committed` | `rolledback`

export interface TransactionOptions {
  onCommit?: () => Promise<void>
}

class Delta {
  private map = new Map<string, unknown>()

  set(key: string, value: unknown) {
    this.map.set(key, value)
  }

  get(key: string): unknown {
    return this.map.get(key)
  }

  entries() {
    return this.map.entries()
  }
}

export class Transaction {
  private state: TransactionState = `pending`
  private readonly locks = new WeakMap<object, object>()
  private readonly deltas = new Map<object, Delta>()
  private readonly originals = new WeakMap<object, object>()
  private readonly targets = new WeakMap<object, object>()

  constructor(
    private options: {
      onCommit?: () => Promise<void>
    } = {}
  ) {}

  track<T extends object>(target: T): T {
    // Return existing proxy if we have one
    const existingProxy = this.locks.get(target)
    if (existingProxy) {
      return existingProxy as T
    }

    // Create a new proxy for tracking changes
    const delta = new Delta()
    const proxy = new Proxy(target, {
      get: (target, prop, _receiver) => {
        if (prop === `toJSON`) {
          return () => this.getCurrentValue(proxy)
        }

        const deltaValue = delta.get(prop.toString())
        if (deltaValue !== undefined) {
          if (typeof deltaValue === `object` && deltaValue !== null) {
            const existingProxy = this.locks.get(deltaValue)
            if (existingProxy) {
              return existingProxy
            }
            return this.track(deltaValue)
          }
          return deltaValue
        }

        const value = Reflect.get(target, prop, proxy)
        if (typeof value === `object` && value !== null) {
          const existingProxy = this.locks.get(value)
          if (existingProxy) {
            return existingProxy
          }
          const newProxy = this.track(value)
          delta.set(prop.toString(), newProxy)
          return newProxy
        }

        return value
      },
      set: (target, prop, value, _receiver) => {
        if (this.state !== `pending`) {
          throw new Error(`Transaction is not pending`)
        }

        if (typeof value === `object` && value !== null) {
          const existingProxy = this.locks.get(value)
          if (existingProxy) {
            delta.set(prop.toString(), existingProxy)
          } else {
            const trackedValue = this.track(value)
            delta.set(prop.toString(), trackedValue)
          }
        } else {
          delta.set(prop.toString(), value)
          // Also update the target object
          Reflect.set(target, prop, value)
        }
        return true
      },
    })

    this.locks.set(target, proxy)
    this.deltas.set(proxy, delta)
    this.originals.set(proxy, { ...target })
    this.targets.set(proxy, target)
    return proxy
  }

  getCurrentValue<T extends object>(proxy: T): T {
    const original = this.originals.get(proxy) as T
    if (!original) {
      throw new Error(`Proxy not found in transaction`)
    }

    const delta = this.deltas.get(proxy)
    if (!delta) {
      return original
    }

    const result = { ...original }
    for (const [key, value] of delta.entries()) {
      if (typeof value === `object` && value !== null) {
        const proxy = this.locks.get(value)
        if (proxy) {
          result[key] = this.getCurrentValue(proxy)
        } else {
          result[key] = value
        }
      } else {
        result[key] = value
      }
    }

    return result
  }

  isCommitted(): boolean {
    return this.state === `committed`
  }

  isRolledback(): boolean {
    return this.state === `rolledback`
  }

  isPending(): boolean {
    return this.state === `pending`
  }

  commit(): void {
    if (this.state !== `pending`) {
      throw new Error(`Transaction is not pending`)
    }

    // Update all proxies with their current values
    for (const [proxy, _delta] of this.deltas.entries()) {
      const original = this.originals.get(proxy)
      const target = this.targets.get(proxy)
      if (original && target) {
        const currentValue = this.getCurrentValue(proxy)
        Object.assign(original, currentValue)
        Object.assign(target, currentValue)
      }
    }

    this.state = `committed`
    this.options.onCommit?.()
  }

  rollback(): void {
    if (this.state !== `pending`) {
      throw new Error(`Transaction is not pending`)
    }

    // Restore all targets to their original values
    for (const [proxy, _delta] of this.deltas.entries()) {
      const target = this.targets.get(proxy)
      const original = this.originals.get(proxy)
      if (target && original) {
        Object.assign(target, original)
      }
    }

    // Clear all maps except originals (which we'll need for future rollbacks)
    this.deltas.clear()
    this.state = `rolledback`
  }
}
