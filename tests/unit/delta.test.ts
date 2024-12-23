import { describe, it, expect } from 'vitest'
import { createMutationProxy } from '../../src/proxy'
import { DeltaOperation } from '../../src/delta'

describe(`delta operations`, () => {
  it(`should track simple property changes`, () => {
    const deltas: DeltaOperation[] = []
    const obj = createMutationProxy(
      {
        name: `test`,
        age: 30,
      },
      {
        onMutation: (delta) => deltas.push(delta),
      }
    )

    obj.name = `updated`
    obj.age = 31

    expect(deltas).toHaveLength(2)
    expect(deltas[0].$set).toEqual({ name: `updated` })
    expect(deltas[1].$set).toEqual({ age: 31 })
  })

  it(`should track nested property changes`, () => {
    const deltas: DeltaOperation[] = []
    const obj = createMutationProxy(
      {
        user: {
          profile: {
            name: `test`,
            settings: {
              theme: `dark`,
            },
          },
        },
      },
      {
        onMutation: (delta) => deltas.push(delta),
      }
    )

    obj.user.profile.settings.theme = `light`

    expect(deltas).toHaveLength(1)
    expect(deltas[0].$set).toEqual({
      'user.profile.settings.theme': `light`,
    })
  })

  it(`should track array operations`, () => {
    const deltas: DeltaOperation[] = []
    const obj = createMutationProxy(
      {
        items: [`a`, `b`, `c`],
      },
      {
        onMutation: (delta) => deltas.push(delta),
      }
    )

    // Test push
    obj.items.push(`d`)
    expect(deltas[0].$push).toEqual({
      items: `d`,
    })

    // Test multiple push
    obj.items.push(`e`, `f`)
    expect(deltas[1].$append).toEqual({
      items: [`e`, `f`],
    })

    // Test unshift
    obj.items.unshift(`x`)
    expect(deltas[2].$prepend).toEqual({
      items: [`x`],
    })

    // Test pop
    obj.items.pop()
    expect(deltas[3].$pop).toEqual({
      items: 1,
    })

    // Test shift
    obj.items.shift()
    expect(deltas[4].$pop).toEqual({
      items: -1,
    })

    // Test splice
    obj.items.splice(1, 1, `y`, `z`)
    expect(deltas[5].$splice).toEqual({
      items: [1, 1, `y`, `z`],
    })

    // Test sort
    obj.items.sort()
    expect(deltas[6].$set).toHaveProperty(`items`)
  })

  it(`should track deletions`, () => {
    const deltas: DeltaOperation[] = []
    const obj = createMutationProxy(
      {
        user: {
          name: `test`,
          age: 30,
        },
      },
      {
        onMutation: (delta) => deltas.push(delta),
      }
    )

    delete obj.user.age

    expect(deltas).toHaveLength(1)
    expect(deltas[0].$unset).toEqual({
      'user.age': true,
    })
  })

  it(`should handle complex nested array operations`, () => {
    const deltas: DeltaOperation[] = []
    const obj = createMutationProxy(
      {
        users: [
          { id: 1, items: [`a`, `b`] },
          { id: 2, items: [`c`, `d`] },
        ],
      },
      {
        onMutation: (delta) => deltas.push(delta),
      }
    )

    obj.users[0].items.push(`x`)
    obj.users[1].items.unshift(`y`)

    expect(deltas).toHaveLength(2)
    expect(deltas[0].$push).toEqual({
      'users.0.items': `x`,
    })
    expect(deltas[1].$prepend).toEqual({
      'users.1.items': [`y`],
    })
  })

  it(`should handle Set and Map operations`, () => {
    const deltas: DeltaOperation[] = []
    const obj = createMutationProxy(
      {
        set: new Set([`a`, `b`]),
        map: new Map([[`key`, `value`]]),
      },
      {
        onMutation: (delta) => deltas.push(delta),
      }
    )

    obj.set.add(`c`)
    obj.map.set(`key2`, `value2`)

    // For now, Set and Map operations are tracked as full replacements
    expect(deltas).toHaveLength(2)
    expect(deltas[0].$set).toHaveProperty(`set`)
    expect(deltas[1].$set).toHaveProperty(`map`)
  })
})
