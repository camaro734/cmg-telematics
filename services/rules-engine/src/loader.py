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
        "FROM alert_rule WHERE active = true AND archived_at IS NULL"
    )
    return [Rule(**dict(row)) for row in rows]


async def load_vehicle_type_map(conn: asyncpg.Connection) -> dict[str, str]:
    """Returns {vehicle_id: vehicle_type_id} for all active vehicles."""
    rows = await conn.fetch(
        "SELECT id::text, vehicle_type_id::text FROM vehicle WHERE active = true"
    )
    return {row["id"]: row["vehicle_type_id"] for row in rows}
