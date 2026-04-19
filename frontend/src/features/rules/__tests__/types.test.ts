import { describe, it, expectTypeOf } from 'vitest'
import type { RuleOut, RuleCreate, ConditionDef, ActionDef, EscalationStep, VehicleFilter } from '../../../lib/types'

describe('Rule types', () => {
  it('RuleOut has all required fields', () => {
    const rule = {} as RuleOut
    expectTypeOf(rule.id).toBeString()
    expectTypeOf(rule.name).toBeString()
    expectTypeOf(rule.condition).toMatchTypeOf<ConditionDef>()
    expectTypeOf(rule.actions).toMatchTypeOf<ActionDef[]>()
    expectTypeOf(rule.escalation).toMatchTypeOf<EscalationStep[]>()
    expectTypeOf(rule.vehicle_filter).toMatchTypeOf<VehicleFilter>()
    expectTypeOf(rule.cooldown_minutes).toBeNumber()
  })

  it('RuleCreate matches RuleOut fields', () => {
    const create = {} as RuleCreate
    expectTypeOf(create.name).toBeString()
    expectTypeOf(create.condition).toMatchTypeOf<ConditionDef>()
  })
})
