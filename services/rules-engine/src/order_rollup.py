"""Rollup automático work_order → done.

Cuando todas las paradas de una orden están done/skipped, cierra la orden
y le asigna número de documento PT-AAAA-NNNNN de forma atómica.

Solo se invoca desde el sweep de auto-cierre (órdenes con
auto_close_config.enabled=true). Las órdenes manuales siguen el flujo
PATCH /status + firma explícita en el backoffice.
"""
import logging
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger(__name__)


async def maybe_rollup_order(conn: asyncpg.Connection, work_order_id: str) -> None:
    """Transiciona work_order → done si todas sus paradas están done/skipped.

    Idempotente: no hace nada si la orden ya está done o si quedan paradas abiertas.
    Asigna doc_number atómicamente (UPSERT sobre tenant_doc_counter).
    """
    row = await conn.fetchrow(
        """
        SELECT wo.id::text              AS id,
               wo.status,
               wo.tenant_id::text       AS tenant_id,
               wo.doc_number,
               COUNT(wos.id)            AS total,
               COUNT(wos.id) FILTER (WHERE wos.status IN ('done', 'skipped')) AS closed
        FROM   work_order wo
        JOIN   work_order_stop wos ON wos.work_order_id = wo.id
        WHERE  wo.id = $1::uuid
        GROUP  BY wo.id
        """,
        work_order_id,
    )
    if not row or row["status"] == "done" or row["total"] == 0:
        return
    if row["closed"] < row["total"]:
        return

    now = datetime.now(timezone.utc)
    if not row["doc_number"]:
        seq = await conn.fetchval(
            """
            INSERT INTO tenant_doc_counter (tenant_id, year, last_seq)
            VALUES ($1::uuid, $2, 1)
            ON CONFLICT (tenant_id, year)
              DO UPDATE SET last_seq = tenant_doc_counter.last_seq + 1
            RETURNING last_seq
            """,
            row["tenant_id"],
            now.year,
        )
        doc_number = f"PT-{now.year}-{seq:05d}"
    else:
        doc_number = row["doc_number"]

    await conn.execute(
        """
        UPDATE work_order
        SET    status       = 'done',
               completed_at = COALESCE(completed_at, $2),
               doc_number   = COALESCE(doc_number, $3)
        WHERE  id     = $1::uuid
          AND  status != 'done'
        """,
        work_order_id,
        now,
        doc_number,
    )
    logger.info("work_order %s → done (rollup auto, %s)", work_order_id, doc_number)
