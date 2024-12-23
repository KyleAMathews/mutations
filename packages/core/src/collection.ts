import { Transaction } from './transaction'
import { Schema, InferOutput, SchemaError } from './schema'

export interface MutationOptions {
  transaction?: Transaction
}

export interface CollectionOptions<T, S extends Schema = Schema> {
  schema?: S
  onMutation?: (changes: { type: string; item: T }[]) => Promise<void>
}

export class Collection<T extends object, S extends Schema = Schema> {
  private readonly items = new Map<string, T>()
  private readonly proxies = new WeakMap<object, T>()
  private readonly transactions = new Map<string, Transaction>()
  private currentTransaction: Transaction | null = null
  private pendingUpdates = new Set<string>()

  constructor(private options: CollectionOptions<T, S> = {}) {}

  private generateId(): string {
    try {
      return crypto.randomUUID()
    } catch (e) {
      // Fallback for older environments
      return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === `x` ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }
  }

  private validateWithSchema(item: T): T {
    if (this.options.schema) {
      const result = this.options.schema[`~standard`].validate(item)
      if (`issues` in result) {
        throw new SchemaError(result.issues)
      }
      return result.value as T
    }
    return item
  }

  insert(item: InferOutput<S>, options: MutationOptions = {}): T {
    const validatedItem = this.validateWithSchema(item as T)

    const id = `id` in validatedItem ? validatedItem.id : this.generateId()
    const itemWithId = { ...validatedItem, id }

    let transaction = options.transaction || this.currentTransaction
    if (!transaction) {
      transaction = new Transaction()
      this.currentTransaction = transaction
    }

    try {
      // Create a new proxy for this insert
      const proxy = transaction.track(itemWithId)

      // Store the original and transaction
      this.items.set(id, itemWithId)
      this.transactions.set(id, transaction)
      this.proxies.set(proxy, itemWithId)

      // If this is a new transaction, schedule the commit
      if (transaction === this.currentTransaction) {
        queueMicrotask(() => {
          if (transaction.isPending()) {
            // Validate the changes before committing
            const updatedValue = transaction.getCurrentValue(proxy)
            this.validateWithSchema(updatedValue)

            transaction.commit()
            this.currentTransaction = null
            // Trigger async mutation callback with all changes
            const mutations: { type: string; item: T }[] = [
              { type: `insert`, item: itemWithId },
            ]
            // Add any pending updates
            for (const updatedId of this.pendingUpdates) {
              mutations.push({
                type: `update`,
                item: this.items.get(updatedId)!,
              })
            }
            this.pendingUpdates.clear()
            this.options.onMutation?.(mutations)
          }
        })
      }

      return proxy
    } catch (error) {
      // Rollback the transaction and clean up state
      transaction.rollback()
      if (transaction === this.currentTransaction) {
        this.currentTransaction = null
      }
      // Remove the item if it was inserted
      this.items.delete(id)
      throw error
    }
  }

  update(
    item: T,
    updater: (item: T) => void,
    options: MutationOptions = {}
  ): T {
    // Find the item by its proxy or id
    let foundId: string | undefined
    for (const [id, storedItem] of this.items.entries()) {
      if (storedItem === item || (`id` in item && item.id === id)) {
        foundId = id
        break
      }
    }

    if (!foundId) {
      throw new Error(`Item not found`)
    }

    const original = this.items.get(foundId)!
    let transaction = options.transaction || this.currentTransaction

    if (!transaction) {
      transaction = new Transaction()
      this.currentTransaction = transaction
    }

    try {
      // Create a new proxy for this update if needed
      let proxy = item
      if (!this.proxies.has(proxy)) {
        proxy = transaction.track(original)
        this.proxies.set(proxy, original)
      }

      // Create a copy of the item for validation
      const validationCopy = { ...original }
      const validationProxy = new Proxy(validationCopy, {
        set: (target, prop, value) => {
          target[prop] = value
          return true
        },
      })

      try {
        // Apply the update to validation proxy first
        updater(validationProxy)

        // Validate the changes using the validation copy
        this.validateWithSchema(validationCopy)

        // If validation passes, apply to real proxy
        updater(proxy)
      } catch (error) {
        // Re-throw schema validation errors, wrap other errors
        if (error instanceof SchemaError) {
          throw error
        }
        throw new SchemaError([{ message: error.message }])
      }

      // If this is a new transaction, schedule the commit
      if (transaction === this.currentTransaction) {
        queueMicrotask(() => {
          if (transaction.isPending()) {
            transaction.commit()
            this.currentTransaction = null
            // Update our stored item with the committed value
            const finalValue = transaction.getCurrentValue(proxy)
            this.items.set(foundId!, finalValue)
            // Add to pending updates
            this.pendingUpdates.add(foundId!)
            // Trigger async mutation callback with all changes
            const mutations: { type: string; item: T }[] = []
            for (const updatedId of this.pendingUpdates) {
              mutations.push({
                type: `update`,
                item: this.items.get(updatedId)!,
              })
            }
            this.pendingUpdates.clear()
            this.options.onMutation?.(mutations)
          }
        })
      }

      return proxy
    } catch (error) {
      // Handle any other errors
      if (transaction === this.currentTransaction) {
        transaction.rollback()
        this.currentTransaction = null
      }
      throw error
    }
  }

  remove(item: T, options: MutationOptions = {}): void {
    // Find the item by its proxy
    let foundId: string | undefined
    for (const [id, proxy] of this.proxies.entries()) {
      if (proxy === item) {
        foundId = id
        break
      }
    }

    if (!foundId) {
      throw new Error(`Item not found`)
    }

    const original = this.items.get(foundId)!

    const transaction =
      options.transaction ||
      new Transaction({
        onCommit: () => {
          this.options.onMutation?.([{ type: `remove`, item: original }])
          this.items.delete(foundId!)
          this.transactions.delete(foundId!)
          this.proxies.delete(foundId!)
        },
      })

    if (!options.transaction) {
      transaction.commit()
    }
  }

  getItems(): T[] {
    return Array.from(this.items.values())
  }
}
