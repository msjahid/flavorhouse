"""History: who changed what, and when. Every add / edit / approval goes through `log`."""
import datetime
from decimal import Decimal

from django.db.models import Model

from .models import AuditLog


def _plain(v):
    if isinstance(v, Model):
        return str(v)
    if isinstance(v, (Decimal, datetime.date, datetime.datetime, datetime.time)):
        return str(v)
    if hasattr(v, "name") and hasattr(v, "url"):  # file fields
        return v.name or ""
    return v


def diff(before: dict, after: dict) -> dict:
    """{field: [old, new]} for fields that changed."""
    out = {}
    for k, new in after.items():
        old = before.get(k)
        if _plain(old) != _plain(new):
            out[k] = [_plain(old), _plain(new)]
    return out


def snapshot(obj, fields) -> dict:
    return {f: _plain(getattr(obj, f, None)) for f in fields}


def log(user, action: str, model: str, obj=None, *, summary: str = "", changes: dict | None = None,
        branch=None, approved_by=None, object_id=None):
    AuditLog.objects.create(
        actor=user if getattr(user, "pk", None) else None,
        approved_by=approved_by,
        action=action, model=model,
        object_id=object_id if object_id is not None else getattr(obj, "pk", None),
        branch_id=getattr(branch, "pk", branch) if branch is not None else getattr(obj, "branch_id", None),
        summary=summary[:255] or f"{action} {model}",
        changes={k: v for k, v in (changes or {}).items()},
    )
