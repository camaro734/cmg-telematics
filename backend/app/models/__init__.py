from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User
from app.models.permission_grant import PermissionGrant
from app.models.vehicle_type import VehicleType
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.telemetry import TelemetryRecord
from app.models.alert_rule import AlertRule
from app.models.alert_instance import AlertInstance
from app.models.maintenance import MaintenancePlan, MaintenanceLog
from app.models.command_log import CommandLog
from app.models.vehicle_manual_can_slot import VehicleManualCanSlot
from app.models.driver import Driver
from app.models.work_order import WorkOrder
from app.models.work_order_stop import WorkOrderStop
from app.models.work_report import WorkReport
from app.models.tenant_doc_counter import TenantDocCounter
from app.models.access_audit_log import AccessAuditLog  # noqa
from app.models.system_settings import SystemSettings
from app.models.system_block_template import SystemBlockTemplate

__all__ = [
    "Base", "Tenant", "User", "PermissionGrant", "VehicleType",
    "Vehicle", "Device", "TelemetryRecord", "AlertRule", "AlertInstance",
    "MaintenancePlan", "MaintenanceLog", "CommandLog", "VehicleManualCanSlot",
    "Driver", "WorkOrder", "WorkOrderStop", "WorkReport", "TenantDocCounter",
    "AccessAuditLog", "SystemSettings", "SystemBlockTemplate",
]
