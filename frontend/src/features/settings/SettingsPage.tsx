import { useState } from 'react'
import Shell from '../../shared/ui/Shell'
import Tabs from '../../shared/ui/Tabs'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
import MyBaseSection from './MyBaseSection'
import CompanySection from './CompanySection'
import SmtpSection from './SmtpSection'
import DriversPage from '../drivers/DriversPage'
import GeofencesPage from '../geofences/GeofencesPage'
import { useAuthStore } from '../auth/useAuthStore'
import { useNavigate, useSearchParams } from 'react-router-dom'

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
  const isOperator = user?.role === 'operator'
  const isCmg = user?.tenant_tier === 'cmg'
  const isCmgAdmin = isCmg && isAdmin
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Pestañas: cada una con su condición de visibilidad por rol y su contenido. Se muestra
  // una a la vez. Conductores y Geocercas se embeben (DriversPage/GeofencesPage con
  // `embedded`, que omite su Shell propio) → se ven CON la barra de pestañas, igual que
  // las demás; ya no saltan a /drivers ni /geofences (esas rutas redirigen aquí).
  const TABS: { id: string; label: string; show: boolean; content: React.ReactNode }[] = [
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
    { id: 'notificaciones', label: 'Notificaciones', show: !!isAdmin, content: <section style={CARD}><NotificationSettings /></section> },
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
    // Conductores y Geocercas: embebidos como pestañas (admin y operador no-fabricante,
    // que es quien las veía en "Operaciones"). Las rutas /drivers y /geofences redirigen aquí.
    { id: 'conductores', label: 'Conductores', show: !!isAdmin || isOperator, content: <DriversPage embedded /> },
    { id: 'geocercas',   label: 'Geocercas',   show: !!isAdmin || isOperator, content: <GeofencesPage embedded /> },
  ]

  const visible = TABS.filter(t => t.show)
  // Pestaña inicial: `?tab=` si apunta a una visible (lo usa el redirect de /drivers y
  // /geofences); si no, la primera visible ('empresa' para admin de cliente, 'usuarios'
  // para CMG, 'conductores' para el operador).
  const tabParam = searchParams.get('tab')
  const initial = (tabParam && visible.some(t => t.id === tabParam)) ? tabParam : (visible[0]?.id ?? '')
  const [activeTab, setActiveTab] = useState<string>(() => initial)
  // Si la activa deja de estar visible (cambio de rol), cae a la primera visible.
  const active = visible.find(t => t.id === activeTab) ?? visible[0]

  return (
    <Shell title="Ajustes">
      <div style={PAGE}>
        <div style={TABBAR}>
          <Tabs
            tabs={visible.map(t => ({ id: t.id, label: t.label }))}
            activeTab={active?.id ?? ''}
            onTabChange={setActiveTab}
          />
        </div>
        {active?.content}
      </div>
    </Shell>
  )
}
