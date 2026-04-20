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
