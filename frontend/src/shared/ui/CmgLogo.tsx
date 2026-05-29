type MarkProps = { size?: number }

export function CmgMark({ size = 32 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="CMG" role="img">
      <polygon points="0,0 0,32 32,32" fill="var(--cmg-teal)"/>
    </svg>
  )
}

export function CmgLogoFull() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <CmgMark size={44}/>
      <div style={{
        width: 1,
        alignSelf: 'stretch',
        background: 'var(--cmg-teal)',
        opacity: 0.35,
        margin: '3px 0',
      }}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 700,
          fontSize: 27,
          color: 'var(--fg-primary)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>CMG</span>
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 300,
          fontSize: 9.5,
          color: 'var(--cmg-teal)',
          letterSpacing: '0.22em',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}>Hidráulica</span>
      </div>
    </div>
  )
}
