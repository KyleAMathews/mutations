import { describe, it, expect } from 'vitest'
import { createMutationProxy } from '../src/proxy'

describe(`createMutationProxy`, () => {
  it(`should track simple property mutations`, () => {
    const obj = { foo: `bar` }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    proxy.foo = `baz`
    expect(proxy.getDelta()).toEqual({ $set: { foo: `baz` } })
  })

  it(`should track nested object mutations`, () => {
    const obj = { nested: { foo: `bar` } }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    proxy.nested.foo = `baz`
    expect(proxy.getDelta()).toEqual({ $set: { 'nested.foo': `baz` } })
  })

  it(`should track array mutations`, () => {
    const obj = { items: [`a`, `b`] }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    proxy.items.push(`c`)
    expect(proxy.getDelta()).toEqual({ $push: { items: `c` } })
  })

  it(`should track property deletions`, () => {
    const obj = { foo: `bar` }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    delete proxy.foo
    expect(proxy.getDelta()).toEqual({ $unset: { foo: true } })
  })

  it(`should not track unchanged values`, () => {
    const obj = { foo: `bar` }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    proxy.foo = `bar` // Same value
    expect(proxy.getDelta()).toEqual({})
  })

  it(`should handle circular references`, () => {
    interface CircularObj {
      foo: string
      self?: CircularObj
    }
    const obj: CircularObj = { foo: `bar` }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    proxy.self = proxy
    expect(proxy.getDelta()).toEqual({ $set: { self: proxy } })
  })

  it(`should work with markToTrack`, () => {
    class CustomClass {
      value: string
      constructor(value: string) {
        this.value = value
      }
    }

    const obj = new CustomClass(`test`)
    const proxy = createMutationProxy({ custom: obj })

    expect(proxy.getDelta()).toEqual({})
    proxy.custom.value = `changed`
    expect(proxy.getDelta()).toEqual({ $set: { 'custom.value': `changed` } })
  })

  it(`should handle Date objects correctly`, () => {
    const now = new Date()
    const later = new Date(now.getTime() + 1000)
    const obj = { date: now }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})
    proxy.date = later
    expect(proxy.getDelta()).toEqual({ $set: { date: later } })
  })

  describe(`array operations`, () => {
    it(`should track pop operations`, () => {
      const obj = { items: [`a`, `b`, `c`] }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      const popped = proxy.items.pop()
      expect(popped).toBe(`c`)
      expect(proxy.getDelta()).toEqual({ $pop: { items: 1 } })
    })

    it(`should track shift operations`, () => {
      const obj = { items: [`a`, `b`, `c`] }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      const shifted = proxy.items.shift()
      expect(shifted).toBe(`a`)
      expect(proxy.getDelta()).toEqual({ $pop: { items: -1 } })
    })

    it(`should track unshift operations`, () => {
      const obj = { items: [`b`, `c`] }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.items.unshift(`a`)
      expect(proxy.getDelta()).toEqual({ $prepend: { items: [`a`] } })
    })

    it(`should track splice operations`, () => {
      const obj = { items: [`a`, `b`, `c`] }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.items.splice(1, 1, `x`, `y`)
      expect(proxy.getDelta()).toEqual({ $splice: { items: [1, 1, `x`, `y`] } })
    })

    it(`should track sort operations`, () => {
      const obj = { items: [`c`, `a`, `b`] }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.items.sort()
      expect(proxy.getDelta()).toEqual({ $set: { items: [`a`, `b`, `c`] } })
    })
  })

  describe(`complex data structures`, () => {
    it(`should handle nested arrays`, () => {
      const obj = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.matrix[0].push(3)
      proxy.matrix[1][1] = 5
      const delta = proxy.getDelta()
      expect(delta.$push).toEqual({ 'matrix.0': 3 })
      expect(delta.$set).toEqual({ 'matrix.1.1': 5 })
    })

    it(`should handle objects with array values`, () => {
      const obj = {
        users: [
          { id: 1, tags: [`a`, `b`] },
          { id: 2, tags: [`c`] },
        ],
      }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.users[0].tags.push(`d`)
      proxy.users[1].id = 3
      const delta = proxy.getDelta()
      expect(delta.$push).toEqual({ 'users.0.tags': `d` })
      expect(delta.$set).toEqual({ 'users.1.id': 3 })
    })

    it(`should handle Set and Map objects`, () => {
      const set = new Set([`a`, `b`])
      const map = new Map([[`key`, `value`]])
      const obj = { set, map }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.set.add(`c`)
      proxy.map.set(`key2`, `value2`)
      const delta = proxy.getDelta()
      expect(delta.$set.set).toEqual(new Set([`a`, `b`, `c`]))
      expect(delta.$set.map).toEqual(
        new Map([
          [`key`, `value`],
          [`key2`, `value2`],
        ])
      )
    })

    it(`should handle deep object mutations`, () => {
      const obj = {
        a: {
          b: {
            c: {
              d: 1,
              e: [{ f: 2 }],
            },
          },
        },
      }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.a.b.c.d = 2
      proxy.a.b.c.e[0].f = 3
      const delta = proxy.getDelta()
      expect(delta.$set).toEqual({
        'a.b.c.d': 2,
        'a.b.c.e.0.f': 3,
      })
    })
  })

  describe(`special types`, () => {
    it(`should handle RegExp objects`, () => {
      const obj = {
        pattern: /test/i,
        patterns: [/foo/, /bar/g],
      }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.pattern = /new/g
      proxy.patterns[0] = /baz/i
      const delta = proxy.getDelta()
      expect(delta.$set).toEqual({
        pattern: /new/g,
        'patterns.0': /baz/i,
      })
    })

    it(`should handle BigInt values`, () => {
      const obj = {
        big: BigInt(`9007199254740991`),
        numbers: [BigInt(1), BigInt(2)],
      }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.big = BigInt(`9007199254740992`)
      proxy.numbers[1] = BigInt(3)
      const delta = proxy.getDelta()
      expect(delta.$set).toEqual({
        big: BigInt(`9007199254740992`),
        'numbers.1': BigInt(3),
      })
    })

    it(`should handle mixed BigInt and RegExp in complex objects`, () => {
      const obj = {
        data: {
          id: BigInt(1),
          nested: {
            regex: /foo/i,
          },
        },
      }
      const proxy = createMutationProxy(obj)

      expect(proxy.getDelta()).toEqual({})
      proxy.data.id = BigInt(2)
      proxy.data.nested.regex = /bar/g
      const delta = proxy.getDelta()
      expect(delta.$set).toEqual({
        'data.id': BigInt(2),
        'data.nested.regex': /bar/g,
      })
    })
  })
})
