# Future PayPal Live enablement checklist

Live is not enabled by this project. Do not use the Sandbox plan IDs, app credentials, webhook ID or buyer accounts for Live.

- [ ] Complete legal/pricing review for Germany, including applicable VAT, invoices, consumer cancellation/withdrawal information, terms and privacy disclosures.
- [ ] Implement and verify any plan-specific feature/usage limits before advertising them; current plan copy makes no such promises.
- [ ] Create and verify the operator's Live PayPal business REST app and enable Subscriptions.
- [ ] Create a Live product and three new Live plans with exactly EUR 4.99, 9.99 and 19.99 at one-month intervals. Record the distinct Live plan IDs in backend secrets.
- [ ] Register a new Live webhook at the production `/api/v1/webhooks/paypal` URL for every event in `PAYPAL_SANDBOX.md`; store its distinct Live webhook ID.
- [ ] Run the existing PostgreSQL migration and verify backup/restore, account-deletion and payment-record retention policies.
- [ ] Verify monitoring, reconciliation, refund/reversal operations, support ownership and ingress rate/body limits.
- [ ] Test signed webhook failure, duplicate delivery, suspension, expiry, cancellation and paid-through access in a controlled pre-live environment.
- [ ] Only after operator approval in an explicit production environment, set `APP_ENV=production`, `PAYPAL_ENV=live`, `PAYPAL_LIVE_ENABLED=true`, the Live backend credentials and Live plan IDs. Any other environment/mode combination fails closed.
- [ ] Set the public frontend client ID to the Live app's client ID and deploy through the operator's controlled release process.
- [ ] Perform an operator-authorized low-value Live verification and reconcile it in PayPal and PostgreSQL. Do not describe this as tested before it actually occurs.