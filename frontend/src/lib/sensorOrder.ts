// Ordena items según una lista de claves guardada por el usuario.
// Las claves no presentes en `order` quedan al final, conservando su orden
// original (ordenación estable). Si no hay orden guardado, devuelve igual.
export function sortByOrder<T>(items: T[], order: string[] | undefined, keyOf: (it: T) => string): T[] {
  if (!order || order.length === 0) return items
  const idx = new Map(order.map((k, i) => [k, i]))
  const END = Number.MAX_SAFE_INTEGER
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ia = idx.get(keyOf(a.it)) ?? END
      const ib = idx.get(keyOf(b.it)) ?? END
      return ia === ib ? a.i - b.i : ia - ib
    })
    .map(x => x.it)
}

// Reordena un array moviendo el elemento de `from` a la posición `to`.
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
