#!/bin/sh
# Container start script (used by Docker and Railway).
set -e

python manage.py migrate --noinput

# Optional: create the admin user automatically.
# Set DJANGO_SUPERUSER_USERNAME, DJANGO_SUPERUSER_EMAIL and DJANGO_SUPERUSER_PASSWORD.
if [ -n "$DJANGO_SUPERUSER_USERNAME" ]; then
  python manage.py createsuperuser --noinput 2>/dev/null || echo "Superuser already exists."
fi

# Optional: load the sample menu. Set SEED_MENU=true for the FIRST deploy only,
# then remove it (otherwise it resets the sample items' options on every restart).
if [ "$SEED_MENU" = "true" ]; then
  python manage.py seed_menu
fi

exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3}
