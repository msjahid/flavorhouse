# 🔥 Flavor House — Restaurant ordering website

Online ordering site for a restaurant selling flavoured wings, burgers, drinks, milkshakes and cakes.

| Part      | Tech                                                               |
|-----------|--------------------------------------------------------------------|
| Frontend  | Next.js 15 (App Router) + TypeScript + Tailwind CSS 4              |
| API       | Django 5 + Django REST Framework                                   |
| Database  | PostgreSQL                                                         |
| Images    | Uploaded in Django admin → local disk (`backend/media/`) or S3 / R2 |
| Payments  | Stripe Checkout + webhook                                          |

## Features

- Home page with categories and featured items
- Menu with category tabs and search
- Item page with option groups: **flavours** (up to 2 per wing order), **sizes**, **dips**, **extras**, **toppings**, each with its own price
- Cart that is saved in the browser
- Checkout with pickup or delivery. The delivery fee and tax are added automatically.
- **All prices are recalculated on the server.** The browser can't change what the customer pays.
- Payment on Stripe's hosted page. Orders are marked *Paid* by the webhook, or by a check against Stripe when the success page loads.
- Django admin to manage categories, items, photos, option groups and orders, including order status

---

## 1. Run locally (without Docker)

### Requirements
- Python 3.11+
- Node.js 20+
- PostgreSQL 14+

### Database
```bash
psql -U postgres -c "CREATE USER flavorhouse WITH PASSWORD 'flavorhouse' CREATEDB;"
psql -U postgres -c "CREATE DATABASE flavorhouse OWNER flavorhouse;"
```

### Backend (Django API)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then add your Stripe keys
python manage.py migrate
python manage.py seed_menu         # loads a sample menu
python manage.py createsuperuser   # login for /admin
python manage.py runserver
```
- API: http://localhost:8000/api/items/
- Admin: http://localhost:8000/admin/

### Frontend (Next.js)
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
Open http://localhost:3000

---

## 2. Run with Docker
```bash
cp backend/.env.example backend/.env   # add Stripe keys
docker compose up --build
docker compose exec backend python manage.py seed_menu
docker compose exec backend python manage.py createsuperuser
```

---

## Deploying to Railway

See **[RAILWAY.md](RAILWAY.md)** for step-by-step instructions.

---

## 3. Stripe setup

1. Create a free account at https://dashboard.stripe.com. Stay in **test mode**.
2. Copy the **Secret key** (`sk_test_…`) into `backend/.env` as `STRIPE_SECRET_KEY`.
3. Forward webhooks to your local server with the [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:8000/api/stripe/webhook/
   ```
   It prints a `whsec_…` secret. Put it in `.env` as `STRIPE_WEBHOOK_SECRET` and restart Django.
4. Pay with the test card `4242 4242 4242 4242`, any future date, any CVC.

In production, add a webhook endpoint in the Stripe dashboard pointing to
`https://YOUR-API-DOMAIN/api/stripe/webhook/` with these events:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`.

---

## 4. Adding photos

Go to **Admin → Menu items**, open an item and upload an **Image**. Categories can have images too.
Items without a photo show their emoji on a coloured tile.

**Storing images on S3 / Cloudflare R2 / DigitalOcean Spaces** (recommended for production):
set these values in `backend/.env`:
```
USE_S3=True
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_STORAGE_BUCKET_NAME=...
AWS_S3_REGION_NAME=us-east-1
# R2 / Spaces only:
AWS_S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
AWS_S3_CUSTOM_DOMAIN=images.yourdomain.com
```
The bucket must allow public reads for the image files.

---

## 5. Customising

| What                            | Where                                                |
|---------------------------------|------------------------------------------------------|
| Restaurant name                 | `NEXT_PUBLIC_SITE_NAME` in `frontend/.env.local`     |
| Colours / fonts                 | `frontend/src/app/globals.css` (`@theme` block)      |
| Delivery fee & tax rate         | `DELIVERY_FEE`, `TAX_RATE` in `backend/.env`         |
| Currency                        | `STRIPE_CURRENCY` (also update `frontend/src/lib/format.ts`) |
| Menu, prices, flavours          | Django admin, or edit `seed_menu.py`                 |
| Opening hours / footer text     | `frontend/src/components/Footer.tsx`                 |

## API endpoints

| Method | URL                                   | Purpose                               |
|--------|---------------------------------------|---------------------------------------|
| GET    | `/api/categories/`                    | List categories                       |
| GET    | `/api/items/?category=wings&search=`  | List items (`featured=true` optional) |
| GET    | `/api/items/<slug>/`                  | Item with option groups               |
| POST   | `/api/cart/quote/`                    | Server-calculated totals              |
| POST   | `/api/checkout/`                      | Create order + Stripe session         |
| GET    | `/api/orders/session/<session_id>/`   | Order status (success page)           |
| POST   | `/api/stripe/webhook/`                | Stripe webhook                        |

## Tests
```bash
cd backend && python manage.py test
```

## Project structure
```
flavorhouse/
├── backend/
│   ├── config/          settings, urls
│   ├── menu/            Category, MenuItem, OptionGroup, Option + seed_menu command
│   └── orders/          Order, OrderItem, pricing, Stripe checkout & webhook
├── frontend/src/
│   ├── app/             pages: /, /menu, /menu/[slug], /cart, /checkout, /order/success
│   ├── components/      Header, MenuItemCard, ItemCustomizer, OrderSummary…
│   ├── context/         CartContext (cart saved in the browser)
│   └── lib/             API client, types, formatting
└── docker-compose.yml
```
