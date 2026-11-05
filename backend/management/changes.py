"""Role-wise approvals for adds & edits.

    submit(...)  → if the submitter is the admin, the change is applied right away;
                   otherwise a ChangeRequest waits for the next role up (manager → supervisor →
                   super admin → admin) who can see that store.
    review(...)  → approve (apply it) or reject.

Each kind of change registers a handler: `@handler("vendor.create", min_level=MANAGER, label="vendor")`.
"""
from dataclasses import dataclass
from typing import Callable

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from . import audit
from .access import ADMIN, Actor, level_of, notify, require, role_wise, users_at_level
from .models import ChangeRequest

LEVEL_NAME = {2: "Manager", 3: "Supervisor", 4: "Super admin", 5: "Admin"}


@dataclass
class Handler:
    kind: str
    min_level: int
    label: str
    apply: Callable          # apply(cr, approver_user) -> created/updated object
    link: str = "/manage/approvals"


HANDLERS: dict[str, Handler] = {}


def handler(kind: str, min_level: int, label: str, link: str = "/manage/approvals"):
    def wrap(fn):
        HANDLERS[kind] = Handler(kind, min_level, label, fn, link)
        return fn
    return wrap


def _apply(cr: ChangeRequest, approver_user):
    h = HANDLERS[cr.kind]
    obj = h.apply(cr, approver_user)
    cr.result_id = getattr(obj, "pk", None)
    action = cr.kind.split(".")[-1]
    audit.log(cr.submitted_by, {"create": "created", "edit": "updated", "delete": "deleted"}.get(action, action),
              h.label, obj, object_id=cr.result_id or cr.target_id, branch=cr.branch, summary=cr.summary,
              changes=audit.diff(cr.before or {}, {k: v for k, v in cr.payload.items() if not k.startswith("_")}),
              approved_by=approver_user if approver_user != cr.submitted_by else None)
    return obj


def submit(actor: Actor, kind: str, *, payload: dict, summary: str, target=None, branch=None,
           before: dict | None = None, file=None, reason: str = "", need_level: int | None = -1) -> ChangeRequest:
    h = HANDLERS[kind]
    require(actor, h.min_level, f"submit this ({h.label})")
    need = role_wise(actor.level) if need_level == -1 else need_level
    with transaction.atomic():
        cr = ChangeRequest.objects.create(
            kind=kind, target_id=getattr(target, "pk", target), branch_id=getattr(branch, "pk", branch),
            summary=summary[:255], payload=payload, before=before or {}, file=file, reason=reason[:255],
            need_level=need or actor.level, submitted_by=actor.user,
        )
        if need is None:
            cr.status, cr.reviewed_by, cr.reviewed_at, cr.review_note = "approved", actor.user, timezone.now(), "Applied directly"
            _apply(cr, actor.user)
            cr.save()
    if need:
        notify(users_at_level(need, branch=cr.branch_id), f"Needs {LEVEL_NAME[need]} approval: {h.label}",
               f"{summary} — by {actor.name}", h.link, exclude=actor.user)
    return cr


def can_review(actor: Actor, cr: ChangeRequest) -> bool:
    if cr.status != "pending" or actor.level < cr.need_level:
        return False
    if cr.submitted_by_id == actor.user.pk and actor.level < ADMIN:
        return False
    return cr.branch_id is None or actor.can_see(cr.branch_id)


def review(actor: Actor, cr: ChangeRequest, approve: bool, note: str = ""):
    if cr.status != "pending":
        raise ValidationError({"detail": "This was already reviewed."})
    if actor.level < cr.need_level:
        raise PermissionDenied(f"Only a {LEVEL_NAME.get(cr.need_level, 'higher role')} or higher can approve this.")
    if cr.submitted_by_id == actor.user.pk and actor.level < ADMIN:
        raise PermissionDenied("You can't approve your own change.")
    if cr.branch_id and not actor.can_see(cr.branch_id):
        raise PermissionDenied("You don't have access to this store.")
    if not approve and not note.strip():
        raise ValidationError({"note": "Say why it's rejected."})
    with transaction.atomic():
        cr.reviewed_by, cr.reviewed_at, cr.review_note = actor.user, timezone.now(), note[:255]
        if approve:
            _apply(cr, actor.user)
            cr.status = "approved"
        else:
            cr.status = "rejected"
            audit.log(actor.user, "rejected", HANDLERS[cr.kind].label, object_id=cr.target_id, branch=cr.branch,
                      summary=f"Rejected: {cr.summary} — {note}")
        cr.save()
    if cr.submitted_by:
        notify([cr.submitted_by], f"{'Approved' if approve else 'Rejected'}: {cr.summary}",
               f"By {actor.name}. {note}".strip(), HANDLERS[cr.kind].link)
    return cr


def pending_for(actor: Actor):
    return [cr for cr in ChangeRequest.objects.filter(status="pending").select_related("submitted_by", "branch")
            if can_review(actor, cr)]


def submitter_level(cr: ChangeRequest) -> int:
    return level_of(cr.submitted_by) if cr.submitted_by else 1
