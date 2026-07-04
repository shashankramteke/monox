---
title: MonoXAI Observability Dashboard
emoji: 📡
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# MonoXAI — High-Precision Forensics & Telemetry Platform

Real-time observability platform for a simulated payments company: live
telemetry streaming (WebSocket), universal transaction monitoring, Kubernetes
cluster monitoring, anomaly detection (rule-based + ML ensemble simulation),
trace waterfalls, correlated logs, and AI-powered root cause analysis.

## Features
- **Live telemetry** — P99 latency, throughput, and PII-redaction metrics for 6 microservices, streamed every second over WebSocket
- **Universal transaction monitoring** — live feed of purchases, refunds, payouts, subscriptions, transfers, and top-ups across UPI, cards, net banking, wallets, bank transfers, and BNPL, with success-rate/volume/TPS KPIs, gateway health, and failure-reason analytics
- **Payment incident detection** — gateway failure storms, gateway timeouts, fraud velocity alerts, duplicate charges
- **Kubernetes monitoring** — simulated live cluster (nodes, pods, restarts, HPA scaling, event stream) with CrashLoopBackOff / OOMKilled anomalies flowing into the incident stream
- **Anomaly alerts** — N+1 query regressions, bimodal latency, dependency chain breaks, ML ensemble outliers, PII density breaches
- **Trace forensics** — multi-service span waterfalls with dependency chains
- **AI RCA** — Gemini-powered root cause analysis (set the `GEMINI_API_KEY` secret in Space settings; without it, a built-in heuristic RCA engine responds instead)

## Configuration
| Secret / Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | No | Enables real Gemini AI root-cause analysis in the Forensics modal |
| `RAZORPAY_WEBHOOK_SECRET` | No | Enables `POST /api/webhooks/razorpay` — real Razorpay payments stream into the live feed (signature-verified) |
| `STRIPE_WEBHOOK_SECRET` | No | Enables `POST /api/webhooks/stripe` — real Stripe payments stream into the live feed (signature-verified) |
| `INGEST_API_KEY` | No | Enables `POST /api/ingest/transaction` (header `X-API-Key`) to push transactions from any system |
| `TXN_SIMULATOR` | No | Set to `off` to stop simulated transactions (real webhook data only) |
| `SIMULATOR` | No | Set to `off` to disable the entire telemetry simulator |
