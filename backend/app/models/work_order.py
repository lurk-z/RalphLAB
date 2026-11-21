"""Project-owned immutable requests and their transactionally appended audit history."""

from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class WorkOrder(Base):
    __tablename__ = "lab_work_orders"
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(32))
    events: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkOrderReader(Base):
    __tablename__ = "lab_work_order_readers"
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
