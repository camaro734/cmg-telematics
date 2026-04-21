import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToCsv } from '../csvExport'

describe('exportToCsv', () => {
  let storedBlob: Blob | null = null
  let anchorClick: ReturnType<typeof vi.fn>
  let createObjectURLMock: ReturnType<typeof vi.fn>
  let revokeObjectURLMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storedBlob = null
    anchorClick = vi.fn()

    // Mock createObjectURL to capture blob with text() method
    createObjectURLMock = vi.fn((blob: Blob | MediaSource) => {
      if (blob instanceof Blob) {
        // Add text() method if it doesn't exist (for Vitest Blob mock)
        if (!('text' in blob)) {
          Object.defineProperty(blob, 'text', {
            value: async function () {
              return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as string)
                reader.readAsText(this)
              })
            },
          })
        }
        storedBlob = blob
      }
      return 'blob:test-url'
    })

    revokeObjectURLMock = vi.fn()

    // Override window.URL with our mocks
    Object.defineProperty(window, 'URL', {
      value: {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      },
      writable: true,
    })

    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = origCreate('a') as HTMLAnchorElement
        a.click = anchorClick
        return a
      }
      return origCreate(tag)
    })

  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hace nada con array vacío', () => {
    exportToCsv('test.csv', [])
    expect(storedBlob).toBeNull()
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('genera CSV con cabecera y fila simple', () => {
    exportToCsv('out.csv', [{ name: 'Alice', age: 30 }])
    expect(storedBlob).toBeTruthy()
    expect(storedBlob!.type).toBe('text/csv;charset=utf-8;')
    return storedBlob!.text().then(text => {
      expect(text).toBe('name,age\nAlice,30')
    })
  })

  it('escapa valores con coma usando comillas dobles', () => {
    exportToCsv('out.csv', [{ city: 'Valencia, España' }])
    expect(storedBlob).toBeTruthy()
    return storedBlob!.text().then(text => {
      expect(text).toContain('"Valencia, España"')
    })
  })

  it('escapa comillas internas duplicándolas', () => {
    exportToCsv('out.csv', [{ note: 'say "hello"' }])
    expect(storedBlob).toBeTruthy()
    return storedBlob!.text().then(text => {
      expect(text).toContain('"say ""hello"""')
    })
  })

  it('convierte null y undefined a cadena vacía', () => {
    exportToCsv('out.csv', [{ a: null, b: undefined, c: 0 }])
    expect(storedBlob).toBeTruthy()
    return storedBlob!.text().then(text => {
      expect(text).toBe('a,b,c\n,,0')
    })
  })

  it('dispara click en anchor con filename y revoca URL', () => {
    exportToCsv('datos.csv', [{ x: 1 }])
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-url')
  })
})
