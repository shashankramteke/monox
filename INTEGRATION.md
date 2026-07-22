# Integrating Real Payment Gateways

MonoXAI is a **payment monitoring** platform: gateways *push* their payment
events to your app via signed webhooks, and the dashboard shows them live —
feed, per-gateway health, real-time anomaly detection, and AI root-cause.

The software side is **already built and deployed**. Every gateway below has a
live, signature-verified webhook endpoint. To integrate a gateway you only do
two things: (1) set its webhook secret on your deployment, and (2) add the
webhook URL in that gateway's dashboard.

Base URL of your app: **https://creatersduo-monoxai.hf.space**

---

## Fastest path (recommended): Razorpay sandbox — free, no KYC

1. Sign up at https://razorpay.com and stay in **Test Mode** (top-left toggle).
2. The webhook secret is already set on your Space
   (`RAZORPAY_WEBHOOK_SECRET`). Use that exact value in step 3.
3. **Settings → Webhooks → Add New Webhook**
   - URL: `https://creatersduo-monoxai.hf.space/api/webhooks/razorpay`
   - Secret: your `RAZORPAY_WEBHOOK_SECRET`
   - Active events: `payment.captured`, `payment.failed`, `refund.processed`
4. **Payment Links → Create Payment Link**, open it, pay with test creds:
   - UPI success: `success@razorpay`  ·  UPI failure: `failure@razorpay`
   - Test card: `4111 1111 1111 1111`, any future expiry, any CVV
5. The payment appears in your dashboard in seconds and the badge turns green
   **Real Payments**.

---

## All gateways

| Gateway | Webhook URL (append to base) | Signature scheme | Secret env var |
|---|---|---|---|
| Razorpay | `/api/webhooks/razorpay` | `X-Razorpay-Signature` (HMAC-SHA256) | `RAZORPAY_WEBHOOK_SECRET` |
| Stripe | `/api/webhooks/stripe` | `Stripe-Signature` (t=,v1=) | `STRIPE_WEBHOOK_SECRET` |
| PhonePe | `/api/webhooks/phonepe` | `X-VERIFY` = sha256(base64+salt)###index | `PHONEPE_WEBHOOK_SECRET` |
| Cashfree | `/api/webhooks/cashfree` | HMAC-SHA256 of `timestamp+body` | `CASHFREE_WEBHOOK_SECRET` |
| PayU | `/api/webhooks/payu` | SHA512 reverse hash | `PAYU_WEBHOOK_SECRET` (merchant SALT) |
| Paytm | `/api/webhooks/gateway/paytm` | HMAC-SHA256 (`X-Webhook-Signature`) | `PAYTM_WEBHOOK_SECRET` |
| JusPay | `/api/webhooks/gateway/juspay` | HMAC-SHA256 (`X-Webhook-Signature`) | `JUSPAY_WEBHOOK_SECRET` |
| CCAvenue | `/api/webhooks/gateway/ccavenue` | HMAC-SHA256 (`X-Webhook-Signature`) | `CCAVENUE_WEBHOOK_SECRET` |
| Custom / any | `/api/webhooks/gateway/<name>` | HMAC-SHA256 (`X-Webhook-Signature`) | `<NAME>_WEBHOOK_SECRET` or shared `GATEWAY_WEBHOOK_SECRET` |

A single **`GATEWAY_WEBHOOK_SECRET`** works as a shared fallback for all the
`/api/webhooks/gateway/<name>` gateways (Paytm/JusPay/CCAvenue/Custom).

### Setting a secret on your Hugging Face Space
Space → **Settings → Variables and secrets → New secret** → paste the env-var
name and a strong value. The Space restarts and that gateway becomes "ready."

### Universal webhook payload (Paytm/JusPay/CCAvenue/Custom)
POST JSON, signed `X-Webhook-Signature: HMAC_SHA256(rawBody, secret)` (hex or base64):
```json
{ "txn_id": "TXN123", "order_id": "ORD1", "amount": 1499, "currency": "INR",
  "method": "UPI", "provider": "Paytm", "gateway": "Paytm", "status": "SUCCESS",
  "user": "customer***" }
```
`status`: `SUCCESS` | `FAILED` | `PENDING`.

---

## What you get automatically once data flows

- **Live feed** of real payments (Transactions view), tagged `source: live`.
- **API Network** (Integrations view) shows each gateway go live with throughput
  + success rate.
- **Real-time anomaly detection**: gateway failure-rate spikes, fraud velocity,
  duplicate charges, gateway timeouts — with **AI root-cause analysis**.
- **Look up any payment by transaction ID** (header search → Enter) to see the
  payment timeline and any anomalies detected on it.
- **Real-only mode** auto-engages on the first real payment (the simulator is
  already off), so you see only genuine data.

---

## Troubleshooting

Check your gateway dashboard's **webhook → recent deliveries**:
- **200 OK** — the app received and displayed it. Done.
- **401** — signature mismatch. The secret in the gateway must exactly match the
  env var on your Space (no extra spaces/quotes).
- **503** — that gateway's secret isn't set on the Space yet.
- **Nothing / timeout** — the Space may be asleep (free Spaces sleep after ~48h
  idle; open the dashboard to wake it). Gateways retry for up to 24h.

Native receivers (PhonePe, Cashfree, PayU) are implemented to each gateway's
documented signature spec but should be validated against your gateway's actual
sandbox delivery. If one returns 401 with the correct secret, share a sample
delivery payload from the gateway dashboard and the receiver can be tuned to match.

---

## A note on scope

This app **monitors** payments; it does not process them — the gateway (the
licensed entity) moves the money on its own secure page, so no card data or PCI
burden touches this app. If you later want the app to also *create* payments
(a checkout flow), that's a separate build using the gateway's Orders API with
API keys stored as Space secrets.
