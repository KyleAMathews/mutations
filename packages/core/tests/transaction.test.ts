import { describe, it, expect, vi } from 'vitest'
import { Transaction } from '../src/transaction'

describe(`Transaction`, () => {
  describe(`Basic Operations`, () => {
    it(`should create a transaction in pending state`, () => {
      const transaction = new Transaction()
      expect(transaction.isPending()).toBe(true)
      expect(transaction.isCommitted()).toBe(false)
      expect(transaction.isRolledback()).toBe(false)
    })

    it(`should track changes to an object`, () => {
      const transaction = new Transaction()
      const original = { name: `Test`, value: 42 }
      const proxy = transaction.track(original)

      proxy.name = `Updated`
      expect(proxy.name).toBe(`Updated`)
      expect(original.name).toBe(`Updated`) // Direct updates are reflected
      expect(transaction.getCurrentValue(proxy)).toEqual({
        name: `Updated`,
        value: 42,
      })
    })

    it(`should handle nested objects`, () => {
      const transaction = new Transaction()
      const original = {
        name: `Test`,
        nested: { value: 42 },
      }
      const proxy = transaction.track(original)

      proxy.nested.value = 100
      expect(proxy.nested.value).toBe(100)
      expect(original.nested.value).toBe(100) // Direct updates are reflected
      expect(transaction.getCurrentValue(proxy)).toEqual({
        name: `Test`,
        nested: { value: 100 },
      })
    })
  })

  describe(`State Management`, () => {
    it(`should commit changes`, () => {
      const transaction = new Transaction()
      const original = { name: `Test`, value: 42 }
      const proxy = transaction.track(original)

      proxy.name = `Updated`
      transaction.commit()

      expect(transaction.isCommitted()).toBe(true)
      expect(transaction.isPending()).toBe(false)
      expect(original.name).toBe(`Updated`)
    })

    it(`should rollback changes`, () => {
      const transaction = new Transaction()
      const original = { name: `Test`, value: 42 }
      const proxy = transaction.track(original)

      proxy.name = `Updated`
      transaction.rollback()

      expect(transaction.isRolledback()).toBe(true)
      expect(transaction.isPending()).toBe(false)
      expect(original.name).toBe(`Test`)
    })

    it(`should prevent modifications after commit`, () => {
      const transaction = new Transaction()
      const original = { name: `Test`, value: 42 }
      const proxy = transaction.track(original)

      transaction.commit()
      expect(() => {
        proxy.name = `Updated`
      }).toThrow(`Transaction is not pending`)
    })

    it(`should prevent modifications after rollback`, () => {
      const transaction = new Transaction()
      const original = { name: `Test`, value: 42 }
      const proxy = transaction.track(original)

      transaction.rollback()
      expect(() => {
        proxy.name = `Updated`
      }).toThrow(`Transaction is not pending`)
    })
  })

  describe(`Object Reference Handling`, () => {
    it(`should reuse existing proxies`, () => {
      const transaction = new Transaction()
      const shared = { value: 42 }
      const obj1 = { ref: shared }
      const obj2 = { ref: shared }

      const proxy1 = transaction.track(obj1)
      const proxy2 = transaction.track(obj2)

      proxy1.ref.value = 100
      expect(proxy2.ref.value).toBe(100)
    })

    it(`should handle circular references`, () => {
      const transaction = new Transaction()
      const obj: Record<string, unknown> = { name: `Test` }
      obj.self = obj as Record<string, unknown>

      const proxy = transaction.track(obj)
      proxy.name = `Updated`

      expect(proxy.self.name).toBe(`Updated`)
      const currentValue = transaction.getCurrentValue(proxy)
      expect(currentValue.name).toBe(`Updated`)
      expect(currentValue.self.name).toBe(`Updated`)
      expect(currentValue.self).toStrictEqual(currentValue) // Circular reference is preserved
    })
  })

  describe(`Callbacks`, () => {
    it(`should call onCommit callback`, async () => {
      const onCommit = vi.fn()
      const transaction = new Transaction({ onCommit })
      const original = { name: `Test` }
      const proxy = transaction.track(original)

      proxy.name = `Updated`
      transaction.commit()

      expect(onCommit).toHaveBeenCalled()
    })
  })
})
