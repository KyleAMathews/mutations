import { Transaction } from './transaction'

export interface MutationOptions {
  transaction?: Transaction
}

export interface CollectionOptions<T> {
  validate?: (item: T) => boolean | Promise<boolean>
  onMutation?: (
    changes: { type: `insert` | `update` | `remove`; item: T }[]
  ) => Promise<void>
}

export class Collection<T extends object> {
  private items: T[] = []

  constructor(private options: CollectionOptions<T> = {}) {}

  async insert(item: T, options: MutationOptions = {}): Promise<T> {
    if (this.options.validate) {
      const isValid = await this.options.validate(item)
      if (!isValid) {
        throw new Error(`Invalid item`)
      }
    }

    const transaction =
      options.transaction ||
      new Transaction({
        onCommit: async () => {
          await this.options.onMutation?.([{ type: `insert`, item }])
        },
      })

    const trackedItem = transaction.track(item)
    this.items.push(trackedItem)

    if (!options.transaction) {
      await transaction.commit()
    }

    return trackedItem
  }

  async update(
    item: T,
    updater: (item: T) => void,
    options: MutationOptions = {}
  ): Promise<void> {
    const index = this.items.indexOf(item)
    if (index === -1) {
      throw new Error(`Item not found`)
    }

    const transaction =
      options.transaction ||
      new Transaction({
        onCommit: async () => {
          await this.options.onMutation?.([{ type: `update`, item }])
        },
      })

    const trackedItem = transaction.track(item)
    updater(trackedItem)

    if (this.options.validate) {
      const isValid = await this.options.validate(trackedItem)
      if (!isValid) {
        throw new Error(`Invalid update`)
      }
    }

    if (!options.transaction) {
      await transaction.commit()
    }
  }

  async remove(item: T, options: MutationOptions = {}): Promise<void> {
    const index = this.items.indexOf(item)
    if (index === -1) {
      throw new Error(`Item not found`)
    }

    const transaction =
      options.transaction ||
      new Transaction({
        onCommit: async () => {
          await this.options.onMutation?.([{ type: `remove`, item }])
        },
      })

    this.items.splice(index, 1)

    if (!options.transaction) {
      await transaction.commit()
    }
  }

  getItems(): T[] {
    return [...this.items]
  }
}
