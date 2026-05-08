"""Tests for assign_doc_number atomic helper.

Marcados como integration: requieren BD Postgres real con la tabla
tenant_doc_counter (migración 021 aplicada). Se saltan automáticamente
si no hay conexión disponible.
"""
import uuid
from datetime import datetime, timezone

import pytest


pytestmark = pytest.mark.asyncio


@pytest.fixture
async def db_session_with_tenant():
    """Provee una AsyncSession + crea un tenant CMG real para los tests."""
    try:
        from app.core.database import async_session_maker  # type: ignore
    except Exception:  # pragma: no cover
        pytest.skip("No hay async_session_maker disponible en este entorno de test")

    from sqlalchemy import text as _t

    async with async_session_maker() as session:
        tenant_id = uuid.uuid4()
        await session.execute(
            _t(
                "INSERT INTO tenant (id, tier, name, slug, active, enabled_modules, created_at) "
                "VALUES (:id, 'cmg', 'T', :slug, true, '{}', now())"
            ),
            {"id": tenant_id, "slug": f"t-{tenant_id.hex[:8]}"},
        )
        await session.commit()
        try:
            yield session, tenant_id
        finally:
            # Limpieza: borra counter y tenant
            await session.execute(
                _t("DELETE FROM tenant_doc_counter WHERE tenant_id=:t"),
                {"t": tenant_id},
            )
            await session.execute(_t("DELETE FROM tenant WHERE id=:t"), {"t": tenant_id})
            await session.commit()


async def test_assign_doc_number_first_for_tenant_year(db_session_with_tenant):
    from app.services.doc_numbers import assign_doc_number
    session, tenant_id = db_session_with_tenant
    doc = await assign_doc_number(session, tenant_id, datetime(2026, 5, 8, tzinfo=timezone.utc))
    assert doc == "PT-2026-00001"


async def test_assign_doc_number_increments_per_tenant(db_session_with_tenant):
    from app.services.doc_numbers import assign_doc_number
    session, tenant_id = db_session_with_tenant
    d1 = await assign_doc_number(session, tenant_id, datetime(2026, 5, 8, tzinfo=timezone.utc))
    d2 = await assign_doc_number(session, tenant_id, datetime(2026, 5, 9, tzinfo=timezone.utc))
    assert d1 == "PT-2026-00001"
    assert d2 == "PT-2026-00002"


async def test_assign_doc_number_resets_per_year(db_session_with_tenant):
    from app.services.doc_numbers import assign_doc_number
    session, tenant_id = db_session_with_tenant
    d1 = await assign_doc_number(session, tenant_id, datetime(2026, 5, 8, tzinfo=timezone.utc))
    d2 = await assign_doc_number(session, tenant_id, datetime(2027, 1, 1, tzinfo=timezone.utc))
    assert d1 == "PT-2026-00001"
    assert d2 == "PT-2027-00001"
