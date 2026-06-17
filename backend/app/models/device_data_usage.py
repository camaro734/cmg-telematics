import uuid
from sqlalchemy import String, BigInteger, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class DeviceDataUsage(Base):
    """Histórico mensual de bytes transmitidos por dispositivo (estimación SIM).

    Una fila por (device_id, year_month). El total acumulado se obtiene como
    SUM(bytes) sobre todas las filas del dispositivo.
    """
    __tablename__ = "device_data_usage"

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device.id", ondelete="CASCADE"), primary_key=True,
    )
    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)  # 'YYYY-MM'
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
