from datetime import datetime
from sqlalchemy import Text, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    key:        Mapped[str]      = mapped_column(Text(), primary_key=True)
    value:      Mapped[dict]     = mapped_column(JSONB(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
