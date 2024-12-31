import { Transaction } from './transaction'
import { Schema, SchemaError } from './schema'
import {
  createMachine,
  type AnyActorRef,
  assign,
  createActor,
  enqueueActions,
} from 'xstate'
import { nanoid } from 'nanoid'
import { createMutationProxy, getUntracked } from './proxy'
import cloneDeep from 'lodash.clonedeep'

export interface MutationOptions {
  transaction?: Transaction
}

export interface CollectionOptions<T, S extends Schema = Schema> {
  schema?: S
  onMutation?: (changes: { type: string; item: T }[]) => Promise<void>
  debug?: boolean
  actor?: AnyActorRef
}

interface CollectionContext<T> {
  id: string
  items: Map<string, T & { __tracking_id: string }>
  transactionActors: Map<string, AnyActorRef>
  pendingItems: Map<string, T & { __tracking_id: string }>
  lockedItems: Map<string, string> // trackingId -> transactionId
  batchTransaction: {
    actor: AnyActorRef | null
    id: string
    pendingMutations: Array<{
      operation: `insert` | `update` | `delete`
      item: T
      trackingId: string
      transaction?: AnyActorRef
      updater?: (item: T) => void
    }>
    batchScheduled: boolean
  }
  debug: boolean
  schema?: Schema
  onMutation?: (changes: { type: string; item: T }[]) => Promise<void>
}

type CollectionEvent<T> =
  | {
      type: `MUTATE`
      operation: `insert` | `update` | `delete`
      item: T
      trackingId: string
      updater?: (item: T) => void
      transaction?: AnyActorRef
    }
  | { type: `PROCESS_BATCH` }
  | {
      type: `TRANSACTION_COMPLETED`
      transactionId: string
      status: `committed` | `rolledback`
      changes?: Array<{ type: string; item: T }>
    }

const createCollectionMachine = <T extends object>(
  options: CollectionOptions<T> = {}
) =>
  createMachine(
    {
      types: {} as {
        context: CollectionContext<T>
        events: CollectionEvent<T>
      },
      id: `collection`,
      initial: `active`,
      context: {
        id: nanoid(),
        items: new Map<string, T & { __tracking_id: string }>(),
        transactionActors: new Map<string, AnyActorRef>(),
        pendingItems: new Map<string, T & { __tracking_id: string }>(),
        lockedItems: new Map<string, string>(),
        batchTransaction: {
          actor: null,
          id: nanoid(),
          pendingMutations: [],
          batchScheduled: false,
        },
        debug: options.debug ?? false,
        schema: options.schema,
        onMutation: options.onMutation,
      } as CollectionContext<T>,
      states: {
        active: {
          on: {
            MUTATE: [
              {
                guard: ({ event }) => {
                  return !!event.transaction
                },
                actions: [
                  `trackPendingItem`,
                  `forwardToTransaction`,
                  `logMutation`,
                ],
              },
              {
                actions: [
                  `createBatchTransaction`,
                  `queueMutation`,
                  `scheduleBatchIfNeeded`,
                  `logMutation`,
                ],
              },
            ],
            PROCESS_BATCH: {
              actions: [`processPendingMutations`],
            },
            TRANSACTION_COMPLETED: {
              actions: [
                assign(({ context, event }) => {
                  if (!event.changes) return {}

                  console.log(
                    `[Collection ${context.id}] Received TRANSACTION_COMPLETED`,
                    event
                  )

                  // Update items
                  const newItems = new Map(context.items)
                  for (const change of event.changes) {
                    if (change.type === `delete`) {
                      newItems.delete(change.item.__tracking_id)
                    } else {
                      newItems.set(change.item.__tracking_id, change.item)
                    }
                  }

                  // Remove any lockedItems associated with
                  // this transaction
                  const newLocks = new Map(context.lockedItems)
                  newLocks.forEach((value, key) => {
                    if (value === event.transactionId) {
                      newLocks.delete(key)
                    }
                  })

                  // Clean up transaction actors
                  const newTransactionActors = new Map(
                    context.transactionActors
                  )
                  newTransactionActors.delete(event.transactionId)

                  // Reset batch transaction state
                  return {
                    items: newItems,
                    lockedItems: newLocks,
                    transactionActors: newTransactionActors,
                    batchTransaction: {
                      actor: null,
                      pendingMutations: [],
                      batchScheduled: false,
                    },
                    pendingItems: new Map(),
                  }
                }),
                ({ context, event }) => {
                  if (!event.changes || event.status === `rolledback`) return

                  if (context.debug) {
                    console.log(
                      `[Collection ${context.id}] Notifying mutations:`,
                      event.changes
                    )
                  }

                  // Map transaction operations to mutations and call onMutation
                  const seen = new Set()
                  const mutations = event.changes
                    .map((change) => {
                      if (!seen.has(change.item.__tracking_id)) {
                        seen.add(change.item.__tracking_id)
                        return {
                          operation: change.type,
                          item: change.item,
                          delta: change.item.getDelta(),
                        }
                      }
                      return null
                    })
                    .filter(Boolean)

                  context.onMutation?.(mutations).catch((error) => {
                    console.log(
                      `[Collection ${context.id}] Error in onMutation:`,
                      error
                    )
                  })
                },
              ],
            },
          },
        },
      },
    },
    {
      actions: {
        trackPendingItem: assign(({ context, event }) => {
          if (event.type !== `MUTATE`) return {}
          const trackingId = event.trackingId
          if (!trackingId) return {}

          const newPendingItems = new Map(context.pendingItems)
          if (event.operation === `delete`) {
            newPendingItems.delete(trackingId)
          } else {
            newPendingItems.set(trackingId, event.item)
          }
          return { pendingItems: newPendingItems }
        }),
        forwardToTransaction: enqueueActions(({ event, enqueue }) => {
          if (event.type !== `MUTATE` || !event.transaction) return

          // Forward the mutation to the transaction
          if (event.operation === `insert`) {
            enqueue.sendTo(event.transaction, {
              type: `insert`,
              item: event.item,
            })
          } else if (event.operation === `update`) {
            enqueue.sendTo(event.transaction, {
              type: `update`,
              item: event.item,
            })
          } else if (event.operation === `delete`) {
            enqueue.sendTo(event.transaction, {
              type: `delete`,
              item: event.item,
            })
          }
        }),
        createBatchTransaction: enqueueActions(({ context, self, enqueue }) => {
          if (!context.batchTransaction.actor) {
            console.log(`creating batchTransaction.actor`)
            const transaction = new Transaction({
              debug: context.debug,
              parent: self,
            })

            // First update transactionActors
            enqueue.assign({
              transactionActors: (() => {
                const newActors = new Map(context.transactionActors)
                newActors.set(transaction.id(), transaction.actor)
                return newActors
              })(),
            })

            // Then update batchTransaction actor synchronously
            console.log(`assigning actor`)
            enqueue.assign({
              batchTransaction: {
                ...context.batchTransaction,
                actor: transaction.actor,
                id: transaction.id(),
              },
            })
          }
        }),
        queueMutation: assign(({ context, event }) => {
          if (event.type !== `MUTATE`) return {}

          if (!context.batchTransaction.actor) {
            throw new Error(
              `Cannot queue mutation: no batch transaction actor exists`
            )
          }

          return {
            batchTransaction: {
              actor: context.batchTransaction.actor,
              pendingMutations: [
                ...context.batchTransaction.pendingMutations,
                {
                  operation: event.operation,
                  item: event.item,
                  trackingId: event.trackingId,
                  transaction: event.transaction,
                  updater: event.updater,
                },
              ],
            },
          }
        }),
        scheduleBatchIfNeeded: enqueueActions(({ self, context, enqueue }) => {
          if (
            context.batchTransaction.actor &&
            !context.batchTransaction.batchScheduled
          ) {
            console.log(`[Collection ${context.id}] Scheduling PROCESS_BATCH`)
            enqueue.assign({
              batchTransaction: {
                ...context.batchTransaction,
                batchScheduled: true,
              },
            })
            Promise.resolve().then(() => {
              self.send({ type: `PROCESS_BATCH` })
            })
            // enqueue.raise({ type: `PROCESS_BATCH` }, { delay: 0 })
          }
        }),
        processPendingMutations: enqueueActions(({ context, enqueue }) => {
          console.log(
            `[Collection ${context.id}] Processing pending mutations`,
            {
              pendingMutations: context.batchTransaction.pendingMutations,
            }
          )
          console.log(
            `is batchTransaction.actor?`,
            !!context.batchTransaction.actor
          )
          if (!context.batchTransaction.actor) return

          // Forward all mutations to the transaction
          for (const mutation of context.batchTransaction.pendingMutations) {
            if (mutation.operation === `insert`) {
              console.log(
                `[Collection ${context.id}] Sending insert to batch transaction`
              )
              enqueue.sendTo(context.batchTransaction.actor, {
                type: `insert`,
                item: mutation.item,
              })
            } else if (mutation.operation === `update`) {
              console.log(
                `[Collection ${context.id}] Sending update to batch transaction`
              )
              enqueue.sendTo(context.batchTransaction.actor, {
                type: `update`,
                item: mutation.item,
              })
            } else if (mutation.operation === `delete`) {
              console.log(
                `[Collection ${context.id}] Sending delete to batch transaction`
              )
              enqueue.sendTo(context.batchTransaction.actor, {
                type: `delete`,
                item: mutation.item,
              })
            }
          }

          // Commit the transaction and reset the scheduled flag
          console.log(
            `[Collection ${context.id}] Sending COMMIT to batch transaction`
          )
          enqueue.sendTo(context.batchTransaction.actor, { type: `COMMIT` })
          enqueue.assign({
            batchTransaction: {
              ...context.batchTransaction,
              actor: null,
              batchScheduled: false,
            },
          })
        }),
        updateItems: assign(({ context, event }) => {
          if (event.type !== `TRANSACTION_COMPLETED` || !event.changes) {
            return {}
          }

          console.log(`updateItems`)

          const newItems = new Map(context.items)

          for (const change of event.changes) {
            if (change.type === `delete`) {
              newItems.delete(change.item.__tracking_id)
            } else {
              newItems.set(change.item.__tracking_id, change.item)
            }
          }

          return {
            items: newItems,
            batchTransaction: {
              actor: null,
              pendingMutations: [],
            },
            pendingItems: new Map(),
          }
        }),
        cleanupTransaction: assign(({ context, event }) => {
          if (event.type !== `TRANSACTION_COMPLETED`) return {}
          const newTransactionActors = new Map(context.transactionActors)
          newTransactionActors.delete(event.transactionId)
          return { transactionActors: newTransactionActors }
        }),
        notifyMutationsIfNeeded: ({ context, event }) => {
          if (
            event.type !== `TRANSACTION_COMPLETED` ||
            !event.changes ||
            event.status === `rolledback`
          )
            return
          if (context.debug) {
            console.log(
              `[Collection ${context.id}] Notifying mutations:`,
              event.changes
            )
          }
          context.onMutation?.(event.changes).catch((error) => {
            console.log(
              `[Collection ${context.id}] Error in onMutation:`,
              error
            )
          })
        },
        logMutation: ({ context, event }) => {
          if (event.type !== `MUTATE` || !context.debug) return
          console.log(`[Collection ${context.id}] Mutation:`, {
            operation: event.operation,
            item: event.item,
            hasTransaction: !!event.transaction,
          })
        },
        logBatchProcess: ({ context }) => {
          if (!context.debug) return
          console.log(`[Collection ${context.id}] Processing batch`, {
            pendingMutations: context.batchTransaction.pendingMutations.length,
          })
        },
        logTransactionCompleted: ({ context, event }) => {
          if (event.type !== `TRANSACTION_COMPLETED` || !context.debug) return
          console.log(`[Collection ${context.id}] Transaction completed:`, {
            id: event.transactionId,
            status: event.status,
            changes: event.changes,
          })
        },
      },
    }
  )

export class Collection<T extends object, S extends Schema = Schema> {
  public actor: AnyActorRef
  private context: CollectionContext<T>

  constructor(private options: CollectionOptions<T, S> = {}) {
    const machine = createCollectionMachine({ ...options })
    this.actor = createActor(machine)
    this.actor.subscribe((snapshot) => {
      console.log(`[Collection] state:`, snapshot.value)
      this.context = snapshot.context
    })
    this.actor.start()
    this.context = this.actor.getSnapshot().context

    if (this.options.debug) {
      console.log(
        `[Collection ${this.context.id}] Created with options:`,
        options
      )
    }
  }

  isItemLocked(trackingId: string, transactionId?: string): boolean {
    const lockedBy = this.context.lockedItems.get(trackingId)
    if (!lockedBy) return false
    if (!transactionId) return true
    return lockedBy !== transactionId
  }

  lockItem(trackingId: string, transactionId: string) {
    console.log(`lockItem called`, { trackingId, transactionId })
    if (this.isItemLocked(trackingId, transactionId)) {
      throw new Error(
        `Item ${trackingId} is already locked by transaction ${this.context.lockedItems.get(
          trackingId
        )}`
      )
    }
    this.context.lockedItems.set(trackingId, transactionId)
  }

  unlockItem(trackingId: string, transactionId: string) {
    const lockedBy = this.context.lockedItems.get(trackingId)
    if (lockedBy === transactionId) {
      this.context.lockedItems.delete(trackingId)
    }
  }

  private validateItem(item: T) {
    if (this.context.debug) {
      console.log(`[Collection ${this.context.id}] Validating item:`, item)
    }

    const result = this.context.schema[`~standard`].validate(item)
    console.log({ result: result.issues })
    if (`issues` in result) {
      if (this.context.debug) {
        console.log(
          `[Collection ${this.context.id}] Validation failed:`,
          result.issues
        )
      }
      throw new SchemaError(result.issues)
    }
  }

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

  private createTrackedProxy(item: T & { __tracking_id: string }) {
    // // Create a new object with the properties from the item
    // const clone = { ...item }

    // Create proxy around clone to track deltas
    const proxy = createMutationProxy(item)

    // Store clone in pendingItems
    console.log(`createTrackedProxy`, { item, proxy })
    this.context.pendingItems.set(item.__tracking_id, proxy)

    return proxy as T & { __tracking_id: string }
  }

  insert(item: T, options: MutationOptions = {}): T {
    if (this.options.debug) {
      console.log(`[Collection ${this.context.id}] Insert:`, {
        item,
        hasTransaction: !!options.transaction,
      })
    }

    // Validate the item before doing anything else
    if (this.options.schema) {
      this.validateItem(item)
    }

    const trackingId = nanoid()
    const itemWithTracking = { ...item, __tracking_id: trackingId }

    const proxy = this.createTrackedProxy(itemWithTracking)
    console.log({ proxy, pendingItems: this.context.pendingItems })

    const transactionId = options.transaction
      ? options.transaction.id()
      : `batch-transaction`

    console.log({
      transactionId,
      options,
      batchTransaction: this.context.batchTransaction,
    })
    this.lockItem(trackingId, transactionId)

    this.actor.send({
      type: `MUTATE`,
      operation: `insert`,
      item: proxy,
      trackingId,
      transaction: options.transaction?.actor,
    })

    return proxy
  }

  private getTrackingId(item: T & { __tracking_id?: string }): string {
    if (!item.__tracking_id) {
      throw new Error(`Item does not have a tracking ID`)
    }
    return item.__tracking_id
  }

  update(
    item: T & { __tracking_id?: string },
    updater: (item: T) => void,
    options: MutationOptions = {}
  ) {
    if (this.options.debug) {
      console.log(`[Collection ${this.context.id}] Update:`, {
        item,
        hasTransaction: !!options.transaction,
      })
    }

    const trackingId = this.getTrackingId(item)
    const transactionId = options.transaction
      ? options.transaction.id()
      : `batch-transaction`

    console.log({
      transactionId,
      options,
      batchTransaction: this.context.batchTransaction,
    })

    // Try to get a lock on this item.
    this.lockItem(trackingId, transactionId)

    // Check if we already have a proxy for this item
    const existingProxy = this.context.pendingItems.get(trackingId)
    console.log(1, { existingProxy })
    if (existingProxy) {
      // Run updater which may throw validation errors
      if (this.options.schema) {
        // Get raw object using getUntracked
        console.log(`isProxy`, existingProxy.__isProxy)
        const rawObject = getUntracked({ ...existingProxy })
        console.log(2, { existingProxy, rawObject })
        const tempProxy = createMutationProxy(cloneDeep(existingProxy))
        updater(tempProxy as T)
        console.log({ tempProxy })
        this.validateItem(tempProxy)
      }
      console.log(
        `figuring out untracked`,
        existingProxy,
        getUntracked(existingProxy)
      )
      // If validation passed, apply to real proxy
      updater(existingProxy as T)
      this.actor.send({
        type: `MUTATE`,
        operation: `update`,
        item: existingProxy,
        trackingId,
        updater,
        transaction: options.transaction?.actor,
      })

      return existingProxy
    }

    console.log({
      item,
      trackingId,
      items: this.context.items,
      pendingItems: this.context.pendingItems,
    })
    // Get the original item
    const existingItem = this.context.items.get(trackingId)
    if (!existingItem) {
      throw new Error(`Item not found`)
    }

    // Create new proxy and validate changes
    const proxy = this.createTrackedProxy(existingItem)
    if (this.options.schema) {
      const tempProxy = createMutationProxy(proxy)
      updater(tempProxy as T)
      this.validateItem(tempProxy)
    }

    // If validation passed, apply to real proxy
    updater(proxy as T)
    this.actor.send({
      type: `MUTATE`,
      operation: `update`,
      item: proxy,
      trackingId,
      updater,
      transaction: options.transaction?.actor,
    })

    return proxy
  }

  remove(
    item: T & { __tracking_id?: string },
    options: MutationOptions = {}
  ): void {
    if (this.options.debug) {
      console.log(`[Collection ${this.context.id}] Remove:`, {
        item,
        hasTransaction: !!options.transaction,
      })
    }

    let foundId: string | undefined
    for (const [id, storedItem] of this.context.items.entries()) {
      if (
        storedItem === item ||
        storedItem.__tracking_id === item.__tracking_id
      ) {
        foundId = id
        break
      }
    }
    if (!foundId) {
      for (const [id, storedItem] of this.context.pendingItems.entries()) {
        if (
          storedItem === item ||
          storedItem.__tracking_id === item.__tracking_id
        ) {
          foundId = id
          break
        }
      }
    }

    if (!foundId) {
      if (this.options.debug) {
        console.error(
          `[Collection ${this.context.id}] Remove failed: Item not found`
        )
      }
      throw new Error(`Item not found`)
    }

    this.actor.send({
      type: `MUTATE`,
      operation: `delete`,
      item: {},
      trackingId: item.__tracking_id,
      transaction: options.transaction?.actor,
    })
  }

  getItems(): T[] {
    if (this.options.debug) {
      console.log(`[Collection ${this.context.id}] Getting all items`)
    }

    // Get all tracking IDs from both maps
    const confirmedIds = new Set(this.context.items.keys())
    const pendingIds = new Set(this.context.pendingItems.keys())
    const allIds = new Set([...confirmedIds, ...pendingIds])

    // Return items, preferring pending versions over confirmed ones
    return Array.from(allIds).map((trackingId) => {
      // If there's a pending version (including pending inserts), return it
      const pendingItem = this.context.pendingItems.get(trackingId)
      if (pendingItem) return pendingItem

      // Otherwise return the confirmed version with tracking ID
      const confirmedItem = this.context.items.get(trackingId)!
      return { ...confirmedItem, __tracking_id: trackingId }
    })
  }
}
