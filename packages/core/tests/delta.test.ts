import { describe, it, expect } from 'vitest'
import { createMutationProxy } from '../src/proxy'

describe(`delta operations`, () => {
  it(`should track simple property changes`, () => {
    const proxy = createMutationProxy({
      name: `test`,
      age: 30,
    })

    proxy.name = `updated`
    proxy.age = 31

    const delta = proxy.getDelta()
    expect(delta.$set).toEqual({
      name: `updated`,
      age: 31,
    })
  })

  it(`should track nested property changes`, () => {
    const proxy = createMutationProxy({
      user: {
        profile: {
          name: `test`,
          settings: {
            theme: `dark`,
          },
        },
      },
    })

    proxy.user.profile.settings.theme = `light`

    const delta = proxy.getDelta()
    expect(delta.$set).toEqual({
      'user.profile.settings.theme': `light`,
    })
  })

  it(`should track array operations`, () => {
    const proxy = createMutationProxy({
      items: [`a`, `b`, `c`],
    })

    // Test push
    proxy.items.push(`d`)
    expect(proxy.getDelta().$push).toEqual({
      items: `d`,
    })

    // Test multiple push
    proxy.items.push(`e`, `f`)
    expect(proxy.getDelta().$push).toEqual({
      items: [`e`, `f`],
    })

    // Test unshift
    proxy.items.unshift(`x`)
    expect(proxy.getDelta().$prepend).toEqual({
      items: [`x`],
    })

    // Test pop
    proxy.items.pop()
    expect(proxy.getDelta().$pop).toEqual({
      items: 1,
    })

    // Test shift
    proxy.items.shift()
    expect(proxy.getDelta().$pop).toEqual({
      items: -1,
    })

    // Test splice
    proxy.items.splice(1, 1, `y`, `z`)
    expect(proxy.getDelta().$splice).toEqual({
      items: [1, 1, `y`, `z`],
    })

    // Test sort
    proxy.items.sort()
    expect(proxy.getDelta().$set).toHaveProperty(`items`)
  })

  it(`should track deletions`, () => {
    const proxy = createMutationProxy({
      user: {
        name: `test`,
        age: 30,
      },
    })

    delete proxy.user.age

    const delta = proxy.getDelta()
    expect(delta.$unset).toEqual({
      'user.age': true,
    })
  })

  it(`should handle complex nested array operations`, () => {
    const proxy = createMutationProxy({
      users: [
        { id: 1, items: [`a`, `b`] },
        { id: 2, items: [`c`, `d`] },
      ],
    })

    proxy.users[0].items.push(`x`)
    proxy.users[1].items.unshift(`y`)

    const delta = proxy.getDelta()
    expect(delta.$push).toEqual({
      'users.0.items': `x`,
    })
    expect(delta.$prepend).toEqual({
      'users.1.items': [`y`],
    })
  })

  it(`should handle Set and Map operations`, () => {
    const proxy = createMutationProxy({
      set: new Set([`a`, `b`]),
      map: new Map([[`key`, `value`]]),
    })

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

  it(`should track simple property changes`, () => {
    const obj = { name: `test`, age: 30 }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.name = `updated`
    expect(proxy.getDelta().$set).toEqual({
      name: `updated`,
    })
  })

  it(`should track nested property changes`, () => {
    const obj = {
      user: {
        profile: {
          name: `test`,
          settings: {
            theme: `dark`,
          },
        },
      },
    }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.user.profile.settings.theme = `light`
    expect(proxy.getDelta().$set).toEqual({
      'user.profile.settings.theme': `light`,
    })
  })

  it(`should track array operations`, () => {
    const obj = { items: [1, 2, 3] }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.items.push(4)
    expect(proxy.getDelta().$push).toEqual({
      items: 4,
    })
  })

  it(`should track nested array operations`, () => {
    const obj = {
      items: [
        { id: 1, values: [1, 2] },
        { id: 2, values: [3, 4] },
      ],
    }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.items[0].values.push(3)
    expect(proxy.getDelta().$push).toEqual({
      'items.0.values': 3,
    })
  })

  it(`should track Set operations`, () => {
    const obj = { set: new Set([1, 2]) }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.set.add(3)
    expect(proxy.getDelta().$set.set).toEqual(new Set([1, 2, 3]))
  })

  it(`should track Map operations`, () => {
    const obj = {
      map: new Map([
        [`a`, 1],
        [`b`, 2],
      ]),
    }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.map.set(`c`, 3)
    expect(proxy.getDelta().$set.map).toEqual(
      new Map([
        [`a`, 1],
        [`b`, 2],
        [`c`, 3],
      ])
    )
  })

  it(`should track nested object operations`, () => {
    const obj = {
      user: {
        id: 1,
        profile: {
          name: `John`,
          settings: {
            theme: `dark`,
          },
        },
      },
    }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.user.profile.settings.theme = `light`
    expect(proxy.getDelta().$set).toEqual({
      'user.profile.settings.theme': `light`,
    })
  })

  it(`should track array method operations`, () => {
    const obj = { items: [1, 2, 3, 4, 5] }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.items.splice(1, 2, 6, 7)
    expect(proxy.getDelta().$splice).toEqual({
      items: [1, 2, 6, 7],
    })
  })

  it(`should handle getDelta with complex objects`, () => {
    const obj = {
      id: 1,
      data: {
        items: [1, 2, 3],
        meta: {
          set: new Set([4, 5, 6]),
          map: new Map([
            [`a`, 7],
            [`b`, 8],
          ]),
        },
      },
    }
    const proxy = createMutationProxy(obj)

    // Make some changes
    proxy.data.items.push(4)
    proxy.data.meta.set.add(7)
    proxy.data.meta.map.set(`c`, 9)

    const delta = proxy.getDelta()
    console.log({ delta })
    expect(delta.$push).toEqual({ 'data.items': 4 })
    expect(delta.$set).toEqual({
      'data.meta.set': new Set([4, 5, 6, 7]),
      'data.meta.map': new Map([
        [`a`, 7],
        [`b`, 8],
        [`c`, 9],
      ]),
    })
  })

  it(`should handle deletions`, () => {
    const obj = { user: { name: `test`, age: 30 } }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    delete proxy.user.age
    expect(proxy.getDelta().$unset).toEqual({
      'user.age': true,
    })
  })

  it(`should handle complex nested array operations`, () => {
    const obj = {
      users: [
        { id: 1, items: [1, 2] },
        { id: 2, items: [3, 4] },
      ],
    }
    const proxy = createMutationProxy(obj)

    expect(proxy.getDelta()).toEqual({})

    proxy.users[0].items.push(3)
    proxy.users[1].items.unshift(2)
    expect(proxy.getDelta().$push).toEqual({
      'users.0.items': 3,
    })
    expect(proxy.getDelta().$prepend).toEqual({
      'users.1.items': [2],
    })
  })
})
