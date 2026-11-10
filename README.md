# StockLedger — daily stock & sale control

A small full-stack app to track product stock and sales every day, with:
- **Admin dashboard**: manage products (add/edit/delete/stock), see today's revenue/orders/units sold, view all sales.
- **Customer dashboard**: browse products and buy them, view personal order history.
- **Login pages** for both, backed by MongoDB.

## Tech
Node.js + Express + MongoDB (Mongoose) on the backend, plain HTML/CSS/JS on the frontend (no build step needed).

## 1. Install

```bash
cd stock-app
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
- `MONGO_URI` — your MongoDB connection string.
  - Local Mongo: `mongodb://127.0.0.1:27017/stockdb`
  - MongoDB Atlas (free tier works fine): `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/stockdb`
- `JWT_SECRET` — any long random string (used to sign login sessions).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the admin account that will be created in the next step.

## 3. Create the admin account

```bash
npm run seed
```

This creates (or promotes) the admin user defined in `.env`. Only run this once per admin — customers register themselves through the app.

## 4. Run the server

```bash
npm start
```

Then open **http://localhost:5000**.

- Log in with the admin email/password from `.env` → goes to `/admin.html`.
- Click "Create an account" on the login page to register as a customer → goes to `/customer.html`.

## How it works

- `POST /api/auth/register` — public customer sign-up (always creates role `customer`).
- `POST /api/auth/login` — shared login for both admin and customer; role comes from the database, and each dashboard checks it before loading.
- `GET/POST/PUT/DELETE /api/products` — admin-only for create/update/delete; both roles can list/view. Customers only see active products.
- `POST /api/sales` — customer checkout; runs inside a MongoDB transaction so stock is only deducted if the purchase succeeds, and it blocks the purchase if there isn't enough stock.
- `GET /api/sales/mine` — a customer's own order history.
- `GET /api/sales` and `GET /api/sales/summary/today` — admin-only sales list and today's totals.

All dashboard pages check the saved login token client-side and redirect to `/login.html` if it's missing or the wrong role, and the server independently re-checks the role on every API call (the frontend check is just for a smooth experience — it isn't the security boundary).

## Notes / next steps you may want
- Passwords are hashed with bcrypt; tokens are JWTs valid for 7 days.
- To add more admins, either run the seed script again with a different `ADMIN_EMAIL`, or manually update a user's `role` field to `"admin"` in MongoDB.
- This is set up for one currency/locale (`$` formatting) — change `money()` in `public/js/api.js` if you need another format.
- For production, put this behind HTTPS, add rate limiting on `/api/auth`, and set a stronger `JWT_SECRET`.

## Email verification (6-digit code)
New customers get a 6-digit code after registering, and unverified accounts are asked for it when they log in.
- Run `npm install` once (adds `nodemailer`).
- To really email the code, fill `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and optionally `MAIL_FROM`) in `.env`. For Gmail use an App Password.
- Without SMTP settings, registration shows an error (codes are not printed in the terminal). Check your setup with `npm run test-mail -- you@example.com`.
- For local testing only, set `SHOW_CODE_ON_SCREEN=true` to display the code inside the popup.
- Accounts created before this feature (no `emailVerified` field) and admins are not asked for a code.
