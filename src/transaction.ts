import { createMutationProxy } from './proxy'

export type TransactionState = 'pending' | 'committed' | 'rolled-back'

export class Transaction {
  private changes: Array<{
    target: object
    change: any
  }> = []
  private state: TransactionState = 'pending'
  private locks = new WeakSet<object>()

  constructor(private options: {
    onCommit?: () => Promise<void> | void
    onRollback?: () => Promise<void> | void
  } = {}) {}

  track<T extends object>(target: T): T {
    if (this.state !== 'pending') {
      throw new Error('Cannot track changes in a non-pending transaction')
    }

    if (this.locks.has(target)) {
      throw new Error('Object is already locked by another transaction')
    }

    this.locks.add(target)

    return createMutationProxy(target, {
      onMutation: (change) => {
        this.changes.push({
          target,
          change,
        })
      },
    })
  }

  async commit(): Promise<void> {
    if (this.state !== 'pending') {
      throw new Error('Transaction is not pending')
    }

    try {
      await this.options.onCommit?.()
      this.state = 'committed'
    } catch (error) {
      await this.rollback()
      throw error
    } finally {
      this.clearLocks()
    }
  }

  async rollback(): Promise<void> {
    if (this.state !== 'pending') {
      throw new Error('Transaction is not pending')
    }

    try {
      // Reverse changes in opposite order
      for (let i = this.changes.length - 1; i >= 0; i--) {
        const { target, change } = this.changes[i]
        if (change.type === 'set') {
          // Restore previous value
          Reflect.set(target, change.path[change.path.length - 1], change.previousValue)
        } else if (change.type === 'delete') {
          // Restore deleted property
          Reflect.set(target, change.path[change.path.length - 1], change.previousValue)
        }
      }

      await this.options.onRollback?.()
      this.state = 'rolled-back'
    } finally {
      this.clearLocks()
    }
  }

  private clearLocks() {
    this.locks = new WeakSet()
  }

  getState(): TransactionState {
    return this.state
  }

  getChanges() {
    return [...this.changes]
  }
}
