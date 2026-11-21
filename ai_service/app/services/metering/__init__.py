"""AI usage metering (contract K2): who used which AI feature, how it was
billed. Write-only alongside the credit ledger; see service.py for the safety
rules, context.py for attribution, labels.py for History labels."""
from .context import MeteringContext, resolve_role_class
from .labels import render_label
from .service import (
    EventInput,
    input_from,
    mark_batch_refunds,
    queue_dropped_event,
    queue_free_event,
    record_charged_event,
    record_event,
    stats,
    write_free_event,
)

__all__ = [
    "MeteringContext", "resolve_role_class", "render_label", "EventInput", "input_from", "record_event",
    "record_charged_event", "queue_dropped_event", "queue_free_event", "write_free_event",
    "mark_batch_refunds", "stats",
]
