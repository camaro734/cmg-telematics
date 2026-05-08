"""Asignación atómica de número de documento (PT-{año}-{NNNNN}) por tenant emisor.

Usa UPSERT con RETURNING sobre `tenant_doc_counter` para garantizar atomicidad
ante cierres simultáneos de órdenes.
"""
import uuid
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def assign_doc_number(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    completed_at: datetime,
) -> str:
    """
    Asigna de forma atómica el siguiente número de documento
    `PT-{año}-{NNNNN}` para el tenant + año dados.
    """
    year = completed_at.year
    result = await db.execute(
        text(
            """
            INSERT INTO tenant_doc_counter (tenant_id, year, last_seq)
            VALUES (:tenant_id, :year, 1)
            ON CONFLICT (tenant_id, year)
              DO UPDATE SET last_seq = tenant_doc_counter.last_seq + 1
            RETURNING last_seq
            """
        ),
        {"tenant_id": tenant_id, "year": year},
    )
    seq = result.scalar_one()
    return f"PT-{year}-{seq:05d}"
