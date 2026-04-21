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

// Fleet: truck side-profile with GPS signal arcs from cab
export function IconFlota(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1" y="7" width="9" height="8" rx="0.5"/>
      <path d="M10 10h3l3 5H10V10z"/>
      <circle cx="4" cy="18" r="2"/>
      <circle cx="13" cy="18" r="2"/>
      <path d="M16 10a2.5 2.5 0 0 1 0 5"/>
      <path d="M16 8a5 5 0 0 1 0 9"/>
    </Icon>
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
