import { describe, it, expect } from 'vitest'
import { sortByOrder, moveItem } from '../sensorOrder'

const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]
const keyOf = (it: { key: string }) => it.key

describe('sortByOrder', () => {
  it('sin orden guardado devuelve igual', () => {
    expect(sortByOrder(items, undefined, keyOf)).toEqual(items)
    expect(sortByOrder(items, [], keyOf)).toEqual(items)
  })

  it('ordena según la lista guardada', () => {
    const r = sortByOrder(items, ['c', 'a', 'd', 'b'], keyOf)
    expect(r.map(keyOf)).toEqual(['c', 'a', 'd', 'b'])
  })

  it('las claves no listadas quedan al final en orden original', () => {
    const r = sortByOrder(items, ['c', 'a'], keyOf)
    expect(r.map(keyOf)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('ignora claves del orden que ya no existen', () => {
    const r = sortByOrder(items, ['x', 'b', 'a'], keyOf)
    expect(r.map(keyOf)).toEqual(['b', 'a', 'c', 'd'])
  })
})

describe('moveItem', () => {
  it('mueve hacia delante', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
  })
  it('mueve hacia atrás', () => {
    expect(moveItem([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3])
  })
  it('from === to no cambia', () => {
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3])
  })
  it('índices fuera de rango no cambian', () => {
    expect(moveItem([1, 2, 3], 0, 9)).toEqual([1, 2, 3])
  })
})
