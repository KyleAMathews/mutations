import { describe, it, expect } from 'vitest'
import { SchemaError, StandardSchemaV1, Result, Issue } from '../src/schema'
import { z } from 'zod'

describe(`Schema`, () => {
  describe(`StandardSchemaV1`, () => {
    it(`should implement the standard schema interface with zod`, async () => {
      const zodSchema = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      })

      const standardSchema: StandardSchemaV1 = {
        '~standard': {
          version: 1,
          vendor: `zod`,
          validate: async (value) => {
            try {
              const result = await zodSchema.parseAsync(value)
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
          types: {
            input: {} as z.input<typeof zodSchema>,
            output: {} as z.output<typeof zodSchema>,
          },
        },
      }

      // Test valid input
      const validInput = { name: `Test`, age: 25 }
      const validResult = await standardSchema[`~standard`].validate(validInput)
      expect(validResult.value).toEqual(validInput)
      expect(validResult.issues).toBeUndefined()

      // Test invalid input
      const invalidInput = { name: ``, age: -1 }
      const invalidResult =
        await standardSchema[`~standard`].validate(invalidInput)
      expect(invalidResult.value).toBeUndefined()
      expect(invalidResult.issues).toBeDefined()
      expect(invalidResult.issues?.length).toBeGreaterThan(0)
    })
  })

  describe(`Result and Issue`, () => {
    it(`should handle successful validation result`, () => {
      const result: Result<string> = {
        value: `test`,
      }
      expect(result.value).toBe(`test`)
      expect(result.issues).toBeUndefined()
    })

    it(`should handle failed validation result`, () => {
      const result: Result<string> = {
        issues: [
          {
            message: `Invalid value`,
            path: [`field`, { key: `nested` }, 0],
          },
        ],
      }
      expect(result.value).toBeUndefined()
      expect(result.issues).toHaveLength(1)
      expect(result.issues![0].message).toBe(`Invalid value`)
      expect(result.issues![0].path).toEqual([`field`, { key: `nested` }, 0])
    })
  })

  describe(`SchemaError`, () => {
    it(`should create error with single issue`, () => {
      const issues: Issue[] = [{ message: `Invalid value` }]
      const error = new SchemaError(issues)

      expect(error.name).toBe(`SchemaError`)
      expect(error.message).toBe(`Invalid value`)
      expect(error.issues).toBe(issues)
    })

    it(`should create error with multiple issues`, () => {
      const issues: Issue[] = [
        { message: `Invalid name` },
        { message: `Invalid age` },
      ]
      const error = new SchemaError(issues)

      expect(error.name).toBe(`SchemaError`)
      expect(error.message).toBe(`Invalid name`)
      expect(error.issues).toBe(issues)
    })

    it(`should handle empty issues array`, () => {
      const error = new SchemaError([])
      expect(error.message).toBe(`Validation failed`)
    })
  })

  describe(`Type Inference`, () => {
    // Note: These tests are compile-time checks
    it(`should infer input and output types`, () => {
      type Person = {
        name: string
        age: number
      }

      const schema: StandardSchemaV1<Person, Person> = {
        '~standard': {
          version: 1,
          vendor: `test`,
          validate: () => ({ value: { name: `Test`, age: 25 } }),
          types: {
            input: {} as Person,
            output: {} as Person,
          },
        },
      }

      // Type assertion test (this is a compile-time check)
      type Input = (typeof schema)[`~standard`][`types`][`input`]
      type Output = (typeof schema)[`~standard`][`types`][`output`]

      const input: Input = { name: `Test`, age: 25 }
      const output: Output = { name: `Test`, age: 25 }

      expect(input).toEqual(output)
    })
  })
})
