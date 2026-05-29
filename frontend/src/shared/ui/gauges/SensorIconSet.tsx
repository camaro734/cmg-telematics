import type { SensorIcon } from '../../../lib/types'

interface IconProps { size?: number }
const V = "0 0 20 20"
const S = { fill: "none" as const, stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

function Pressure({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <circle cx="10" cy="9" r="6.5"/>
    <line x1="10" y1="9" x2="10" y2="4.5"/>
    <circle cx="10" cy="9" r="1.2" fill="currentColor" stroke="none"/>
    <line x1="4" y1="16" x2="16" y2="16"/>
  </svg>
}
function Temperature({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <path d="M8 12V5a2 2 0 0 1 4 0v7"/>
    <circle cx="10" cy="15" r="2.5"/>
    <line x1="10" y1="12" x2="10" y2="8" strokeWidth={2}/>
  </svg>
}
function Fuel({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <path d="M10 2 Q16 8 16 12 A6 6 0 0 1 4 12 Q4 8 10 2Z"/>
    <line x1="10" y1="11" x2="10" y2="8" strokeWidth={2}/>
  </svg>
}
function Water({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <path d="M10 1 Q14 7 14 10 A4 4 0 0 1 6 10 Q6 7 10 1Z"/>
    <path d="M2 15 Q5.5 12 9 15 Q12.5 18 16 15" opacity={0.7}/>
  </svg>
}
function Engine({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <circle cx="10" cy="10" r="3"/>
    <circle cx="10" cy="10" r="7" strokeDasharray="3.5 2"/>
  </svg>
}
function Speed({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <path d="M3 15 A7 7 0 0 1 17 15"/>
    <line x1="10" y1="14" x2="6.5" y2="9"/>
    <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
}
function Voltage({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <polyline points="12 2 6 11 10 11 8 18 14 9 10 9 12 2"/>
  </svg>
}
function Pump({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <circle cx="10" cy="10" r="6"/>
    <path d="M10 4 A6 6 0 0 1 16 10"/>
    <polyline points="16 7 16 10 13 10"/>
  </svg>
}
function Valve({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <line x1="2" y1="10" x2="18" y2="10"/>
    <polygon points="7 5 13 10 7 15"/>
    <polygon points="13 5 7 10 13 15"/>
  </svg>
}
function Rpm({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <path d="M10 3 A7 7 0 0 1 17 10"/>
    <polyline points="17 7 17 10 14 10"/>
    <path d="M10 17 A7 7 0 0 1 3 10"/>
    <polyline points="3 13 3 10 6 10"/>
  </svg>
}
function Flow({ size = 20 }: IconProps) {
  return <svg viewBox={V} width={size} height={size} {...S}>
    <line x1="2" y1="10" x2="14" y2="10"/>
    <polyline points="10 6 14 10 10 14"/>
    <line x1="2" y1="6" x2="8" y2="6" opacity={0.5}/>
    <line x1="2" y1="14" x2="8" y2="14" opacity={0.5}/>
  </svg>
}

export const SENSOR_ICONS: Record<SensorIcon, React.FC<IconProps>> = {
  pressure: Pressure, temperature: Temperature, fuel: Fuel,
  water: Water, engine: Engine, speed: Speed, voltage: Voltage,
  pump: Pump, valve: Valve, rpm: Rpm, flow: Flow,
}

export function SensorIconComponent({ icon, size = 18, color }: { icon?: SensorIcon; size?: number; color?: string }) {
  if (!icon || !SENSOR_ICONS[icon]) return null
  const Icon = SENSOR_ICONS[icon]
  return <span style={{ color: color ?? 'currentColor', display: 'inline-flex', alignItems: 'center' }}><Icon size={size} /></span>
}
