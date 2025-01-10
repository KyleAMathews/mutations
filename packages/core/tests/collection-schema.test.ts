import { describe, test, expect } from 'vitest'
import {
  Collection,
  StandardSchemaV1,
  SchemaError,
  Transaction,
  type SyncEngine,
  type Row,
} from '../src'
import { z } from 'zod'

interface Todo extends Row {
  id: string
  title: string
  completed: boolean
}

interface NestedTodo extends Row {
  id: string
  details: {
    title: string
    priority: number
  }
}

class NoopSyncEngine<T extends Row> implements SyncEngine<T> {
  subscribe() {
    // Do nothing
    return () => {}
  }
}

function createZodSchema<T>(schema: z.ZodType<T>): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: `test`,
      validate: (value: unknown) => {
        try {
          const result = schema.parse(value)
          return { value: result }
        } catch (error) {
          if (error instanceof z.ZodError) {
            return {
              issues: error.errors.map((issue) => ({
                message: issue.message,
                path: issue.path,
              })),
            }
          }
          throw error
        }
      },
    },
  }
}

describe(`Collection with Schema Validation`, () => {
  describe(`Schema Creation`, () => {
    test(`should create a collection with a schema`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string(),
          completed: z.boolean(),
        })
      )
      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      expect(collection).toBeDefined()
    })

    test(`should create a collection without a schema`, () => {
      const collection = new Collection<Todo>({
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      expect(collection).toBeDefined()
    })
  })

  describe(`Insert Operations`, () => {
    test(`should insert valid data`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string(),
          completed: z.boolean(),
        })
      )

      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      const item = collection.insert({
        id: `1`,
        title: `Test`,
        completed: false,
      })

      expect(item.title).toBe(`Test`)
      expect(collection.getItems()).toHaveLength(1)
      expect(collection.getItems()[0].title).toBe(`Test`)
    })

    test(`should reject invalid data`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string().min(1),
          completed: z.boolean(),
        })
      )

      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      const todo = {
        id: `1`,
        title: ``,
        completed: false,
      }

      expect(() => collection.insert(todo)).toThrow(SchemaError)
    })
  })

  describe(`Update Operations`, () => {
    test(`should track changes`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string().min(1),
          completed: z.boolean(),
        })
      )

      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      let item = collection.insert({
        id: `1`,
        title: `Original`,
        completed: false,
      })

      item = collection.update(item, (todo) => {
        todo.title = `Updated`
      })

      expect(item.title).toBe(`Updated`)
      expect(collection.getItems()[0].title).toBe(`Updated`)
    })

    test(`should reject invalid updates`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string().min(1),
          completed: z.boolean(),
        })
      )

      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      const item = collection.insert({
        id: `1`,
        title: `Test`,
        completed: false,
      })

      expect(() =>
        collection.update(item, (todo) => {
          todo.title = ``
        })
      ).toThrow(SchemaError)

      expect(item.title).toBe(`Test`)
      expect(collection.getItems()[0].title).toBe(`Test`)
    })
  })

  describe(`Transaction Support`, () => {
    test(`should handle changes within transactions`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string().min(1),
          completed: z.boolean(),
        })
      )

      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      const transaction = new Transaction({
        parent: collection.actor,
        debug: true,
      })
      const item = collection.insert(
        {
          id: `1`,
          title: `Original`,
          completed: false,
        },
        { transaction }
      )

      collection.update(
        item,
        (todo) => {
          todo.title = `Updated`
        },
        { transaction }
      )

      expect(item.title).toBe(`Updated`)
      transaction.commit()
    })

    test(`should validate changes within transactions`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          title: z.string().min(1),
          completed: z.boolean(),
        })
      )

      const collection = new Collection<Todo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      const transaction = new Transaction({
        parent: collection.actor,
        debug: true,
      })
      const item = collection.insert(
        {
          id: `1`,
          title: `Test`,
          completed: false,
        },
        { transaction }
      )

      expect(() => {
        collection.update(
          item,
          (todo) => {
            todo.title = ``
          },
          { transaction }
        )
      }).toThrow(SchemaError)
    })
  })

  describe(`Nested Updates`, () => {
    test(`should handle nested updates`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          details: z.object({
            title: z.string(),
            priority: z.number().min(1).max(5),
          }),
        })
      )

      const collection = new Collection<NestedTodo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })
      let item = collection.insert({
        id: `1`,
        details: { title: `Test`, priority: 3 },
      })

      item = collection.update(item, (todo) => {
        todo.details.priority = 4
      })

      expect(item.details.priority).toBe(4)
      expect(collection.getItems()[0].details.priority).toBe(4)

      expect(() =>
        collection.update(item, (todo) => {
          todo.details.priority = 6
        })
      ).toThrow(SchemaError)

      expect(item.details.priority).toBe(4)
    })

    test(`should validate updates in transactions`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          details: z.object({
            title: z.string(),
            priority: z.number().min(1).max(5),
          }),
        })
      )

      const collection = new Collection<NestedTodo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })

      const tx = new Transaction({ parent: collection.actor })
      const item = collection.insert(
        {
          id: `1`,
          details: { title: `Test`, priority: 3 },
        },
        { transaction: tx }
      )

      expect(() =>
        collection.update(
          item,
          (todo) => {
            todo.details.priority = 6
          },
          { transaction: tx }
        )
      ).toThrow(SchemaError)

      expect(item.details.priority).toBe(3)
    })

    test(`should validate nested updates in transactions`, () => {
      const schema = createZodSchema(
        z.object({
          id: z.string(),
          details: z.object({
            title: z.string(),
            priority: z.number().min(1).max(5),
          }),
        })
      )

      const collection = new Collection<NestedTodo>({
        schema,
        debug: true,
        syncEngine: new NoopSyncEngine(),
      })

      const tx = new Transaction({ parent: collection.actor })
      const item = collection.insert(
        {
          id: `1`,
          details: { title: `Test`, priority: 3 },
        },
        { transaction: tx }
      )

      expect(() =>
        collection.update(
          item,
          (todo) => {
            todo.details.priority = 6
          },
          { transaction: tx }
        )
      ).toThrow(SchemaError)

      expect(item.details.priority).toBe(3)
    })
  })
})
