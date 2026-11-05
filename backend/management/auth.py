"""Sign-in rules for staff devices.

* Employees can only use registered store devices (the device sends its key in the X-Device-Key header).
* Sign-ins expire: employees after one long shift (14 h), everyone else after 7 days.
"""
import datetime
import hashlib

from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import Terminal

EMPLOYEE_TTL = datetime.timedelta(hours=14)
STAFF_TTL = datetime.timedelta(days=7)


def hash_key(key: str) -> str:
    return hashlib.sha256((key or "").encode()).hexdigest()


def terminal_for(request):
    key = request.META.get("HTTP_X_DEVICE_KEY") or (request.data.get("device_key") if hasattr(request, "data") else "")
    if not key:
        return None
    return Terminal.objects.select_related("branch").filter(key_hash=hash_key(key), is_active=True).first()


def is_employee(user) -> bool:
    try:
        return user.staff.role == "employee"
    except Exception:
        return False


class StaffTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        ttl = EMPLOYEE_TTL if is_employee(user) else STAFF_TTL
        if timezone.now() - token.created > ttl:
            token.delete()
            raise AuthenticationFailed("Your sign-in expired. Please sign in again.")
        return user, token

    def authenticate(self, request):
        result = super().authenticate(request)
        from django.conf import settings
        if result and is_employee(result[0]) and settings.REQUIRE_REGISTERED_DEVICE:
            term = terminal_for(request)
            if not term or (term.branch_id != getattr(result[0].staff, "branch_id", None)):
                raise AuthenticationFailed("Employees can only use registered store devices. Ask your manager.")
            Terminal.objects.filter(pk=term.pk).update(last_seen=timezone.now(), last_user=result[0])
        return result
