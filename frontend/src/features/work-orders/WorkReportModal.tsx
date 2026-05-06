import { useRef, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkOrderOut, WorkReportOut, MaterialItem } from '../../lib/types'

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
  },
  modal: {
    background: 'var(--bg-surface)', borderRadius: 12, padding: 28,
    width: 600, maxHeight: '92vh', overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column' as const, gap: 18,
    border: '1px solid var(--bg-border)',
  },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  sectionTitle: {
    fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)',
    paddingBottom: 6,
  },
  label: { fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  input: {
    background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
    borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
    fontSize: 13, padding: '8px 10px', width: '100%',
  } as const,
  btn: { fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent-energy)', color: '#fff' } as const,
  btnSm: { fontFamily: 'var(--font-ui)', fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--bg-border)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer' } as const,
  photoThumb: { width: 80, height: 80, objectFit: 'cover' as const, borderRadius: 6, border: '1px solid var(--bg-border)' },
}

// ── Signature canvas ──────────────────────────────────────────────────────────

interface SignatureCanvasProps {
  onSigned: (dataUrl: string) => void
  existingUrl?: string | null
}

function SignatureCanvas({ onSigned, existingUrl }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [signed, setSigned] = useState(false)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    if (existingUrl && !cleared) setSigned(true)
  }, [existingUrl, cleared])

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#F97316'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
  }

  function endDraw() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    setSigned(true)
    setCleared(false)
    onSigned(canvas.toDataURL('image/png'))
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setSigned(false)
    setCleared(true)
    onSigned('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {existingUrl && !cleared ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <img src={existingUrl} alt="firma" style={{ maxHeight: 100, border: '1px solid var(--bg-border)', borderRadius: 6, background: '#fff', padding: 4 }}/>
          <button style={S.btnSm} onClick={() => setCleared(true)}>Firmar de nuevo</button>
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            width={520}
            height={120}
            style={{
              background: '#fff', borderRadius: 6, border: `1px solid ${signed ? 'var(--accent-energy)' : 'var(--bg-border)'}`,
              cursor: 'crosshair', touchAction: 'none', width: '100%', height: 120,
            }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ ...S.label, fontSize: 10 }}>Firme con el dedo o el ratón</span>
            {signed && <button style={S.btnSm} onClick={clearCanvas}>Borrar firma</button>}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  order: WorkOrderOut
  onClose: () => void
}

export default function WorkReportModal({ order, onClose }: Props) {
  const qc = useQueryClient()

  const { data: report } = useQuery({
    queryKey: keys.workReport(order.id),
    queryFn: () => apiClient.get<WorkReportOut>(`/api/v1/work-orders/${order.id}/report`).catch(() => null),
  })

  const [description, setDescription] = useState(report?.description ?? '')
  const [durationH, setDurationH] = useState(Math.floor((report?.work_duration_minutes ?? 0) / 60).toString())
  const [durationM, setDurationM] = useState(((report?.work_duration_minutes ?? 0) % 60).toString())
  const [materials, setMaterials] = useState<MaterialItem[]>(report?.materials_used ?? [])
  const [signatureData, setSignatureData] = useState<string>('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Sync form from loaded report
  useEffect(() => {
    if (!report) return
    setDescription(report.description ?? '')
    setDurationH(Math.floor((report.work_duration_minutes ?? 0) / 60).toString())
    setDurationM(((report.work_duration_minutes ?? 0) % 60).toString())
    setMaterials(report.materials_used ?? [])
  }, [report])

  const { mutate: saveReport, isPending: saving } = useMutation({
    mutationFn: () => {
      const minutes = (parseInt(durationH || '0') * 60) + parseInt(durationM || '0')
      return apiClient.post<WorkReportOut>(`/api/v1/work-orders/${order.id}/report`, {
        description: description || null,
        work_duration_minutes: minutes > 0 ? minutes : null,
        materials_used: materials,
        signature_data: signatureData || null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.workReport(order.id) })
      setSaveMsg('Guardado')
      setTimeout(() => setSaveMsg(''), 2000)
    },
  })

  const { mutate: uploadPhoto, isPending: uploading } = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return apiClient.postForm<WorkReportOut>(`/api/v1/work-orders/${order.id}/report/photos`, fd)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workReport(order.id) }),
  })

  function addMaterial() {
    setMaterials(m => [...m, { name: '', quantity: 1, unit: '' }])
  }
  function updateMaterial(i: number, field: keyof MaterialItem, value: string | number) {
    setMaterials(m => m.map((item, idx) => idx === i ? { ...item, [field]: value } : item))
  }
  function removeMaterial(i: number) {
    setMaterials(m => m.filter((_, idx) => idx !== i))
  }

  async function downloadPdf() {
    setPdfLoading(true)
    try {
      const token = localStorage.getItem('access_token') ?? ''
      const res = await fetch(`/api/v1/work-orders/${order.id}/report/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Error generando PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe_${order.title.slice(0, 30).replace(/\s/g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfLoading(false)
    }
  }

  const photos: string[] = report?.photo_urls ?? []

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-ui)', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Informe de trabajo
            </h2>
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              {order.title}
            </p>
          </div>
          <button onClick={onClose} style={{ ...S.btnSm, border: 'none', fontSize: 16, padding: '2px 8px' }}>×</button>
        </div>

        {/* Descripción */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Descripción del trabajo</div>
          <textarea
            style={{ ...S.input, resize: 'vertical', minHeight: 80 }}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe el trabajo realizado…"
          />
        </div>

        {/* Duración */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Duración</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={S.label}>Horas</span>
              <input style={{ ...S.input, width: 80 }} type="number" min="0" max="99" value={durationH} onChange={e => setDurationH(e.target.value)}/>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={S.label}>Minutos</span>
              <input style={{ ...S.input, width: 80 }} type="number" min="0" max="59" value={durationM} onChange={e => setDurationM(e.target.value)}/>
            </div>
          </div>
        </div>

        {/* Materiales */}
        <div style={S.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={S.sectionTitle}>Materiales utilizados</div>
            <button style={S.btnSm} onClick={addMaterial}>+ Añadir</button>
          </div>
          {materials.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {materials.map((m, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                  <input style={S.input} placeholder="Material" value={m.name} onChange={e => updateMaterial(i, 'name', e.target.value)}/>
                  <input style={S.input} placeholder="Cantidad" type="number" min="0" step="0.1" value={m.quantity} onChange={e => updateMaterial(i, 'quantity', parseFloat(e.target.value) || 0)}/>
                  <input style={S.input} placeholder="Unidad" value={m.unit} onChange={e => updateMaterial(i, 'unit', e.target.value)}/>
                  <button style={{ ...S.btnSm, color: 'var(--accent-crit)', padding: '5px 8px' }} onClick={() => removeMaterial(i)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fotos */}
        <div style={S.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={S.sectionTitle}>Fotografías ({photos.length})</div>
            <button
              style={{ ...S.btnSm, opacity: uploading ? 0.6 : 1 }}
              disabled={uploading}
              onClick={() => photoInputRef.current?.click()}
            >
              {uploading ? 'Subiendo…' : '+ Foto'}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0]); e.target.value = '' }}
            />
          </div>
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {photos.map((url, i) => (
                <img key={i} src={url} alt={`foto ${i + 1}`} style={S.photoThumb}/>
              ))}
            </div>
          )}
        </div>

        {/* Firma */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Firma del operario</div>
          <SignatureCanvas
            existingUrl={report?.signature_url ?? null}
            onSigned={setSignatureData}
          />
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', paddingTop: 4, borderTop: '1px solid var(--bg-border)' }}>
          {saveMsg && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--accent-ok)' }}>{saveMsg}</span>}
          <button
            style={{ ...S.btnSm }}
            disabled={pdfLoading || !report}
            onClick={downloadPdf}
            title={!report ? 'Guarda el informe primero' : ''}
          >
            {pdfLoading ? 'Generando…' : 'Descargar PDF'}
          </button>
          <button
            style={{ ...S.btn, opacity: saving ? 0.7 : 1 }}
            disabled={saving}
            onClick={() => saveReport()}
          >
            {saving ? 'Guardando…' : 'Guardar informe'}
          </button>
        </div>
      </div>
    </div>
  )
}
