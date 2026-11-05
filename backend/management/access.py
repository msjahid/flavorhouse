"""Who can do what. Every permission rule lives here so it's easy to read and change."""
from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied

from .models import DISCOUNT_LIMIT, LEVEL, Notification, Role, StaffProfile

EMPLOYEE, MANAGER, SUPERVISOR, SUPERADMIN, ADMIN = 1, 2, 3, 4, 5

# Who must verify a NEW staff member of each role
STAFF_APPROVER_LEVEL = {
    Role.EMPLOYEE: SUPERVISOR,
    Role.MANAGER: SUPERADMIN,
    Role.SUPERVISOR: SUPERADMIN,
    Role.SUPERADMIN: ADMIN,
    Role.ADMIN: ADMIN,
}

# Who must approve a PURCHASE, by the submitter's level (None = auto-approved)
PURCHASE_APPROVER_LEVEL = {MANAGER: SUPERVISOR, SUPERVISOR: SUPERADMIN, SUPERADMIN: None, ADMIN: None}


def role_wise(level: int) -> int | None:
    """The approver for something submitted by `level`: the next role up. Admin's own changes apply directly."""
    return None if level >= ADMIN else level + 1


@dataclass
class Actor:
    user: object
    profile: StaffProfile | None
    level: int
    role: str
    branch_id: int | None
    branch_ids: frozenset | None = None   # stores this person can access; None = every store (admin)

    @property
    def discount_limit(self) -> int:
        return DISCOUNT_LIMIT[self.level]

    @property
    def can_refund(self) -> bool:
        return self.level >= MANAGER

    @property
    def multi_branch(self) -> bool:
        """Supervisors and above work across stores (they choose a store on each device)."""
        return self.level >= SUPERVISOR

    def can_see(self, branch_id) -> bool:
        return self.branch_ids is None or (branch_id is not None and int(branch_id) in self.branch_ids)

    @property
    def name(self) -> str:
        return self.user.get_full_name() or self.user.username


def actor_for(user) -> Actor | None:
    """Returns the staff member behind a user, or None if they may not use the system."""
    if not user or not user.is_authenticated or not user.is_active:
        return None
    try:
        profile = user.staff
    except StaffProfile.DoesNotExist:
        profile = None
    if profile:
        if profile.status != StaffProfile.Status.ACTIVE:
            return None
        if profile.level >= ADMIN:
            ids = None
        elif profile.level >= SUPERVISOR:
            ids = frozenset(profile.assigned_branches.values_list("id", flat=True))
        else:
            ids = frozenset([profile.branch_id]) if profile.branch_id else frozenset()
        return Actor(user, profile, profile.level, profile.role, profile.branch_id, ids)
    if user.is_superuser:  # Django superuser without a profile = owner/admin
        return Actor(user, None, ADMIN, Role.ADMIN, None, None)
    return None


def require(actor: Actor | None, level: int, what: str = "do this"):
    if not actor or actor.level < level:
        raise PermissionDenied(f"Your role isn't allowed to {what}.")


def check_branch(actor: Actor, branch_id) -> None:
    if branch_id is None:
        return
    if not actor.can_see(branch_id):
        raise PermissionDenied("You don't have access to this store.")


def scope(qs, actor: Actor, field: str = "branch", branch_param=None):
    """Limit a queryset to the stores this person can see (optionally one chosen store)."""
    if branch_param not in (None, "", "all"):
        check_branch(actor, branch_param)
        return qs.filter(**{f"{field}_id": branch_param})
    if actor.branch_ids is None:
        return qs
    return qs.filter(**{f"{field}_id__in": actor.branch_ids})


def can_create_role(actor: Actor, role: str) -> bool:
    if actor.level == ADMIN:
        return True
    if actor.level == MANAGER:
        return role == Role.EMPLOYEE
    return LEVEL[role] < actor.level


def users_at_level(level: int, branch=None):
    """Active staff (and owner superusers) at or above a level — optionally only those who can see a store."""
    roles = [r for r, lv in LEVEL.items() if lv >= level]
    User = get_user_model()
    qs = User.objects.filter(is_active=True).filter(
        Q(staff__role__in=roles, staff__status=StaffProfile.Status.ACTIVE)
        | Q(is_superuser=True, staff__isnull=True)
    )
    if branch is not None:
        bid = getattr(branch, "pk", branch)
        qs = qs.filter(
            Q(staff__role=Role.ADMIN) | Q(is_superuser=True, staff__isnull=True)
            | Q(staff__role__in=[Role.SUPERVISOR, Role.SUPERADMIN], staff__assigned_branches=bid)
            | Q(staff__role=Role.MANAGER, staff__branch_id=bid)
        )
    return qs.distinct()


def can_edit_entry_of(actor: Actor, owner_user) -> bool:
    """Nobody edits their own entry; only someone of a higher role (the admin can edit anything)."""
    if actor.level >= ADMIN:
        return True
    if owner_user is None:
        return actor.level >= SUPERVISOR
    if owner_user.pk == actor.user.pk:
        return False
    return actor.level > level_of(owner_user)


def level_of(user) -> int:
    """Role level of any user, even inactive ones."""
    try:
        return LEVEL[user.staff.role]
    except (StaffProfile.DoesNotExist, AttributeError):
        return ADMIN if getattr(user, "is_superuser", False) else EMPLOYEE


def notify(users, title: str, body: str = "", link: str = "", exclude=None):
    seen = set()
    rows = []
    for u in users:
        if u.pk in seen or (exclude and u.pk == exclude.pk):
            continue
        seen.add(u.pk)
        rows.append(Notification(recipient=u, title=title[:160], body=body[:500], link=link))
    Notification.objects.bulk_create(rows)


def notify_admins(title: str, body: str = "", link: str = "", exclude=None):
    notify(users_at_level(ADMIN), title, body, link, exclude=exclude)


class IsActiveStaff(permissions.BasePermission):
    message = "Sign in with an active staff account."

    def has_permission(self, request, view):
        a = actor_for(request.user)
        request.actor = a
        return a is not None
