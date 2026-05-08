// DNI / NIE español: 8 dígitos + letra de control, o X/Y/Z + 7 dígitos + letra.
// Si el formato no se parece al DNI/NIE español, se acepta tal cual (clientes
// extranjeros que pueden tener IDs distintos). Solo rechazamos cuando el patrón
// es claramente español pero la letra de control es incorrecta.
const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

export function isValidDni(input: string): boolean {
  if (!input) return false
  const v = input.trim().toUpperCase()
  const dniMatch = v.match(/^(\d{8})([A-Z])$/)
  const nieMatch = v.match(/^([XYZ])(\d{7})([A-Z])$/)

  if (!dniMatch && !nieMatch) {
    // No parece formato español — aceptamos si tiene una longitud razonable
    return v.length >= 5
  }

  let num: number
  let letter: string
  if (dniMatch) {
    num = parseInt(dniMatch[1], 10)
    letter = dniMatch[2]
  } else if (nieMatch) {
    const prefixVal: Record<string, number> = { X: 0, Y: 1, Z: 2 }
    num = parseInt(`${prefixVal[nieMatch[1]]}${nieMatch[2]}`, 10)
    letter = nieMatch[3]
  } else {
    return false
  }
  return LETTERS[num % 23] === letter
}
