import {
  createMachine,
  createActor,
  enqueueActions,
  assign,
  type AnyActorRef,
  type ActorRef,
  type State,
} from 'xstate'
import { nanoid } from 'nanoid'

export type TransactionState = `pending` | `committed` | `rolledback`

interface TransactionOperation<T extends object> {
  type: `insert` | `update` | `delete`
  item: T
  trackingId?: string
}

interface TransactionStateContext<T extends object> {
  operations: TransactionOperation<T>[]
  status: TransactionState
  error?: Error
}

interface TransactionOptions<T extends object> {
  parent: ActorRef<TransactionEvent<T>, TransactionStateContext<T>>
  debug?: boolean
}

type TransactionEvent<T extends object> =
  | { type: `insert`; item: T }
  | { type: `update`; item: T }
  | { type: `delete`; item: T }
  | { type: `COMMIT` }
  | { type: `ROLLBACK` }
  | {
      type: `NOTIFY_CHANGES`
      transactionId: string
      status: TransactionState
      changes: Array<TransactionOperation<T>>
    }
  | {
      type: `TRANSACTION_COMPLETED`
      transactionId: string
      status: TransactionState
      changes: Array<TransactionOperation<T>>
    }
  | {
      type: `REGISTER_TRANSACTION`
      transactionId: string
      actor: AnyActorRef
    }

interface TransactionContext<T extends object> {
  id: string
  debug: boolean
  state: `began` | `committing` | `rollingBack`
  operations: TransactionOperation<T>[]
}

const createTransactionMachine = <T extends object>(
  options: TransactionOptions<T>
) =>
  createMachine(
    {
      id: `transaction`,
      types: {} as {
        context: TransactionContext<T>
        events: TransactionEvent<T>
      },
      context: {
        id: nanoid(),
        debug: options.debug ?? false,
        state: `began`,
        operations: [],
      },
      initial: `began`,
      states: {
        began: {
          on: {
            insert: {
              actions: [`logOperation`, `addOperation`],
            },
            update: {
              actions: [`logOperation`, `addOperation`],
            },
            delete: {
              actions: [`logOperation`, `addOperation`],
            },
            COMMIT: {
              target: `committing`,
              actions: [`logEvent`, `logState`, `handleCommit`],
            },
            ROLLBACK: {
              target: `rollingBack`,
              actions: [`logEvent`, `logState`],
            },
          },
        },
        committing: {
          entry: `logCommit`,
        },
        rollingBack: {
          entry: `logRollback`,
          on: {
            NOTIFY_CHANGES: {
              actions: [
                assign({
                  state: ({ event }) => event.status,
                }),
                ({ event }) => {
                  console.log(`NOTIFY_CHANGES`, { event, options })
                },
              ],
            },
          },
        },
      },
    },
    {
      actions: {
        addOperation: assign({
          operations: ({ context, event }) => {
            console.log(`[Transaction ${context.id}] Adding operation:`, event)
            return [
              ...context.operations,
              {
                type: event.type,
                item: event.item,
                trackingId: event.trackingId,
              },
            ]
          },
        }),
        handleCommit: enqueueActions(({ context, enqueue }) => {
          console.log(`[Transaction ${context.id}] Handling COMMIT`)

          console.log(`handleCommit`, !!options.parent)
          // Send completion event to parent
          if (options.parent) {
            console.log(
              `[Transaction ${context.id}] Sending completion to parent`
            )
            enqueue.sendTo(options.parent, {
              type: `TRANSACTION_COMPLETED`,
              transactionId: context.id,
              status: `committed`,
              changes: context.operations.map((op) => ({
                type: op.type,
                item: op.item,
              })),
            })
          } else {
            console.log(
              `[Transaction ${context.id}] No parent actor to send completion to`
            )
          }
        }),
        logState: ({ context, self }) => {
          if (context.debug) {
            console.log(
              `[Transaction ${context.id}] State:`,
              self.getSnapshot().value
            )
          }
        },
        logEvent: ({ context, event }) => {
          if (context.debug) {
            console.log(`[Transaction ${context.id}] Event:`, event)
          }
        },
        logOperation: ({ context, event }) => {
          if (context.debug) {
            console.log(`[Transaction ${context.id}] Operation:`, event)
          }
        },
        logCommit: ({ context }) => {
          if (context.debug) {
            console.log(`[Transaction ${context.id}] Committed`)
          }
        },
        logRollback: ({ context }) => {
          if (context.debug) {
            console.log(`[Transaction ${context.id}] Rolled back`)
          }
        },
      },
    }
  )

export class TransactionStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `TransactionStateError`
  }
}

export class Transaction<T extends object = object> {
  public actor: AnyActorRef
  private state: State<TransactionContext<T>, TransactionEvent<T>>

  constructor(options: TransactionOptions<T>) {
    if (!options.parent) {
      throw new Error(`Transaction requires a parent actor`)
    }
    const machine = createTransactionMachine(options)
    const actor = createActor(machine)
    actor.subscribe((state) => {
      this.state = state
    })
    actor.start()
    this.actor = actor

    this.state = actor.getSnapshot()

    options.parent.send({
      type: `REGISTER_TRANSACTION`,
      transactionId: this.id(),
      actor: this.actor,
    })
  }

  isBegan(): boolean {
    return this.state.value === `began`
  }

  isCommitted(): boolean {
    return this.state.value === `committing`
  }

  isRolledback(): boolean {
    return this.state.value === `rollingBack`
  }

  id(): string {
    return this.state.context.id
  }

  commit(): void {
    this.actor.send({ type: `COMMIT` })
  }

  rollback(): void {
    this.actor.send({ type: `ROLLBACK` })
  }

  insert(item: T): void {
    if (this.state.value === `began`) {
      this.actor.send({ type: `insert`, item, trackingId: nanoid() })
    } else {
      throw new TransactionStateError(
        `Cannot insert: transaction is not in began state (current state: ${this.state.value})`
      )
    }
  }

  update(item: T): void {
    if (this.state.value === `began`) {
      this.actor.send({ type: `update`, item, trackingId: nanoid() })
    } else {
      throw new TransactionStateError(
        `Cannot update: transaction is not in began state (current state: ${this.state.value})`
      )
    }
  }

  delete(item: T): void {
    if (this.state.value === `began`) {
      this.actor.send({ type: `delete`, item, trackingId: nanoid() })
    } else {
      throw new TransactionStateError(
        `Cannot delete: transaction is not in began state (current state: ${this.state.value})`
      )
    }
  }

  getOperations(): TransactionOperation<T>[] {
    return this.state.context.operations
  }
}
