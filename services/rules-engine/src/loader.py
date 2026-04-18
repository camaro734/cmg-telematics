import asyncpg
from dataclasses import dataclass


@dataclass
class Rule:
    id: str
    tenant_id: str
    name: str
    active: bool
    vehicle_filter: dict
    condition: dict
    severity: str
    actions: list
    escalation: list
    schedule: dict
    cooldown_minutes: int


async def load_rules(conn: asyncpg.Connection) -> list[Rule]:
    rows = await conn.fetch(
        "SELECT id::text, tenant_id::text, name, active, vehicle_filter, condition, "
        "severity, actions, escalation, schedule, cooldown_minutes "
        "FROM alert_rule WHERE active = true"
    )
    return [Rule(**dict(row)) for row in rows]
