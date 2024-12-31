import { describe, it, expect } from 'vitest'
import { Transaction, TransactionStateError } from '../src/transaction'

describe(`Transaction`, () => {
  describe(`Basic Operations`, () => {
    it(`should create a transaction in began state`, () => {
      const transaction = new Transaction()
      expect(transaction.isBegan()).toBe(true)
      expect(transaction.isCommitted()).toBe(false)
      expect(transaction.isRolledback()).toBe(false)
    })

    it(`should track insert operations`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.insert(item)
      const operations = transaction.getOperations()
      expect(operations).toHaveLength(1)
      expect(operations[0]).toMatchObject({
        type: `insert`,
        item,
      })
      expect(operations[0].trackingId).toBeDefined()
    })

    it(`should track update operations`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.update(item)
      const operations = transaction.getOperations()
      expect(operations).toHaveLength(1)
      expect(operations[0]).toMatchObject({
        type: `update`,
        item,
      })
      expect(operations[0].trackingId).toBeDefined()
    })

    it(`should track delete operations`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.delete(item)
      const operations = transaction.getOperations()
      expect(operations).toHaveLength(1)
      expect(operations[0]).toMatchObject({
        type: `delete`,
        item,
      })
      expect(operations[0].trackingId).toBeDefined()
    })
  })

  describe(`State Management`, () => {
    it(`should commit changes`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.update(item)
      transaction.commit()

      expect(transaction.isCommitted()).toBe(true)
      expect(transaction.isBegan()).toBe(false)
    })

    it(`should rollback changes`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.update(item)
      transaction.rollback()

      expect(transaction.isRolledback()).toBe(true)
      expect(transaction.isBegan()).toBe(false)
    })

    it(`should prevent modifications after commit`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.commit()
      expect(() => {
        transaction.update(item)
      }).toThrow(TransactionStateError)
      expect(() => {
        transaction.update(item)
      }).toThrow(
        `Cannot update: transaction is not in began state (current state: committing)`
      )
    })

    it(`should prevent modifications after rollback`, () => {
      const transaction = new Transaction()
      const item = { name: `Test`, value: 42 }

      transaction.rollback()
      expect(() => {
        transaction.update(item)
      }).toThrow(TransactionStateError)
      expect(() => {
        transaction.update(item)
      }).toThrow(
        `Cannot update: transaction is not in began state (current state: rollingBack)`
      )
    })
  })

  describe(`Object Reference Handling`, () => {
    it(`should reuse existing proxies`, () => {
      const transaction = new Transaction()
      const shared = { value: 42 }
      const obj1 = { ref: shared }
      const obj2 = { ref: shared }

      transaction.insert(obj1)
      transaction.insert(obj2)

      const operations = transaction.getOperations()
      expect(operations).toHaveLength(2)
      expect(operations[0]).toMatchObject({
        type: `insert`,
        item: obj1,
      })
      expect(operations[1]).toMatchObject({
        type: `insert`,
        item: obj2,
      })
      expect(operations[0].trackingId).toBeDefined()
      expect(operations[1].trackingId).toBeDefined()
    })

    it(`should handle circular references`, () => {
      const transaction = new Transaction()
      const obj: Record<string, unknown> = { name: `Test` }
      obj.self = obj as Record<string, unknown>

      transaction.insert(obj)

      const operations = transaction.getOperations()
      expect(operations).toHaveLength(1)
      expect(operations[0]).toMatchObject({
        type: `insert`,
        item: obj,
      })
      expect(operations[0].trackingId).toBeDefined()
    })
  })
})
