// Industrial-telemetry icon set — 24×24 stroke, currentColor

type IconProps = React.SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

// Dashboard: 2×2 grid of widgets
export function IconDashboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </Icon>
  )
}

// Fleet: truck side-profile — mismo estilo v2 que IconTruckGeneric, viewBox ancho para proporciones correctas
export function IconFlota({ width = 24, height = 24, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 48 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={width}
      height={height}
      {...props}
    >
      {/* chassis */}
      <line x1="3" y1="22" x2="46" y2="22" />
      {/* cab lower */}
      <path d="M3,22 L3,15 Q3,13 6,13 L14,13 L14,22" />
      {/* cab upper */}
      <path d="M5,13 L5,8 Q5,7 7,7 L14,7 L14,13" />
      {/* windshield */}
      <rect x="6" y="8" width="7" height="5.5" rx="1" strokeWidth={1.1} opacity={0.65} />
      {/* cargo body */}
      <rect x="14" y="8" width="31" height="14" rx="2" />
      {/* cargo door line */}
      <line x1="30" y1="8" x2="30" y2="22" strokeDasharray="2 2" strokeWidth={1} opacity={0.5} />
      {/* front wheel */}
      <circle cx="9" cy="24" r="3.5" />
      <circle cx="9" cy="24" r="1.5" />
      {/* rear wheels */}
      <circle cx="30" cy="24" r="3.5" />
      <circle cx="30" cy="24" r="1.5" />
      <circle cx="40" cy="24" r="3.5" />
      <circle cx="40" cy="24" r="1.5" />
      {/* exhaust */}
      <line x1="6" y1="13" x2="6" y2="5.5" strokeWidth={2} />
      <line x1="6" y1="5.5" x2="8.5" y2="5.5" />
    </svg>
  )
}

// Alerts: EKG pulse waveform with threshold line
export function IconAlertas(props: IconProps) {
  return (
    <Icon {...props}>
      <polyline points="2,12 5,12 7,6 10,18 13,8 16,14 18,12 22,12"/>
      <line
        x1="2" y1="16.5" x2="22" y2="16.5"
        strokeWidth={0.75}
        strokeDasharray="2 2"
        strokeLinecap="butt"
      />
    </Icon>
  )
}

// Rules: decision diamond with dual-branch output
export function IconReglas(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3L19 9 12 15 5 9Z"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <path d="M5 9L2 14"/>
      <path d="M19 9L22 14"/>
      <circle cx="2" cy="15.5" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="22" cy="15.5" r="1.5" fill="currentColor" stroke="none"/>
    </Icon>
  )
}

// Maintenance: wrench (tool/service icon)
export function IconMantenimiento(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </Icon>
  )
}

// Settings: three horizontal sliders at staggered positions
export function IconAjustes(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="3" y1="6" x2="5.5" y2="6"/>
      <circle cx="8" cy="6" r="2.5"/>
      <line x1="10.5" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="13.5" y2="12"/>
      <circle cx="16" cy="12" r="2.5"/>
      <line x1="18.5" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="7.5" y2="18"/>
      <circle cx="10" cy="18" r="2.5"/>
      <line x1="12.5" y1="18" x2="21" y2="18"/>
    </Icon>
  )
}

// Clients: two people silhouette (person group)
export function IconClientes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </Icon>
  )
}

// Reports: document with horizontal lines (file-text)
export function IconReportes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </Icon>
  )
}

// Devices: SIM card / device module with connector notch
export function IconDispositivos(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <path d="M9 2v4h6V2"/>
      <line x1="9" y1="10" x2="15" y2="10"/>
      <line x1="9" y1="14" x2="15" y2="14"/>
      <line x1="9" y1="18" x2="12" y2="18"/>
    </Icon>
  )
}

// Vehicles: car side-profile (sedan outline)
export function IconVehiculos(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17H2a1 1 0 0 1-1-1v-4l2-5h14l2 5v4a1 1 0 0 1-1 1h-2"/>
      <path d="M7 17h8"/>
      <circle cx="5" cy="17" r="2"/>
      <circle cx="17" cy="17" r="2"/>
      <path d="M4 11h14"/>
      <path d="M7 6l-1 5"/>
      <path d="M15 6l1 5"/>
    </Icon>
  )
}

// CAN Scanner: oscilloscope waveform
export function IconCanScanner(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="20" height="16" rx="2"/>
      <polyline points="6,14 8,10 10,14 12,8 14,14 16,11 18,14"/>
      <line x1="6" y1="19" x2="18" y2="19"/>
    </Icon>
  )
}

// Work orders: clipboard with checkmark
export function IconOrdenes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <path d="m9 12 2 2 4-4"/>
    </Icon>
  )
}

// Geofence: hexagon zone with center dot
export function IconGeocercas(props: IconProps) {
  return (
    <Icon {...props}>
      <polygon points="12,3 20,8 20,16 12,21 4,16 4,8" strokeDasharray="2 1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </Icon>
  )
}

// Driver: single person silhouette (user with hard hat feel)
export function IconConductores(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4"/>
      <path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
      <path d="M8 8h8"/>
    </Icon>
  )
}

// ── Vehicle type icons — 64×32 side-view, stroke-based ───────────────────────

type TruckIconProps = React.SVGProps<SVGSVGElement>

// ── Truck icons v2 — modern detailed style ──────────────────────────────────
// viewBox 0 0 80 36, stroke-based, color currentColor

// Generic box truck — enclosed cargo body, dual rear axle
export function IconTruckGeneric({ style, className, ...props }: TruckIconProps) {
  return (
    <svg viewBox="0 0 80 36" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" style={style} className={className} {...props}>
      {/* chassis */}
      <line x1="4" y1="28" x2="76" y2="28" />
      {/* cab */}
      <path d="M4,28 L4,14 Q4,10 8,10 L22,10 L22,28" />
      <path d="M8,10 L8,6 Q8,4 11,4 L19,4 Q22,4 22,8 L22,10" />
      {/* windshield */}
      <rect x="9" y="5" width="11" height="7" rx="1" strokeWidth={1} opacity="0.6" />
      {/* cargo body */}
      <rect x="22" y="10" width="52" height="18" rx="2" />
      {/* cargo door lines */}
      <line x1="58" y1="10" x2="58" y2="28" strokeDasharray="2 2" opacity="0.5" />
      <line x1="38" y1="10" x2="38" y2="28" strokeDasharray="2 2" opacity="0.5" />
      {/* wheels */}
      <circle cx="13" cy="29" r="4.5" />
      <circle cx="13" cy="29" r="2" />
      <circle cx="54" cy="29" r="4.5" />
      <circle cx="54" cy="29" r="2" />
      <circle cx="64" cy="29" r="4.5" />
      <circle cx="64" cy="29" r="2" />
      {/* exhaust */}
      <line x1="6" y1="10" x2="6" y2="4" strokeWidth={2} />
      <line x1="6" y1="4" x2="8" y2="4" />
    </svg>
  )
}

// Cistern truck — elliptical tank with ribs, fill port, rear valve
export function IconTruckCistern({ style, className, ...props }: TruckIconProps) {
  return (
    <svg viewBox="0 0 80 36" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" style={style} className={className} {...props}>
      {/* chassis */}
      <line x1="4" y1="28" x2="76" y2="28" />
      {/* cab */}
      <path d="M4,28 L4,14 Q4,10 8,10 L22,10 L22,28" />
      <path d="M8,10 L8,6 Q8,4 11,4 L19,4 Q22,4 22,8 L22,10" />
      <rect x="9" y="5" width="11" height="7" rx="1" strokeWidth={1} opacity="0.6" />
      {/* tank — elliptical */}
      <ellipse cx="48" cy="19" rx="27" ry="10" />
      {/* tank ribs */}
      <line x1="32" y1="10" x2="32" y2="28" opacity="0.4" />
      <line x1="42" y1="9.5" x2="42" y2="28.5" opacity="0.4" />
      <line x1="52" y1="9.5" x2="52" y2="28.5" opacity="0.4" />
      <line x1="62" y1="10" x2="62" y2="28" opacity="0.4" />
      {/* fill port on top */}
      <rect x="44" y="8" width="8" height="3" rx="1.5" />
      <line x1="48" y1="8" x2="48" y2="5" />
      <circle cx="48" cy="4.5" r="1.5" />
      {/* rear valve */}
      <rect x="73" y="17" width="4" height="5" rx="1" />
      <line x1="75" y1="17" x2="75" y2="15" />
      {/* wheels */}
      <circle cx="13" cy="29" r="4.5" />
      <circle cx="13" cy="29" r="2" />
      <circle cx="54" cy="29" r="4.5" />
      <circle cx="54" cy="29" r="2" />
      <circle cx="64" cy="29" r="4.5" />
      <circle cx="64" cy="29" r="2" />
      {/* exhaust */}
      <line x1="6" y1="10" x2="6" y2="4" strokeWidth={2} />
      <line x1="6" y1="4" x2="8" y2="4" />
    </svg>
  )
}

// Vacuum/pressure truck — tank + rear pump unit + hose reel
export function IconTruckVacuum({ style, className, ...props }: TruckIconProps) {
  return (
    <svg viewBox="0 0 80 36" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" style={style} className={className} {...props}>
      {/* chassis */}
      <line x1="4" y1="28" x2="76" y2="28" />
      {/* cab */}
      <path d="M4,28 L4,14 Q4,10 8,10 L22,10 L22,28" />
      <path d="M8,10 L8,6 Q8,4 11,4 L19,4 Q22,4 22,8 L22,10" />
      <rect x="9" y="5" width="11" height="7" rx="1" strokeWidth={1} opacity="0.6" />
      {/* tank — shorter */}
      <ellipse cx="43" cy="19" rx="20" ry="9.5" />
      {/* tank ribs */}
      <line x1="30" y1="10" x2="30" y2="28" opacity="0.4" />
      <line x1="40" y1="9.5" x2="40" y2="28.5" opacity="0.4" />
      <line x1="50" y1="9.5" x2="50" y2="28.5" opacity="0.4" />
      {/* fill port */}
      <rect x="40" y="8" width="6" height="3" rx="1.5" />
      <line x1="43" y1="8" x2="43" y2="5.5" />
      {/* rear pump unit */}
      <rect x="63" y="12" width="12" height="16" rx="2" />
      <circle cx="69" cy="20" r="4" />
      <circle cx="69" cy="20" r="1.5" />
      {/* hose outlet */}
      <path d="M75,22 Q78,22 78,26 L76,28" strokeWidth={1.2} />
      {/* pressure gauge */}
      <circle cx="69" cy="13" r="1.5" strokeWidth={1} />
      {/* wheels */}
      <circle cx="13" cy="29" r="4.5" />
      <circle cx="13" cy="29" r="2" />
      <circle cx="48" cy="29" r="4.5" />
      <circle cx="48" cy="29" r="2" />
      <circle cx="58" cy="29" r="4.5" />
      <circle cx="58" cy="29" r="2" />
      {/* exhaust */}
      <line x1="6" y1="10" x2="6" y2="4" strokeWidth={2} />
      <line x1="6" y1="4" x2="8" y2="4" />
    </svg>
  )
}

// Crane truck — flatbed + knuckle-boom crane with hook
export function IconTruckCrane({ style, className, ...props }: TruckIconProps) {
  return (
    <svg viewBox="0 0 80 36" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" style={style} className={className} {...props}>
      {/* chassis */}
      <line x1="4" y1="28" x2="76" y2="28" />
      {/* cab */}
      <path d="M4,28 L4,14 Q4,10 8,10 L22,10 L22,28" />
      <path d="M8,10 L8,6 Q8,4 11,4 L19,4 Q22,4 22,8 L22,10" />
      <rect x="9" y="5" width="11" height="7" rx="1" strokeWidth={1} opacity="0.6" />
      {/* flatbed */}
      <rect x="22" y="24" width="52" height="4" rx="1" />
      {/* crane base */}
      <rect x="30" y="18" width="8" height="6" rx="1" />
      {/* main boom */}
      <line x1="34" y1="18" x2="58" y2="4" strokeWidth={2} />
      {/* knuckle */}
      <circle cx="58" cy="4" r="2" />
      {/* jib */}
      <line x1="58" y1="4" x2="72" y2="10" strokeWidth={1.6} />
      {/* hoist rope */}
      <line x1="72" y1="10" x2="72" y2="20" strokeDasharray="2 1.5" />
      {/* hook */}
      <path d="M70,20 Q68,22 70,24 Q72,26 74,24" strokeWidth={1.2} />
      {/* outrigger hint */}
      <line x1="44" y1="28" x2="44" y2="32" strokeWidth={1} />
      <line x1="40" y1="32" x2="48" y2="32" strokeWidth={1} />
      {/* wheels */}
      <circle cx="13" cy="29" r="4.5" />
      <circle cx="13" cy="29" r="2" />
      <circle cx="54" cy="29" r="4.5" />
      <circle cx="54" cy="29" r="2" />
      <circle cx="64" cy="29" r="4.5" />
      <circle cx="64" cy="29" r="2" />
      {/* exhaust */}
      <line x1="6" y1="10" x2="6" y2="4" strokeWidth={2} />
      <line x1="6" y1="4" x2="8" y2="4" />
    </svg>
  )
}

// Returns the right truck icon component based on vehicle type slug
export function getVehicleIconForSlug(slug: string): React.FC<TruckIconProps> {
  const s = slug.toLowerCase()
  if (s.includes('cistern') || s.includes('tanque') || s.includes('tank')) return IconTruckCistern
  if (s.includes('vacuum') || s.includes('vac') || s.includes('aspirad') || s.includes('barred') || s.includes('vaciado')) return IconTruckVacuum
  if (s.includes('crane') || s.includes('grua') || s.includes('grú') || s.includes('elevad') || s.includes('brazo')) return IconTruckCrane
  return IconTruckGeneric
}
