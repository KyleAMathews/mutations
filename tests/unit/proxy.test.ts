import { describe, it, expect, _vi } from 'vitest'
import {
  createMutationProxy,
  _isChanged,
  _getUntracked,
  markToTrack,
} from '../../src/proxy'
import { _DeltaOperation } from '../../src/delta'

describe(`createMutationProxy`, () => {
  it(`should track simple property mutations`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const obj: Record<string, unknown> = { foo: `bar` }
    obj.foo = `baz`

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$set).toEqual({
      foo: `baz`,
    })
  })

  it(`should track nested object mutations`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const obj: Record<string, unknown> = { nested: { foo: `bar` } }
    obj.nested.foo = `baz`

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$set).toEqual({
      'nested.foo': `baz`,
    })
  })

  it(`should track array mutations`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const obj: Record<string, unknown> = { items: [`a`, `b`] }
    obj.items.push(`c`)

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$push).toEqual({
      items: `c`,
    })
  })

  it(`should track property deletions`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const obj: Record<string, unknown> = { foo: `bar` }
    delete obj.foo

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$unset).toEqual({
      foo: true,
    })
  })

  it(`should not track unchanged values`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const obj: Record<string, unknown> = { foo: `bar` }
    obj.foo = `bar` // Same value

    expect(mutations).toHaveLength(0)
  })

  it(`should handle circular references`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const obj: Record<string, unknown> = { foo: `bar` }
    obj.self = obj

    const proxy = createMutationProxy(obj, _handler)
    proxy.foo = `baz`

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$set).toEqual({
      foo: `baz`,
    })
  })

  it(`should work with markToTrack`, () => {
    class CustomClass {
      value: string
      constructor(value: string) {
        this.value = value
      }
    }

    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const instance = new CustomClass(`test`)
    markToTrack(instance)

    const obj: Record<string, unknown> = { custom: instance }
    obj.custom.value = `changed`

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$set).toEqual({
      'custom.value': `changed`,
    })
  })

  it(`should handle Date objects correctly`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const now = new Date()
    const later = new Date(now.getTime() + 1000)

    const obj: Record<string, unknown> = { date: now }
    obj.date = later

    expect(mutations).toHaveLength(1)
    expect(mutations[0].$set).toEqual({
      date: later,
    })
  })

  it(`should ignore symbol properties`, () => {
    const mutations: _DeltaOperation[] = []
    const _handler = {
      onMutation: (delta: _DeltaOperation) => mutations.push(delta),
    }

    const symbol = Symbol(`test`)
    const obj: Record<string, unknown> = { [symbol]: `value` }
    obj[symbol] = `new value`

    expect(mutations).toHaveLength(0)
  })

  describe(`array operations`, () => {
    it(`should track pop operations`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = { items: [`a`, `b`, `c`] }
      const popped = obj.items.pop()

      expect(popped).toBe(`c`)
      expect(mutations).toHaveLength(1)
      expect(mutations[0].$pop).toEqual({
        items: 1,
      })
    })

    it(`should track shift operations`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = { items: [`a`, `b`, `c`] }
      const shifted = obj.items.shift()

      expect(shifted).toBe(`a`)
      expect(mutations).toHaveLength(1)
      expect(mutations[0].$pop).toEqual({
        items: -1,
      })
    })

    it(`should track unshift operations`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = { items: [`b`, `c`] }
      obj.items.unshift(`a`)

      expect(mutations).toHaveLength(1)
      expect(mutations[0].$prepend).toEqual({
        items: [`a`],
      })
    })

    it(`should track splice operations`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = { items: [`a`, `b`, `c`] }
      obj.items.splice(1, 1, `x`, `y`)

      expect(mutations).toHaveLength(1)
      expect(mutations[0].$splice).toEqual({
        items: [1, 1, `x`, `y`],
      })
    })

    it(`should track sort operations`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = { items: [`c`, `a`, `b`] }
      obj.items.sort()

      expect(mutations).toHaveLength(1)
      expect(mutations[0].$set).toEqual({
        items: [`a`, `b`, `c`],
      })
    })
  })

  describe(`complex data structures`, () => {
    it(`should handle nested arrays`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      }
      obj.matrix[0].push(3)
      obj.matrix[1][1] = 5

      expect(mutations).toHaveLength(2)
      expect(mutations[0].$push).toEqual({
        'matrix.0': 3,
      })
      expect(mutations[1].$set).toEqual({
        'matrix.1.1': 5,
      })
    })

    it(`should handle objects with array values`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = {
        users: [
          { id: 1, tags: [`a`, `b`] },
          { id: 2, tags: [`c`] },
        ],
      }
      obj.users[0].tags.push(`d`)
      obj.users[1].id = 3

      expect(mutations).toHaveLength(2)
      expect(mutations[0].$push).toEqual({
        'users.0.tags': `d`,
      })
      expect(mutations[1].$set).toEqual({
        'users.1.id': 3,
      })
    })

    it(`should handle Set and Map`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const set = new Set([`a`, `b`])
      const map = new Map([[`key`, `value`]])
      markToTrack(set)
      markToTrack(map)

      const obj: Record<string, unknown> = {
        set,
        map,
      }
      obj.set.add(`c`)
      obj.map.set(`key2`, `value2`)

      expect(obj.set.has(`c`)).toBe(true)
      expect(obj.map.get(`key2`)).toBe(`value2`)
    })

    it(`should handle deep object mutations`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = {
        a: {
          b: {
            c: {
              d: 1,
              e: [{ f: 2 }],
            },
          },
        },
      }
      obj.a.b.c.d = 2
      obj.a.b.c.e[0].f = 3

      expect(mutations).toHaveLength(2)
      expect(mutations[0].$set).toEqual({
        'a.b.c.d': 2,
      })
      expect(mutations[1].$set).toEqual({
        'a.b.c.e.0.f': 3,
      })
    })
  })

  describe(`special types`, () => {
    it(`should handle RegExp objects`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = {
        pattern: /test/i,
        patterns: [/foo/, /bar/g],
      }
      obj.pattern = /new/g
      obj.patterns[0] = /baz/i

      expect(mutations).toHaveLength(2)
      expect(mutations[0].$set).toEqual({
        pattern: /new/g,
      })
      expect(mutations[1].$set).toEqual({
        'patterns.0': /baz/i,
      })

      expect(obj.pattern.flags).toBe(`g`)
      expect(obj.patterns[0].flags).toBe(`i`)
    })

    it(`should handle BigInt values`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = {
        big: BigInt(`9007199254740991`),
        numbers: [BigInt(1), BigInt(2)],
      }
      obj.big = BigInt(`9007199254740992`)
      obj.numbers[1] = BigInt(3)

      expect(mutations).toHaveLength(2)
      expect(mutations[0].$set).toEqual({
        big: BigInt(`9007199254740992`),
      })
      expect(mutations[1].$set).toEqual({
        'numbers.1': BigInt(3),
      })

      expect(obj.big > obj.numbers[0]).toBe(true)
      expect(typeof obj.big).toBe(`bigint`)
    })

    it(`should handle mixed BigInt and RegExp in complex objects`, () => {
      const mutations: _DeltaOperation[] = []
      const _handler = {
        onMutation: (delta: _DeltaOperation) => mutations.push(delta),
      }

      const obj: Record<string, unknown> = {
        data: {
          id: BigInt(1),
          pattern: /test/,
          nested: {
            value: BigInt(2),
            regex: /foo/i,
          },
        },
      }
      obj.data.id = BigInt(2)
      obj.data.nested.regex = /bar/g

      expect(mutations).toHaveLength(2)
      expect(mutations[0].$set).toEqual({
        'data.id': BigInt(2),
      })
      expect(mutations[1].$set).toEqual({
        'data.nested.regex': /bar/g,
      })

      expect(obj.data.pattern.test(`test`)).toBe(true)
      expect(obj.data.nested.value + BigInt(1)).toBe(BigInt(3))
    })
  })
})
