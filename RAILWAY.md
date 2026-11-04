# 🚂 Deploying Flavor House on Railway

You will create **one Railway project** with **3 services**:

| Service    | What it is                          | Built from               |
|------------|-------------------------------------|--------------------------|
| `Postgres` | The database                        | Railway's PostgreSQL     |
| `backend`  | Django API + admin                  | `backend/Dockerfile`     |
| `frontend` | Next.js website                     | `frontend/Dockerfile`    |

Railway uses the Dockerfiles in this project automatically.

---

## Step 0 — Put the code on GitHub

```bash
cd flavorhouse
git init
git add .
git commit -m "Flavor House"
```
Create an **empty** repository on github.com (for example `flavorhouse`), then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/flavorhouse.git
git branch -M main
git push -u origin main
```
`.gitignore` already keeps out `.env`, `node_modules`, `.venv` and uploaded images.

---

## Step 1 — Create the project and database

1. Go to https://railway.com and sign in with GitHub.
2. Click **New Project → Deploy PostgreSQL**. You now have a `Postgres` service.

---

## Step 2 — Backend (Django)

1. In the project, click **+ Create → GitHub Repo** and choose your `flavorhouse` repository.
2. Click the new service → **Settings**:
   - **Service name:** `backend`
   - **Root Directory:** `/backend`
   - **Networking → Generate Domain.** You'll get something like `backend-production-xxxx.up.railway.app`. Copy it.
3. **Variables** tab → **Raw Editor**, paste this and fill in your values:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
DEBUG=False
SECRET_KEY=paste-a-long-random-string-here
ALLOWED_HOSTS=${{RAILWAY_PUBLIC_DOMAIN}}
FRONTEND_URL=https://YOUR-FRONTEND-DOMAIN.up.railway.app
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CURRENCY=usd
USE_S3=False
DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_EMAIL=you@example.com
DJANGO_SUPERUSER_PASSWORD=choose-a-strong-password
SEED_MENU=true
```

   - **SECRET_KEY:** make one with `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`
   - **FRONTEND_URL:** put anything for now. You'll fix it in Step 4.
   - **STRIPE_WEBHOOK_SECRET:** put anything for now. You'll fix it in Step 5.

4. **Image storage (important).** Railway deletes files inside the container each time it redeploys, so uploaded photos need a **Volume**:
   - Right-click the `backend` service → **Attach Volume**
   - **Mount path:** `/app/media`

   (Or use S3 / Cloudflare R2 instead. See "Images on S3/R2" below.)

5. Click **Deploy**. In **Deployments → View logs** you should see:
   ```
   Superuser created successfully.
   Seeded 6 categories and 22 items.
   Listening at: http://0.0.0.0:...
   ```
6. Open `https://YOUR-BACKEND-DOMAIN/admin/` and log in with the superuser username and password.
7. ⚠️ **Delete the `SEED_MENU` variable now.** Otherwise each restart resets the sample items' options and undoes your admin edits to them.

---

## Step 3 — Frontend (Next.js)

1. **+ Create → GitHub Repo → the same `flavorhouse` repository** again.
2. **Settings:**
   - **Service name:** `frontend`
   - **Root Directory:** `/frontend`
   - **Networking → Generate Domain** → copy it (for example `frontend-production-xxxx.up.railway.app`)
3. **Variables:**
```
NEXT_PUBLIC_API_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}/api
NEXT_PUBLIC_SITE_NAME=Flavor House
```
   Variables starting with `NEXT_PUBLIC_` are built into the site. If you change them later, **redeploy** the frontend.

4. Deploy.

---

## Step 4 — Connect the backend to the frontend

Go back to **backend → Variables** and set:
```
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
```
The backend redeploys. Open your frontend domain. The menu should load. 🎉

---

## Step 5 — Stripe webhook (marks orders as Paid)

1. Go to https://dashboard.stripe.com/test/webhooks → **Add endpoint**
2. **Endpoint URL:** `https://YOUR-BACKEND-DOMAIN/api/stripe/webhook/`
3. **Events:**
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Copy the **Signing secret** (`whsec_…`) into the backend's `STRIPE_WEBHOOK_SECRET` variable.
5. Place a test order with card `4242 4242 4242 4242`. In admin → **Orders**, it should show as **Paid**.

To accept real money, switch Stripe to **live mode**. Then replace `STRIPE_SECRET_KEY` with your `sk_live_…` key and create a live webhook the same way.

---

## Custom domain (optional)

- Frontend → **Settings → Networking → Custom Domain**, for example `www.yourrestaurant.com`. Add the DNS record Railway shows you.
- Backend → custom domain, for example `api.yourrestaurant.com`.
- Then update the variables:
  - backend `ALLOWED_HOSTS=api.yourrestaurant.com,${{RAILWAY_PUBLIC_DOMAIN}}`
  - backend `FRONTEND_URL=https://www.yourrestaurant.com,https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}`
  - frontend `NEXT_PUBLIC_API_URL=https://api.yourrestaurant.com/api` (then redeploy)
  - Stripe webhook URL → the new API domain

---

## Images on S3 / Cloudflare R2 (alternative to a Volume)

Set these on the backend instead of attaching a volume:
```
USE_S3=True
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_STORAGE_BUCKET_NAME=...
AWS_S3_REGION_NAME=auto
AWS_S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
AWS_S3_CUSTOM_DOMAIN=<your public R2 / CDN domain>
```

---

## Running commands on the server (optional)

Install the Railway CLI, then:
```bash
railway login
railway link                                  # choose the project and the backend service
railway ssh -- python manage.py createsuperuser
railway ssh -- python manage.py seed_menu
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **Bad Request (400)** on the backend | `ALLOWED_HOSTS` doesn't include the domain you're opening |
| Website says **"Can't reach the menu API"** | Check `NEXT_PUBLIC_API_URL` (must end in `/api`), then **redeploy the frontend** |
| Browser console shows a **CORS** error | Backend `FRONTEND_URL` must exactly match the website address, with `https://` and no trailing `/` |
| **CSRF verification failed** when logging in to admin | Make sure `DEBUG=False` and you're using the `https://` address |
| Photos disappear after a redeploy | Attach a Volume at `/app/media`, or use S3/R2 |
| Order stays **"Awaiting payment"** | Check the webhook URL and `STRIPE_WEBHOOK_SECRET`. Stripe → Webhooks shows any failed deliveries |
| Home page is empty right after the first deploy | Wait about a minute and refresh. It updates every 60 seconds |
