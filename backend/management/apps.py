from django.apps import AppConfig


class ManagementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "management"
    verbose_name = "Back office"

    def ready(self):
        from . import change_handlers  # noqa: F401  (registers the approval handlers)
        from . import views_bills  # noqa: F401  (bills & delivery-app handlers)
