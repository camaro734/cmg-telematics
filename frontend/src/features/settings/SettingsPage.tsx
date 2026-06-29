import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
import MyBaseSection from './MyBaseSection'
import SmtpSection from './SmtpSection'
import { useAuthStore } from '../auth/useAuthStore'
import { useNavigate } from 'react-router-dom'

// ── Estilos con TOKENS del sistema, mismo lenguaje que la ficha de vehículo ──
// Contenedor a ancho completo con margen lateral pequeño (sin maxWidth ni hueco).
const PAGE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: '100%', overflowY: 'auto',
  padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
}

// Tarjeta oscura con borde sutil y acento teal arriba (igual que telemetría/parte).
const CARD: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderTop: '2px solid var(--cmg-teal)', borderRadius: 8,
  padding: 'var(--space-5)', boxSizing: 'border-box',
}

const CARD_HD: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-section-hd)', fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', margin: '0 0 var(--space-4)',
}

const CARD_TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', color: 'var(--fg-muted)', margin: '0 0 var(--space-4)',
}

const CARD_BTN: React.CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600,
  background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 8,
  padding: 'var(--space-3) var(--space-5)', cursor: 'pointer',
}

// Rejilla de los formularios cortos: 2 columnas cuando caben, apila en estrecho
// (auto-fit nativo, sin JS). Con un solo elemento (p.ej. CMG sin Mi base) ocupa el ancho.
const TOP_GRID: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
  gap: 'var(--space-5)', alignItems: 'start',
}

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'
  const isCmgAdmin = isCmg && isAdmin
  const navigate = useNavigate()

  return (
    <Shell title="Ajustes">
      <div style={PAGE}>
        {/* Formularios cortos arriba, en 2 columnas (apilan en estrecho) */}
        <div style={TOP_GRID}>
          <section style={CARD}><NotificationSettings /></section>
          {isAdmin && !isCmg && <section style={CARD}><MyBaseSection /></section>}
        </div>
        {/* Tablas / secciones anchas, a ancho completo debajo */}
        {isAdmin && <section style={CARD}><UsersSection /></section>}
        {isAdmin && <section style={CARD}><WorkCycleDefinitionsSection /></section>}
        {isCmgAdmin && <section style={CARD}><SmtpSection /></section>}
        {isCmgAdmin && (
          <section style={CARD}>
            <h2 style={CARD_HD}>Configuración de vehículos</h2>
            <p style={CARD_TEXT}>
              Los sensores, métricas de reportes, alertas y ciclos de trabajo se configuran en <strong>Plantillas</strong>.
            </p>
            <button onClick={() => navigate('/tipos-vehiculo')} style={CARD_BTN}>
              Ir a Plantillas →
            </button>
          </section>
        )}
      </div>
    </Shell>
  )
}
