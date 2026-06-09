import { useRef, useState } from 'react'

interface Props {
  orderTitle: string
  token: string
  orderId: string
  onClose: () => void
  onSigned: (reportNumber: string) => void
}

function SignaturePad({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement> }) {
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    drawing.current = true
    last.current = getPos(e, canvas)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e, canvas)
    if (last.current) {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
    last.current = pos
  }

  const stopDraw = () => {
    drawing.current = false
    last.current = null
  }

  return (
    <canvas
      ref={canvasRef}
      width={440}
      height={140}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        cursor: 'crosshair',
        touchAction: 'none',
        background: '#fff',
        width: '100%',
        maxWidth: 440,
      }}
      onMouseDown={startDraw}
      onMouseMove={draw}
      onMouseUp={stopDraw}
      onMouseLeave={stopDraw}
      onTouchStart={startDraw}
      onTouchMove={draw}
      onTouchEnd={stopDraw}
    />
  )
}

export function PortalSignModal({ orderTitle, token, orderId, onClose, onSigned }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [name, setName] = useState('')
  const [dni, setDni] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  const handleSubmit = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const blank = document.createElement('canvas')
    blank.width = canvas.width
    blank.height = canvas.height
    if (canvas.toDataURL() === blank.toDataURL()) {
      setError('Dibuja tu firma antes de continuar')
      return
    }
    if (!name.trim() || !dni.trim()) {
      setError('Nombre y DNI obligatorios')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/v1/portal/${token}/orders/${orderId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: canvas.toDataURL('image/png'),
          client_signee_name: name.trim(),
          client_signee_dni: dni.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { detail?: string }).detail ?? `Error ${res.status}`)
      }
      const data = await res.json() as { report_number: string }
      onSigned(data.report_number)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar la firma')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 24,
        width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)' }}>
          Firma del parte de servicio
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{orderTitle}</div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6 }}>
            Firma aquí (lápiz o dedo):
          </div>
          <SignaturePad canvasRef={canvasRef} />
          <button
            onClick={handleClear}
            style={{
              marginTop: 6, fontSize: 11, color: 'var(--fg-muted)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              textDecoration: 'underline',
            }}
          >
            Borrar firma
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre completo del firmante"
            style={{
              background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '8px 12px', color: 'var(--fg-primary)',
              fontSize: 13, outline: 'none',
            }}
          />
          <input
            value={dni}
            onChange={e => setDni(e.target.value)}
            placeholder="DNI / NIE"
            style={{
              background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '8px 12px', color: 'var(--fg-primary)',
              fontSize: 13, outline: 'none',
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent-crit)' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-base)', color: 'var(--fg-muted)',
              fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '8px 16px', borderRadius: 6, border: 'none',
              background: 'var(--cmg-teal)', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Firmando…' : 'Firmar y cerrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
