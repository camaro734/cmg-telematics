import type { SensorDef } from './types'

export interface AvlParam {
  avl_id: number
  defaultKey: string
  defaultLabel: string
  unit: string | null
  defaultMin: number
  defaultMax: number
  defaultGaugeType: SensorDef['gauge_type']
  scale?: number
  group: 'motor' | 'combustible' | 'freno_carga' | 'analogico' | 'pto' | 'temperatura'
  description: string
}

export const AVL_CATALOG: AvlParam[] = [
  // ── Motor ──────────────────────────────────────────────────────────────────
  {
    avl_id: 88, defaultKey: 'avl_88', defaultLabel: 'RPM Motor', unit: 'rpm',
    defaultMin: 0, defaultMax: 3000, defaultGaugeType: 'circular',
    group: 'motor', description: 'Revoluciones por minuto del motor',
  },
  {
    avl_id: 85, defaultKey: 'avl_85', defaultLabel: 'Carga Motor', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'circular',
    group: 'motor', description: 'Carga del motor en porcentaje',
  },
  {
    avl_id: 104, defaultKey: 'avl_104', defaultLabel: 'Horas Motor', unit: 'h',
    defaultMin: 0, defaultMax: 50000, defaultGaugeType: 'numeric',
    group: 'motor', description: 'Horas totales de motor acumuladas',
  },
  {
    avl_id: 80, defaultKey: 'avl_80', defaultLabel: 'Velocidad (CAN)', unit: 'km/h',
    defaultMin: 0, defaultMax: 130, defaultGaugeType: 'numeric',
    group: 'motor', description: 'Velocidad de rueda por CAN bus (J1939)',
  },
  // ── Combustible ────────────────────────────────────────────────────────────
  {
    avl_id: 87, defaultKey: 'avl_87', defaultLabel: 'Nivel Combustible', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'battery',
    group: 'combustible', description: 'Nivel de combustible en depósito',
  },
  {
    avl_id: 86, defaultKey: 'avl_86', defaultLabel: 'Combustible Total', unit: 'L',
    defaultMin: 0, defaultMax: 999999, defaultGaugeType: 'numeric',
    group: 'combustible', description: 'Combustible total consumido acumulado',
  },
  {
    avl_id: 135, defaultKey: 'avl_135', defaultLabel: 'Consumo Instantáneo', unit: 'L/h',
    defaultMin: 0, defaultMax: 80, defaultGaugeType: 'circular',
    group: 'combustible', description: 'Tasa de consumo de combustible en tiempo real',
  },
  {
    avl_id: 10455, defaultKey: 'avl_10455', defaultLabel: 'Nivel AdBlue', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'battery',
    group: 'combustible', description: 'Nivel de solución AdBlue (SCR)',
  },
  // ── Temperatura ────────────────────────────────────────────────────────────
  {
    avl_id: 127, defaultKey: 'avl_127', defaultLabel: 'Temp. Refrigerante', unit: '°C',
    defaultMin: -20, defaultMax: 120, defaultGaugeType: 'circular',
    group: 'temperatura', description: 'Temperatura del líquido refrigerante del motor',
  },
  {
    avl_id: 70, defaultKey: 'avl_70', defaultLabel: 'Temp. PCB Dispositivo', unit: '°C',
    defaultMin: -40, defaultMax: 85, defaultGaugeType: 'numeric',
    scale: 0.1,
    group: 'temperatura', description: 'Temperatura interna de la PCB del FMC650',
  },
  // ── Freno y carga ──────────────────────────────────────────────────────────
  {
    avl_id: 79, defaultKey: 'avl_79', defaultLabel: 'Pedal Freno', unit: '0/1',
    defaultMin: 0, defaultMax: 1, defaultGaugeType: 'led',
    group: 'freno_carga', description: 'Estado del pedal de freno (0=libre, 1=presionado)',
  },
  {
    avl_id: 84, defaultKey: 'avl_84', defaultLabel: 'Pedal Acelerador', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'linear',
    group: 'freno_carga', description: 'Posición del pedal de acelerador',
  },
  {
    avl_id: 139, defaultKey: 'avl_139', defaultLabel: 'Peso Total (PBT)', unit: 'kg',
    defaultMin: 0, defaultMax: 32000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso bruto total del vehículo (combinado)',
  },
  {
    avl_id: 89, defaultKey: 'avl_89', defaultLabel: 'Peso Eje 1', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 1 (eje delantero)',
  },
  {
    avl_id: 90, defaultKey: 'avl_90', defaultLabel: 'Peso Eje 2', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 2',
  },
  {
    avl_id: 91, defaultKey: 'avl_91', defaultLabel: 'Peso Eje 3', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 3',
  },
  {
    avl_id: 92, defaultKey: 'avl_92', defaultLabel: 'Peso Eje 4', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 4',
  },
  {
    avl_id: 93, defaultKey: 'avl_93', defaultLabel: 'Peso Eje 5', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 5',
  },
  {
    avl_id: 94, defaultKey: 'avl_94', defaultLabel: 'Peso Eje 6', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 6',
  },
  {
    avl_id: 95, defaultKey: 'avl_95', defaultLabel: 'Peso Eje 7', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 7',
  },
  // ── PTO ───────────────────────────────────────────────────────────────────
  {
    avl_id: 179, defaultKey: 'avl_179', defaultLabel: 'Estado PTO', unit: '0/1',
    defaultMin: 0, defaultMax: 1, defaultGaugeType: 'led',
    group: 'pto', description: 'Estado de la toma de fuerza — FMC650 usa AVL ID 179',
  },
  {
    avl_id: 83, defaultKey: 'avl_83', defaultLabel: 'Estado PTO (alt)', unit: '0/1',
    defaultMin: 0, defaultMax: 1, defaultGaugeType: 'led',
    group: 'pto', description: 'PTO alternativo — algunos dispositivos usan AVL 83',
  },
  // ── Analógico ─────────────────────────────────────────────────────────────
  {
    avl_id: 9, defaultKey: 'avl_9', defaultLabel: 'AIN 1', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 1 (0–30 V, valor raw en mV)',
  },
  {
    avl_id: 10, defaultKey: 'avl_10', defaultLabel: 'AIN 2', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 2 (0–30 V, valor raw en mV)',
  },
  {
    avl_id: 11, defaultKey: 'avl_11', defaultLabel: 'AIN 3', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 3 (0–30 V, valor raw en mV)',
  },
  {
    avl_id: 245, defaultKey: 'avl_245', defaultLabel: 'AIN 4', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 4 (0–30 V, valor raw en mV)',
  },
]

export const GROUP_LABELS: Record<AvlParam['group'], string> = {
  motor: 'Motor',
  combustible: 'Combustible',
  temperatura: 'Temperatura',
  freno_carga: 'Freno y carga',
  pto: 'PTO',
  analogico: 'Analógico',
}

export function avlParamToSensorDef(param: AvlParam): SensorDef {
  return {
    key: param.defaultKey,
    label: param.defaultLabel,
    unit: param.unit,
    min: param.defaultMin,
    max: param.defaultMax,
    gauge_type: param.defaultGaugeType,
    avl_id: param.avl_id,
    ...(param.scale != null ? { scale: param.scale } : {}),
  }
}
