from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic import RedirectView
from django.views.static import serve

admin.site.site_header = "Flavor House Admin"
admin.site.site_title = "Flavor House"
admin.site.index_title = "Manage menu & orders"

urlpatterns = [
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/", admin.site.urls),
    path("api/", include("menu.urls")),
    path("api/", include("orders.urls")),
]

# Serve uploaded images from local disk (also in production, e.g. a Railway volume).
# When USE_S3=True, images are served directly by S3/R2 instead.
if not settings.USE_S3:
    urlpatterns += [
        re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    ]
