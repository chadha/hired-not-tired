# PayPal Sandbox monthly subscriptions

This integration uses **PayPal Subscriptions**, not one-time Orders. It is Sandbox-only and performs no real charge. A browser approval never grants access by itself.

## Locked plan mapping

Create one Sandbox product, then these three recurring plans under it:

| Server plan key | Plan name | Price | Currency | Regular billing interval |
| --- | --- | ---: | --- | --- |
| `starter` | Starter | 4.99 | EUR | 1 month |
| `pro` | Pro | 9.99 | EUR | 1 month |
| `premium` | Premium | 19.99 | EUR | 1 month |

Pro is the visually recommended plan. No additional feature or usage limit is implied by the current implementation.

## 1. Create Sandbox accounts and a REST app

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) with the operator's own account.
2. In **Sandbox → Accounts**, create or select a **business** account for the merchant and a **personal** account for the test buyer. Never use real customer/card details.
3. In **Apps & Credentials → Sandbox**, create a REST app for the business account. Enable the capabilities PayPal requires for Subscriptions.
4. Copy its Sandbox client ID and secret into backend environment secrets. The secret is never a `VITE_*` value and never enters source control.

## 2. Create the product and plans

Using PayPal's Sandbox catalog/subscriptions tools or REST APIs:

1. Create one product for Hired Not Tired and retain its product ID.
2. Create Starter, Pro and Premium under that product using the exact mapping above. Each plan needs a regular billing cycle with `interval_unit=MONTH`, `interval_count=1`, the exact EUR amount, and no invented trial or usage promise.
3. Activate each plan and retain its PayPal plan ID (`P-...`). Plan IDs from Live or another Sandbox app cannot be substituted.

## 3. Configure Hired Not Tired

Backend `.env` through the operator's secret process:

```text
PAYPAL_ENV=sandbox
PAYPAL_LIVE_ENABLED=false
PAYPAL_CLIENT_ID=<Sandbox REST app client ID>
PAYPAL_CLIENT_SECRET=<Sandbox REST app secret>
PAYPAL_WEBHOOK_ID=<created in the next step>
PAYPAL_STARTER_PLAN_ID=<Starter Sandbox P-...>
PAYPAL_PRO_PLAN_ID=<Pro Sandbox P-...>
PAYPAL_PREMIUM_PLAN_ID=<Premium Sandbox P-...>
```

Frontend public configuration:

```text
VITE_API_BASE_URL=http://localhost:8000
VITE_PAYPAL_CLIENT_ID=<the same Sandbox app's public client ID>
```

Only the client ID is public. The backend maps plan keys, prices, currency and interval. The browser sends only a plan key to create a pending intent, then an intent ID and PayPal subscription ID for verification. PayPal must return the matching `custom_id`, plan ID and exact server-verified plan pricing before an ACTIVE entitlement is stored.

`PAYPAL_ENV=live` fails closed unless both `APP_ENV=production` and the future explicit `PAYPAL_LIVE_ENABLED=true` are present. Do not set that flag for this milestone.

## 4. Apply the existing backend migration

```bash
cd backend
alembic upgrade head
alembic current
```

Migration `20261122_0003_paypal_subscriptions` adds pending checkouts, subscriptions, payment transactions and unique processed webhook event IDs. It changes no frontend/Lovable database and no database provider.

## 5. Register the Sandbox webhook

In the same Sandbox REST app, add this listener after choosing a reachable backend hostname:

```text
https://<chosen-backend-hostname>/api/v1/webhooks/paypal
```

For local development, use an operator-controlled HTTPS tunnel to the local FastAPI route; do not invent a public hostname. Retain the generated webhook ID as `PAYPAL_WEBHOOK_ID`.

Subscribe to these exact event names from PayPal's [Subscriptions webhook documentation](https://developer.paypal.com/subscriptions/webhooks):

- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.UPDATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.EXPIRED`
- `PAYMENT.SALE.COMPLETED`
- `PAYMENT.SALE.REFUNDED`
- `PAYMENT.SALE.REVERSED`

The backend calls PayPal's verification API with the received transmission headers, raw event and configured webhook ID. Anything other than `verification_status=SUCCESS` is rejected. Subscription changes are re-read from PayPal before stored status changes. Event IDs and PayPal subscription/transaction IDs are unique for idempotent handling.

## 6. Test with Sandbox accounts

1. Sign in to Hired Not Tired through the configured real test authentication flow; the fictional local demo cannot subscribe.
2. Open `/pricing`, choose a configured plan and approve using the **Sandbox personal** buyer account.
3. Confirm the SDK uses `vault=true`, `intent=subscription`, `currency=EUR` and the selected Sandbox plan ID.
4. Confirm the backend verifies `custom_id`, plan, exact amount/currency/monthly interval and `status=ACTIVE` before displaying entitlement.
5. Cancel renewal from `/pricing`; confirm cancellation and the paid-through date. Access must not disappear early when the confirmed paid-through date remains in the future.
6. Test activation, update, cancellation, suspension and expiration events, plus completed/refunded/reversed payments. Confirm duplicate delivery does not duplicate records.
7. Inspect the business/personal Sandbox dashboards and backend records. Never print or commit access tokens, client secrets, cookies or webhook signatures.

A real Sandbox end-to-end checkout has **not** been completed by the code implementation alone. Record that verification separately only after it actually occurs.