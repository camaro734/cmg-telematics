import { useState } from 'react'
import Shell from '../../shared/ui/Shell'
import Tabs from '../../shared/ui/Tabs'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
import MyBaseSection from './MyBaseSection'
import CompanySection from './CompanySection'
import SmtpSection from './SmtpSection'
import { useAuthStore } from '../auth/useAuthStore'
import { useNavigate } from 'react-router-dom'

// ── Estilos con TOKENS del sistema, mismo lenguaje que la ficha de vehículo ──
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

// La barra de pestañas puede desbordar en pantallas estrechas → scroll horizontal.
const TABBAR: React.CSSProperties = { flexShrink: 0, overflowX: 'auto' }

// "Mi empresa" agrupa dos tarjetas (Datos de empresa + Mi base): rejilla de 2
// columnas cuando caben, apilan en estrecho (auto-fit nativo, sin JS).
const COMPANY_GRID: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
  gap: 'var(--space-5)', alignItems: 'start',
}

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'
  const isCmgAdmin = isCmg && isAdmin
  const navigate = useNavigate()

  // Pestañas: cada una con su condición de visibilidad por rol (las MISMAS de antes,
  // solo trasladadas a "qué pestaña se muestra") y su contenido. Se muestra una a la vez.
  // Las pestañas con `to` (Conductores, Geocercas) no embeben contenido —esas páginas
  // tienen su propio layout—, sino que navegan a su ruta: "solo cambia desde dónde se llega".
  const TABS: { id: string; label: string; show: boolean; content?: React.ReactNode; to?: string }[] = [
    {
      id: 'empresa', label: 'Mi empresa', show: !!isAdmin && !isCmg,
      content: (
        <div style={COMPANY_GRID}>
          <section style={CARD}><CompanySection /></section>
          <section style={CARD}><MyBaseSection /></section>
        </div>
      ),
    },
    { id: 'usuarios', label: 'Usuarios', show: !!isAdmin, content: <section style={CARD}><UsersSection /></section> },
    { id: 'notificaciones', label: 'Notificaciones', show: true, content: <section style={CARD}><NotificationSettings /></section> },
    { id: 'ciclos', label: 'Ciclos de trabajo', show: !!isAdmin, content: <section style={CARD}><WorkCycleDefinitionsSection /></section> },
    { id: 'smtp', label: 'SMTP', show: isCmgAdmin, content: <section style={CARD}><SmtpSection /></section> },
    {
      id: 'vehiculos', label: 'Config. vehículos', show: isCmgAdmin,
      content: (
        <section style={CARD}>
          <h2 style={CARD_HD}>Configuración de vehículos</h2>
          <p style={CARD_TEXT}>
            Los sensores, métricas de reportes, alertas y ciclos de trabajo se configuran en <strong>Plantillas</strong>.
          </p>
          <button onClick={() => navigate('/tipos-vehiculo')} style={CARD_BTN}>
            Ir a Plantillas →
          </button>
        </section>
      ),
    },
    // Conductores y Geocercas salieron del desplegable "Operaciones" a Ajustes. Visibles
    // para el admin (el operador las alcanza por su menú "Cuenta"). Navegan a su ruta.
    { id: 'conductores', label: 'Conductores', show: !!isAdmin, to: '/drivers' },
    { id: 'geocercas',   label: 'Geocercas',   show: !!isAdmin, to: '/geofences' },
  ]

  const visible = TABS.filter(t => t.show)
  // Pestaña por defecto: la primera con contenido embebido (las de navegación nunca
  // quedan "activas", solo redirigen). Para el admin de cliente es 'empresa'; para CMG, 'usuarios'.
  const firstContent = visible.find(t => t.content)
  const [activeTab, setActiveTab] = useState<string>(() => firstContent?.id ?? '')
  // Si la activa deja de estar visible (cambio de rol), cae a la primera con contenido.
  const active = visible.find(t => t.id === activeTab && t.content) ?? firstContent

  // Las pestañas con `to` navegan a su ruta; el resto cambian el contenido embebido.
  const handleTab = (id: string) => {
    const tab = TABS.find(t => t.id === id)
    if (tab?.to) { navigate(tab.to); return }
    setActiveTab(id)
  }

  return (
    <Shell title="Ajustes">
      <div style={PAGE}>
        <div style={TABBAR}>
          <Tabs
            tabs={visible.map(t => ({ id: t.id, label: t.label }))}
            activeTab={active?.id ?? ''}
            onTabChange={handleTab}
          />
        </div>
        {active?.content}
      </div>
    </Shell>
  )
}
