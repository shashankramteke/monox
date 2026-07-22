import os
import logging
import json
import asyncio
import random
import uuid
import math
import aiosqlite
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any
from abc import ABC, abstractmethod
from dotenv import load_dotenv

import hmac
import hashlib

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import google.generativeai as genai
except ImportError:
    genai = None
    logging.warning("google-generativeai not installed. AI RCA will be unavailable.")

# Load environment variables
load_dotenv()

# ── Real-payment / simulator configuration ─────────────────────────
# SIMULATOR=off        → disable the whole telemetry simulator
# TXN_SIMULATOR=off    → disable only simulated transactions (real
#                        webhook/ingested transactions still flow)
# AUTO_REAL_ONLY=off   → keep simulating even after real payments arrive
#                        (default ON: the first real payment silences the
#                        transaction simulator so the feed is real-only)
# RAZORPAY_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET → enable gateway webhooks
# INGEST_API_KEY       → enable the generic POST /api/ingest/transaction
_off = ("off", "0", "false", "no")
SIMULATOR_ENABLED = os.getenv("SIMULATOR", "on").lower() not in _off
TXN_SIMULATOR_ENABLED = os.getenv("TXN_SIMULATOR", "on").lower() not in _off
AUTO_REAL_ONLY = os.getenv("AUTO_REAL_ONLY", "on").lower() not in _off
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
INGEST_API_KEY = os.getenv("INGEST_API_KEY")
# Per-gateway webhook secrets. A single GATEWAY_WEBHOOK_SECRET works as a
# shared fallback so every universal-webhook gateway can be enabled at once.
GATEWAY_WEBHOOK_SECRET = os.getenv("GATEWAY_WEBHOOK_SECRET")
def _gateway_secret(name: str):
    return os.getenv(f"{name.upper()}_WEBHOOK_SECRET") or GATEWAY_WEBHOOK_SECRET

# Runtime flag: flips True the moment a real payment is ingested. When
# AUTO_REAL_ONLY is on, this permanently silences simulated transactions so
# the dashboard shows only genuine payments once you go live.
REAL_PAYMENTS_SEEN = {"active": False, "count": 0, "last_gateway": None, "since": None}

# ── Real-time detection state + tuning (runs on REAL ingested payments) ──
# Rolling windows keep the detectors cheap and stateful across requests.
from collections import deque, defaultdict
RT_RECENT = deque(maxlen=400)                 # recent txns (all gateways)
RT_USER_HITS = defaultdict(lambda: deque(maxlen=60))   # user -> recent timestamps
RT_SEEN_CHARGES = deque(maxlen=400)           # (user, amount) fingerprints for dup detection
RT_FIRED = {}                                 # de-dupe: key -> last-fired epoch
# Real observability metrics are derived from the real payment stream, so the
# Observability view reflects genuine payment traffic (no synthetic data).
RT_PAY_TIMES = deque(maxlen=1000)             # epoch time of each real payment (throughput)
RT_PAY_LAT = deque(maxlen=300)                # recent real payment latencies (p99)
RT_TUNING = {
    "fail_window": 12,        # look at last N txns for a gateway
    "fail_min": 3,            # need at least this many to judge (testable manually)
    "fail_rate": 0.50,        # >=50% failures -> spike
    "velocity_per_min": 5,    # >=N txns/min from one user -> fraud velocity
    "dup_window_s": 120,      # same (user,amount) within N seconds -> duplicate
    "latency_ms": 8000,       # single txn slower than this -> gateway timeout
    "refire_cooldown_s": 45,  # don't refire the same alert type/target too often
}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# BUILT-IN DATA SIMULATOR — generates realistic telemetry so the
# dashboard works standalone without Docker/RabbitMQ/Bytewax.
# ═══════════════════════════════════════════════════════════════════

SERVICES = ["api-gateway", "payment-service", "order-service", "fraud-service", "wallet-service", "notification-service"]
ROUTES = {
    "api-gateway": ["/api/checkout", "/api/pay", "/api/orders", "/api/refunds", "/api/health"],
    "payment-service": ["/charge", "/authorize", "/capture", "/refund", "/webhook/psp"],
    "order-service": ["/orders/create", "/orders/confirm", "/orders/status", "/inventory/reserve"],
    "fraud-service": ["/risk/score", "/risk/velocity", "/risk/device", "/rules/evaluate"],
    "wallet-service": ["/wallet/debit", "/wallet/credit", "/wallet/balance", "/wallet/topup"],
    "notification-service": ["/notify/sms", "/notify/email", "/notify/push", "/webhook/delivery"],
}
SEVERITIES = ["DEBUG", "INFO", "INFO", "INFO", "WARNING", "ERROR"]
LOG_BODIES = {
    "api-gateway": [
        "Incoming request processed successfully",
        "Proxying checkout request to payment-service",
        "Response received from upstream in {dur}ms",
        "Rate limiter: {n} requests in window",
        "Connection pool stats: active={n}, idle={idle}",
        "TLS handshake completed for client {ip}",
        "[REDACTED_EMAIL] user authentication verified",
        "Cache miss for session {id}",
        "Request tracing: span created trace_id={tid}",
        "Middleware pipeline completed in {dur}ms",
    ],
    "payment-service": [
        "Charge authorized by PSP in {dur}ms",
        "Capture settled for order {id}",
        "[REDACTED_CC] tokenized card charged successfully",
        "PSP webhook received: settlement batch {id}",
        "3DS challenge completed in {dur}ms",
        "Idempotency key hit for txn {id}, returning cached result",
        "Retrying gateway call, attempt {n}",
        "[REDACTED_EMAIL] receipt dispatched for txn {id}",
        "Refund initiated for order {id}",
        "Ledger entry committed in {dur}ms",
    ],
    "order-service": [
        "Order {id} created in {dur}ms",
        "Inventory reserved: {n} items",
        "Database query executed: SELECT * FROM orders WHERE id={id}",
        "Order state machine: PENDING -> CONFIRMED",
        "Outbox event published for order {id}",
        "Connection pool: size={n}, available={idle}",
    ],
    "fraud-service": [
        "Risk score computed in {dur}ms",
        "Velocity check: {n} txns in window for device {id}",
        "Rule engine evaluated {n} rules in {dur}ms",
        "[REDACTED_EMAIL] account risk profile fetched",
        "Device fingerprint {id} matched allowlist",
        "Model inference latency {dur}ms",
    ],
    "wallet-service": [
        "Wallet debit of order {id} committed in {dur}ms",
        "Balance check for wallet {id}",
        "Top-up credited: reference {id}",
        "Ledger reconciliation pass: {n} entries",
        "[REDACTED_EMAIL] KYC status verified for wallet {id}",
        "Optimistic lock retry {n} on wallet {id}",
    ],
    "notification-service": [
        "SMS dispatched via provider in {dur}ms",
        "Email queued: template payment_receipt for {id}",
        "Push notification delivered to device {id}",
        "Webhook delivery attempt {n} succeeded in {dur}ms",
        "[REDACTED_EMAIL] notification preference loaded",
        "Provider callback received for message {id}",
    ],
}

ANOMALY_CONFIGS = [
    {
        "type": "N+1 Query Regression",
        "reasons": ["n_plus_1"],
        "rule_flags": lambda sc: {
            "n_plus_1": True, "n_plus_1_count": sc,
            "bimodal_latency": False, "latency_variance": 0.0,
            "dependency_break": False, "dangling_span": None,
            "pii_density": False, "redaction_ratio": 0.0,
        },
        "score_range": (0.72, 0.95),
        "duration_range": (800, 3500),
        "span_count_range": (15, 45),
    },
    {
        "type": "Bimodal Latency",
        "reasons": ["bimodal_latency"],
        "rule_flags": lambda _: {
            "n_plus_1": False, "n_plus_1_count": 0,
            "bimodal_latency": True, "latency_variance": random.uniform(80000, 350000),
            "dependency_break": False, "dangling_span": None,
            "pii_density": False, "redaction_ratio": 0.0,
        },
        "score_range": (0.60, 0.88),
        "duration_range": (1200, 5000),
        "span_count_range": (4, 12),
    },
    {
        "type": "Dependency Chain Break",
        "reasons": ["dangling_parent"],
        "rule_flags": lambda _: {
            "n_plus_1": False, "n_plus_1_count": 0,
            "bimodal_latency": False, "latency_variance": 0.0,
            "dependency_break": True, "dangling_span": f"span-{uuid.uuid4().hex[:8]}",
            "pii_density": False, "redaction_ratio": 0.0,
        },
        "score_range": (0.65, 0.92),
        "duration_range": (600, 2000),
        "span_count_range": (5, 15),
    },
    {
        "type": "ML Ensemble Anomaly",
        "reasons": ["ml_ensemble"],
        "rule_flags": lambda _: {
            "n_plus_1": False, "n_plus_1_count": 0,
            "bimodal_latency": False, "latency_variance": 0.0,
            "dependency_break": False, "dangling_span": None,
            "pii_density": False, "redaction_ratio": 0.0,
        },
        "score_range": (0.55, 0.85),
        "duration_range": (500, 2500),
        "span_count_range": (3, 10),
    },
    {
        "type": "Statistical Outlier (Isolation Forest)",
        "reasons": ["ml_ensemble"],
        "rule_flags": lambda _: {
            "n_plus_1": False, "n_plus_1_count": 0,
            "bimodal_latency": False, "latency_variance": 0.0,
            "dependency_break": False, "dangling_span": None,
            "pii_density": False, "redaction_ratio": 0.0,
        },
        "score_range": (0.70, 0.95),
        "duration_range": (900, 4000),
        "span_count_range": (3, 8),
    },
]

ML_MODELS = ["hs_trees", "lof", "isolation_forest", "autoencoder_mse", "one_class_svm"]


# ═══════════════════════════════════════════════════════════════════
# UNIVERSAL TRANSACTION ENGINE — simulates every kind of payment
# transaction (purchases, refunds, payouts, subscriptions, transfers,
# top-ups) across all methods and gateways, in real time.
# ═══════════════════════════════════════════════════════════════════

TXN_TYPES = [
    ("PURCHASE", 0.50), ("REFUND", 0.10), ("SUBSCRIPTION", 0.10),
    ("TRANSFER", 0.12), ("PAYOUT", 0.08), ("TOPUP", 0.10),
]
TXN_METHODS = {
    "UPI":           ["GPay", "PhonePe", "Paytm UPI", "BHIM", "Amazon Pay UPI"],
    "CREDIT_CARD":   ["Visa", "Mastercard", "Amex", "RuPay Credit"],
    "DEBIT_CARD":    ["Visa Debit", "Maestro", "RuPay"],
    "NET_BANKING":   ["HDFC", "ICICI", "SBI", "Axis", "Kotak"],
    "WALLET":        ["Paytm Wallet", "Amazon Pay", "Mobikwik", "Freecharge"],
    "BANK_TRANSFER": ["NEFT", "IMPS", "RTGS"],
    "BNPL":          ["Simpl", "LazyPay", "ZestMoney"],
}
TXN_METHOD_WEIGHTS = [
    ("UPI", 0.38), ("CREDIT_CARD", 0.18), ("DEBIT_CARD", 0.14),
    ("NET_BANKING", 0.10), ("WALLET", 0.10), ("BANK_TRANSFER", 0.06), ("BNPL", 0.04),
]
TXN_GATEWAYS = ["Razorpay", "Stripe", "PayU", "CCAvenue", "Cashfree", "JusPay"]
TXN_FAILURE_REASONS = {
    "UPI":           ["UPI_APP_TIMEOUT", "INVALID_VPA", "INSUFFICIENT_FUNDS", "BANK_UNAVAILABLE"],
    "CREDIT_CARD":   ["BANK_DECLINED", "3DS_AUTH_FAILED", "CARD_EXPIRED", "LIMIT_EXCEEDED"],
    "DEBIT_CARD":    ["INSUFFICIENT_FUNDS", "BANK_DECLINED", "3DS_AUTH_FAILED", "CARD_EXPIRED"],
    "NET_BANKING":   ["BANK_UNAVAILABLE", "SESSION_EXPIRED", "INSUFFICIENT_FUNDS"],
    "WALLET":        ["INSUFFICIENT_BALANCE", "WALLET_LOCKED", "KYC_REQUIRED"],
    "BANK_TRANSFER": ["BENEFICIARY_INVALID", "CUTOFF_WINDOW", "NETWORK_ERROR"],
    "BNPL":          ["CREDIT_LIMIT_EXCEEDED", "RISK_BLOCKED", "ACCOUNT_SUSPENDED"],
}
TXN_CURRENCIES = [("INR", 0.86), ("USD", 0.08), ("EUR", 0.04), ("GBP", 0.02)]


def _weighted_choice(pairs):
    r = random.random()
    acc = 0.0
    for value, weight in pairs:
        acc += weight
        if r <= acc:
            return value
    return pairs[-1][0]


def _gen_amount(txn_type: str) -> float:
    """Log-normal-ish amounts: mostly small, occasionally large."""
    base = random.lognormvariate(6.2, 1.4)  # median ~₹490
    if txn_type in ("PAYOUT", "TRANSFER"):
        base *= random.uniform(3, 25)
    elif txn_type == "SUBSCRIPTION":
        base = random.choice([99, 129, 199, 299, 499, 649, 999, 1499])
    return round(min(base, 900000), 2)


def _gen_transaction(now_iso: str, failure_rate: float, storm_gateway: str = None) -> Dict:
    txn_type = _weighted_choice(TXN_TYPES)
    method = _weighted_choice(TXN_METHOD_WEIGHTS)
    provider = random.choice(TXN_METHODS[method])
    gateway = storm_gateway if (storm_gateway and random.random() < 0.6) else random.choice(TXN_GATEWAYS)
    currency = _weighted_choice(TXN_CURRENCIES)

    roll = random.random()
    if roll < failure_rate:
        status = "FAILED"
    elif roll < failure_rate + 0.04:
        status = "PENDING"
    else:
        status = "SUCCESS"

    latency = random.uniform(80, 900)
    if status == "FAILED":
        latency += random.uniform(500, 9000)  # failures are slow (timeouts/retries)

    return {
        "txn_id": f"TXN{uuid.uuid4().hex[:12].upper()}",
        "order_id": f"ORD{random.randint(10_000_000, 99_999_999)}",
        "txn_type": txn_type,
        "method": method,
        "provider": provider,
        "gateway": gateway,
        "amount": _gen_amount(txn_type),
        "currency": currency,
        "status": status,
        "latency_ms": round(latency, 1),
        "failure_reason": random.choice(TXN_FAILURE_REASONS[method]) if status == "FAILED" else None,
        "user": f"user_{random.randint(1, 99999):05d}***",
        "timestamp": now_iso,
    }


BASE_RULE_FLAGS = {
    "n_plus_1": False, "n_plus_1_count": 0,
    "bimodal_latency": False, "latency_variance": 0.0,
    "dependency_break": False, "dangling_span": None,
    "pii_density": False, "redaction_ratio": 0.0,
}


# ═══════════════════════════════════════════════════════════════════
# KUBERNETES CLUSTER SIMULATOR — in-memory model of a small cluster
# running the platform: nodes, pods per deployment, live CPU/memory,
# restarts, HPA scaling, and a K8s event stream.
# ═══════════════════════════════════════════════════════════════════

K8S_NODES = [
    {"name": "node-pool-a1", "cpu_capacity_m": 4000, "mem_capacity_mi": 16384, "zone": "ap-south-1a"},
    {"name": "node-pool-a2", "cpu_capacity_m": 4000, "mem_capacity_mi": 16384, "zone": "ap-south-1b"},
    {"name": "node-pool-b1", "cpu_capacity_m": 8000, "mem_capacity_mi": 32768, "zone": "ap-south-1a"},
]
K8S_REPLICAS = {
    "api-gateway": 3, "payment-service": 4, "order-service": 3,
    "fraud-service": 2, "wallet-service": 2, "notification-service": 2,
}
POD_PHASES_BAD = ["CrashLoopBackOff", "OOMKilled", "Pending", "ImagePullBackOff"]


class K8sCluster:
    """Lightweight stateful cluster simulation, updated once per tick."""

    def __init__(self):
        self.pods: Dict[str, Dict] = {}
        self.events: List[Dict] = []
        self.tick = 0
        for svc, replicas in K8S_REPLICAS.items():
            for _ in range(replicas):
                self._spawn_pod(svc, at_start=True)

    def _spawn_pod(self, svc: str, at_start: bool = False):
        name = f"{svc}-{uuid.uuid4().hex[:10]}-{uuid.uuid4().hex[:5]}"
        node = random.choice(K8S_NODES)["name"]
        self.pods[name] = {
            "name": name, "deployment": svc, "node": node,
            "status": "Running" if at_start else "Pending",
            "restarts": 0,
            "cpu_m": random.uniform(60, 260),
            "mem_mi": random.uniform(180, 700),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "bad_until": 0,
        }
        if not at_start:
            self._event("Normal", "Scheduled", f"Successfully assigned default/{name} to {node}")
        return name

    def _event(self, etype: str, reason: str, message: str):
        self.events.insert(0, {
            "type": etype, "reason": reason, "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        del self.events[150:]

    def step(self):
        """Advance the cluster one tick. Returns list of anomaly alerts to emit."""
        self.tick += 1
        alerts = []
        for pod in list(self.pods.values()):
            # Resource usage: sinusoidal load + noise, correlated with tick
            load = 1 + 0.35 * math.sin(self.tick * 0.05 + hash(pod["name"]) % 7)
            pod["cpu_m"] = max(20, min(1900, pod["cpu_m"] * 0.9 + random.uniform(60, 320) * load * 0.1 + random.gauss(0, 8)))
            pod["mem_mi"] = max(120, min(3900, pod["mem_mi"] + random.gauss(0.6, 6)))

            # Recover pods whose bad phase expired
            if pod["status"] in POD_PHASES_BAD and self.tick >= pod["bad_until"]:
                if pod["status"] == "Pending":
                    self._event("Normal", "Started", f"Started container {pod['deployment']} in pod {pod['name']}")
                pod["status"] = "Running"

            if pod["status"] != "Running":
                continue

            # Rare failures
            r = random.random()
            if r < 0.004:  # CrashLoopBackOff
                pod["status"] = "CrashLoopBackOff"
                pod["restarts"] += random.randint(1, 3)
                pod["bad_until"] = self.tick + random.randint(8, 25)
                self._event("Warning", "BackOff", f"Back-off restarting failed container in pod {pod['name']} (restarts: {pod['restarts']})")
                alerts.append(self._pod_alert(pod, "Pod CrashLoopBackOff", "k8s_crashloop"))
            elif r < 0.006:  # OOMKilled
                pod["status"] = "OOMKilled"
                pod["restarts"] += 1
                pod["mem_mi"] = 120
                pod["bad_until"] = self.tick + random.randint(5, 12)
                self._event("Warning", "OOMKilling", f"Memory cgroup out of memory: killed container in pod {pod['name']}")
                alerts.append(self._pod_alert(pod, "Pod OOMKilled", "k8s_oom"))

        # HPA scaling: keep replica counts drifting realistically
        if random.random() < 0.06:
            svc = random.choice(SERVICES)
            svc_pods = [p for p in self.pods.values() if p["deployment"] == svc]
            desired = K8S_REPLICAS[svc]
            if len(svc_pods) <= desired and random.random() < 0.6 and len(svc_pods) < desired + 3:
                name = self._spawn_pod(svc)
                self.pods[name]["bad_until"] = self.tick + random.randint(2, 5)
                self._event("Normal", "ScalingReplicaSet", f"Scaled up replica set {svc} to {len(svc_pods) + 1}")
            elif len(svc_pods) > desired:
                victim = random.choice(svc_pods)
                del self.pods[victim["name"]]
                self._event("Normal", "ScalingReplicaSet", f"Scaled down replica set {svc} to {len(svc_pods) - 1}")

        return alerts

    def _pod_alert(self, pod: Dict, anomaly_type: str, reason: str) -> Dict:
        flags = dict(BASE_RULE_FLAGS)
        flags.update({
            "k8s_pod": pod["name"], "k8s_node": pod["node"],
            "k8s_restarts": pod["restarts"], "k8s_deployment": pod["deployment"],
        })
        return {
            "service": pod["deployment"],
            "route": f"k8s://{pod['node']}/{pod['name'][:24]}",
            "anomaly_score": round(random.uniform(0.7, 0.97), 4),
            "is_anomaly": True,
            "duration_ms": 0.0,
            "trace_id": f"k8s-{uuid.uuid4().hex[:12]}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "spans": [],
            "reasons": [reason],
            "ml_scores": {},
            "rule_flags": flags,
            "anomaly_type": anomaly_type,
        }

    def snapshot(self) -> Dict:
        nodes = []
        for n in K8S_NODES:
            node_pods = [p for p in self.pods.values() if p["node"] == n["name"]]
            cpu_used = sum(p["cpu_m"] for p in node_pods) + 350  # system overhead
            mem_used = sum(p["mem_mi"] for p in node_pods) + 1200
            mem_pct = mem_used / n["mem_capacity_mi"] * 100
            nodes.append({
                "name": n["name"], "zone": n["zone"],
                "cpu_capacity_m": n["cpu_capacity_m"], "mem_capacity_mi": n["mem_capacity_mi"],
                "cpu_used_m": round(cpu_used), "mem_used_mi": round(mem_used),
                "cpu_pct": round(min(100, cpu_used / n["cpu_capacity_m"] * 100), 1),
                "mem_pct": round(min(100, mem_pct), 1),
                "pods": len(node_pods),
                "conditions": ["Ready"] + (["MemoryPressure"] if mem_pct > 85 else []),
            })
        pods = sorted(self.pods.values(), key=lambda p: (p["deployment"], p["name"]))
        running = sum(1 for p in pods if p["status"] == "Running")
        return {
            "nodes": nodes,
            "pods": [{k: (round(v, 1) if isinstance(v, float) else v) for k, v in p.items() if k != "bad_until"} for p in pods],
            "events": self.events[:40],
            "summary": {
                "nodes_ready": len(nodes),
                "nodes_total": len(nodes),
                "pods_running": running,
                "pods_total": len(pods),
                "cluster_cpu_pct": round(sum(n["cpu_used_m"] for n in nodes) / sum(n["cpu_capacity_m"] for n in nodes) * 100, 1),
                "cluster_mem_pct": round(sum(n["mem_used_mi"] for n in nodes) / sum(n["mem_capacity_mi"] for n in nodes) * 100, 1),
                "total_restarts": sum(p["restarts"] for p in pods),
            },
        }


k8s_cluster = K8sCluster()


def _gen_ml_scores(anomaly_type: str, base_score: float) -> Dict[str, float]:
    """Generate realistic per-model ML scores."""
    scores = {}
    for model in ML_MODELS:
        if anomaly_type == "Statistical Outlier (Isolation Forest)" and model == "isolation_forest":
            scores[model] = round(random.uniform(0.82, 0.98), 4)
        elif "ML Ensemble" in anomaly_type:
            scores[model] = round(random.uniform(0.3, 0.9), 4)
        else:
            # Rule-based anomalies have moderate ML scores
            scores[model] = round(random.uniform(0.1, 0.6), 4)
    return scores


def _gen_spans(service: str, route: str, duration_ms: float, span_count: int, trace_id: str) -> List[Dict]:
    """Generate a realistic span waterfall for a trace."""
    spans = []
    base_time = datetime.now(timezone.utc)
    root_span_id = uuid.uuid4().hex[:16]

    # Root span (api-gateway)
    spans.append({
        "name": route,
        "service": "api-gateway",
        "duration_ms": round(duration_ms, 2),
        "start_time": base_time.isoformat(),
        "trace_id": trace_id,
        "span_id": root_span_id,
        "parent_span_id": "",
        "status_code": 0,
        "is_anomaly": duration_ms > 500,
    })

    remaining = span_count - 1
    parent_id = root_span_id
    offset_ms = random.uniform(1, 10)

    for i in range(remaining):
        span_id = uuid.uuid4().hex[:16]
        svc = random.choice(SERVICES)
        span_dur = round(random.uniform(5, duration_ms * 0.6), 2)
        span_start = base_time + timedelta(milliseconds=offset_ms)

        span_names = ["db.query", "cache.lookup", "http.request", "serialize", "auth.verify",
                      "middleware.process", "template.render", "queue.publish", "rpc.call", "validate"]

        spans.append({
            "name": random.choice(span_names),
            "service": svc,
            "duration_ms": span_dur,
            "start_time": span_start.isoformat(),
            "trace_id": trace_id,
            "span_id": span_id,
            "parent_span_id": parent_id if random.random() > 0.15 else uuid.uuid4().hex[:16],
            "status_code": random.choice([0, 0, 0, 0, 1, 2]) if random.random() < 0.15 else 0,
            "is_anomaly": span_dur > 500,
        })

        if random.random() > 0.5:
            parent_id = span_id
        offset_ms += span_dur * random.uniform(0.1, 0.5)

    return spans


async def _simulator_loop():
    """Background task that continuously generates telemetry data."""
    logger.info("🚀 Data simulator started — generating live telemetry")
    # Small startup delay to ensure init_db completes before first writes
    await asyncio.sleep(0.5)
    tick = 0
    redaction_counters = {svc: 0 for svc in SERVICES}
    # Payment failure-storm state: occasionally a gateway degrades and the
    # failure rate spikes for a window, mirroring real PSP incidents.
    storm_until = 0
    storm_gateway = None
    storm_rate = 0.05

    while True:
        try:
            now = datetime.now(timezone.utc).isoformat()
            tick += 1

            # ── 1. Metrics: P99 latency + throughput per service ──────
            for svc in SERVICES:
                # Base latency with sinusoidal pattern + noise
                base_latency = 80 + 40 * math.sin(tick * 0.15) + random.gauss(0, 15)
                # Occasional spikes
                if random.random() < 0.08:
                    base_latency += random.uniform(200, 800)
                base_latency = max(10, base_latency)

                metric_p99 = {"service": svc, "metric_type": "p99_latency",
                              "value": round(base_latency, 2), "timestamp": now}
                await storage.save_metric(metric_p99)
                await broadcast({"type": "metric_update", "data": metric_p99})

                # Throughput: 25000 to 39000 requests per second (capped at ~80k total)
                throughput = round(random.uniform(25000, 39000) + 1000 * math.sin(tick * 0.1), 1)
                metric_tp = {"service": svc, "metric_type": "throughput",
                             "value": max(1, throughput), "timestamp": now}
                await storage.save_metric(metric_tp)
                await broadcast({"type": "metric_update", "data": metric_tp})

                # Redaction count (slow growth + occasional jumps) — only the
                # two PII-heavy services emit this metric.
                if svc in ("api-gateway", "payment-service"):
                    if random.random() < 0.3:
                        redaction_counters[svc] += random.randint(1, 5)
                    metric_redact = {"service": svc, "metric_type": "redaction_count",
                                     "value": float(redaction_counters[svc]), "timestamp": now}
                    await storage.save_metric(metric_redact)
                    await broadcast({"type": "metric_update", "data": metric_redact})

            # ── 2. Trace Volume & Anomaly Rate Simulation ─────────────
            # Since throughput is massive (e.g. 40k/sec), a 3-second tick represents ~120k traces.
            # We want an anomaly rate of 15% - 25%. We update the stats counters heavily without
            # generating 30k individual websocket events per tick.
            for svc in SERVICES:
                tick_traces = int((random.uniform(35000, 50000) * 3) / len(SERVICES))
                tick_anomalies = int(tick_traces * random.uniform(0.15, 0.25))
                await storage.increment_trace_counter(svc, False, count=tick_traces, anomalous_count=tick_anomalies)

            # ── 3. Anomaly alert (probabilistic) ──────────────────────
            if random.random() < 0.20:  # ~20% chance each tick → ~1 every 15s
                cfg = random.choice(ANOMALY_CONFIGS)
                svc = random.choice(SERVICES)
                route = random.choice(ROUTES[svc])
                trace_id = uuid.uuid4().hex
                score = round(random.uniform(*cfg["score_range"]), 4)
                dur = round(random.uniform(*cfg["duration_range"]), 2)
                span_count = random.randint(*cfg["span_count_range"])
                spans = _gen_spans(svc, route, dur, span_count, trace_id)
                ml_scores = _gen_ml_scores(cfg["type"], score)
                rule_flags = cfg["rule_flags"](span_count)

                # Save trace inventory
                await storage.save_trace({
                    "trace_id": trace_id,
                    "duration_ms": dur,
                    "spans": spans,
                })

                # Generate and save correlated logs
                log_count = random.randint(3, 8)
                for li in range(log_count):
                    log_time = (datetime.now(timezone.utc) + timedelta(milliseconds=li * 50)).isoformat()
                    log_svc = random.choice(SERVICES)
                    body_template = random.choice(LOG_BODIES[log_svc])
                    body = body_template.format(
                        dur=random.randint(10, 500), n=random.randint(1, 100),
                        idle=random.randint(1, 20), ip=f"10.0.{random.randint(0,255)}.{random.randint(1,254)}",
                        id=random.randint(1, 9999), tid=trace_id[:12]
                    )
                    log_event = {
                        "trace_id": trace_id,
                        "span_id": random.choice(spans)["span_id"] if spans else "",
                        "service_name": log_svc,
                        "body": body,
                        "severity": random.choice(SEVERITIES),
                        "timestamp": log_time,
                    }
                    await storage.save_log(log_event)

                # Increment anomaly counter
                await storage.increment_trace_counter(svc, True)

                # Build and emit alert
                alert = {
                    "service": svc,
                    "route": route,
                    "anomaly_score": score,
                    "is_anomaly": True,
                    "duration_ms": dur,
                    "trace_id": trace_id,
                    "timestamp": now,
                    "spans": spans[:20],
                    "reasons": cfg["reasons"],
                    "ml_scores": ml_scores,
                    "rule_flags": rule_flags,
                    "anomaly_type": cfg["type"],
                }
                await storage.save_alert(alert)
                await broadcast({"type": "new_anomaly", "data": alert})
                logger.info(f"📊 Simulated {cfg['type']} anomaly on {svc}{route} (score={score:.2f})")

            # ── 4. PII Redaction Density alert (rare) ─────────────────
            if random.random() < 0.03:
                svc = random.choice(SERVICES)
                ratio = round(random.uniform(0.82, 0.97), 2)
                pii_alert = {
                    "service": svc,
                    "route": "security.pii_density",
                    "anomaly_score": ratio,
                    "is_anomaly": True,
                    "duration_ms": 0.0,
                    "trace_id": f"pii-{svc}-{uuid.uuid4().hex[:8]}",
                    "timestamp": now,
                    "spans": [],
                    "reasons": ["pii_redaction_density"],
                    "ml_scores": {},
                    "rule_flags": {
                        "n_plus_1": False, "n_plus_1_count": 0,
                        "bimodal_latency": False, "latency_variance": 0.0,
                        "dependency_break": False, "dangling_span": None,
                        "pii_density": True, "redaction_ratio": ratio,
                    },
                    "anomaly_type": "PII Redaction Density",
                }
                await storage.save_alert(pii_alert)
                await broadcast({"type": "new_anomaly", "data": pii_alert})
                logger.info(f"🔒 Simulated PII density alert for {svc} (ratio={ratio})")

            # ── 5. Universal transaction stream ───────────────────────
            # Simulate transactions only while no real payments are flowing
            # (AUTO_REAL_ONLY silences the simulator once you go live).
            sim_txn = TXN_SIMULATOR_ENABLED and not (AUTO_REAL_ONLY and REAL_PAYMENTS_SEEN["active"])
            # Failure storm lifecycle
            if sim_txn and tick > storm_until and random.random() < 0.012:
                storm_until = tick + random.randint(15, 35)
                storm_gateway = random.choice(TXN_GATEWAYS)
                storm_rate = round(random.uniform(0.30, 0.55), 2)
                flags = dict(BASE_RULE_FLAGS)
                flags.update({"payment_failure": True, "failure_rate": storm_rate, "gateway": storm_gateway})
                spike_alert = {
                    "service": "payment-service", "route": f"payments.gateway/{storm_gateway}",
                    "anomaly_score": storm_rate + 0.4, "is_anomaly": True, "duration_ms": 0.0,
                    "trace_id": f"pay-{uuid.uuid4().hex[:12]}", "timestamp": now, "spans": [],
                    "reasons": ["payment_failure_spike"], "ml_scores": {},
                    "rule_flags": flags, "anomaly_type": "Payment Failure Spike",
                }
                await storage.save_alert(spike_alert)
                await storage.increment_trace_counter("payment-service", True)
                await broadcast({"type": "new_anomaly", "data": spike_alert})
                logger.info(f"💳 Payment failure storm started on {storm_gateway} (rate={storm_rate})")

            in_storm = tick <= storm_until
            failure_rate = storm_rate if in_storm else 0.05

            tick_txns = random.randint(2, 5) if sim_txn else 0
            for _ in range(tick_txns):
                txn = _gen_transaction(now, failure_rate, storm_gateway if in_storm else None)
                txn["source"] = "sim"
                await storage.save_transaction(txn)
                await broadcast({"type": "new_transaction", "data": txn})

            # Lightweight live stats every tick for KPI cards
            txn_stats = await storage.get_txn_counters()
            txn_stats["tps"] = tick_txns
            txn_stats["timestamp"] = now
            await broadcast({"type": "txn_stats", "data": txn_stats})

            # Occasional payment-specific anomalies
            pay_roll = random.random() if sim_txn else 1.0
            if pay_roll < 0.02:  # Gateway timeout
                gw = storm_gateway if in_storm else random.choice(TXN_GATEWAYS)
                flags = dict(BASE_RULE_FLAGS)
                flags.update({"gateway_timeout": True, "gateway": gw})
                gw_alert = {
                    "service": "payment-service", "route": f"payments.gateway/{gw}",
                    "anomaly_score": round(random.uniform(0.70, 0.92), 4), "is_anomaly": True,
                    "duration_ms": round(random.uniform(8000, 30000), 1),
                    "trace_id": f"pay-{uuid.uuid4().hex[:12]}", "timestamp": now, "spans": [],
                    "reasons": ["gateway_timeout"], "ml_scores": {},
                    "rule_flags": flags, "anomaly_type": "Gateway Timeout",
                }
                await storage.save_alert(gw_alert)
                await storage.increment_trace_counter("payment-service", True)
                await broadcast({"type": "new_anomaly", "data": gw_alert})
            elif pay_roll < 0.035:  # Fraud velocity
                flags = dict(BASE_RULE_FLAGS)
                flags.update({"fraud_velocity": True, "txn_per_min": random.randint(25, 90),
                              "account": f"user_{random.randint(1, 99999):05d}***"})
                fraud_alert = {
                    "service": "fraud-service", "route": "payments.fraud/velocity",
                    "anomaly_score": round(random.uniform(0.80, 0.98), 4), "is_anomaly": True,
                    "duration_ms": 0.0, "trace_id": f"fraud-{uuid.uuid4().hex[:12]}",
                    "timestamp": now, "spans": [], "reasons": ["fraud_velocity"], "ml_scores": {},
                    "rule_flags": flags, "anomaly_type": "Fraud Velocity",
                }
                await storage.save_alert(fraud_alert)
                await storage.increment_trace_counter("fraud-service", True)
                await broadcast({"type": "new_anomaly", "data": fraud_alert})
            elif pay_roll < 0.045:  # Duplicate charge
                flags = dict(BASE_RULE_FLAGS)
                flags.update({"duplicate_charge": True, "dup_txn_id": f"TXN{uuid.uuid4().hex[:12].upper()}"})
                dup_alert = {
                    "service": "payment-service", "route": "payments.idempotency/violation",
                    "anomaly_score": round(random.uniform(0.75, 0.95), 4), "is_anomaly": True,
                    "duration_ms": 0.0, "trace_id": f"pay-{uuid.uuid4().hex[:12]}",
                    "timestamp": now, "spans": [], "reasons": ["duplicate_charge"], "ml_scores": {},
                    "rule_flags": flags, "anomaly_type": "Duplicate Charge",
                }
                await storage.save_alert(dup_alert)
                await storage.increment_trace_counter("payment-service", True)
                await broadcast({"type": "new_anomaly", "data": dup_alert})

            # ── 6. Kubernetes cluster tick ─────────────────────────────
            for k8s_alert in k8s_cluster.step():
                await storage.save_alert(k8s_alert)
                await storage.increment_trace_counter(k8s_alert["service"], True)
                await broadcast({"type": "new_anomaly", "data": k8s_alert})
                logger.info(f"☸️ K8s anomaly: {k8s_alert['anomaly_type']} on {k8s_alert['rule_flags'].get('k8s_pod')}")
            if tick % 2 == 0:
                await broadcast({"type": "k8s_update", "data": k8s_cluster.snapshot()})

        except Exception as e:
            import sqlite3 as _sqlite3
            if isinstance(e, _sqlite3.OperationalError) or "no such table" in str(e):
                logger.warning("DB tables missing — re-initializing database...")
                storage._db_ready = False
                try:
                    await storage.init_db()
                except Exception as reinit_err:
                    logger.error(f"DB re-init failed: {reinit_err}")
            else:
                logger.error(f"Simulator error: {e}")

        await asyncio.sleep(1)  # Emit data every 1 seconds for smooth graphs


@asynccontextmanager
async def lifespan(app):
    await storage.init_db()
    task = asyncio.create_task(_simulator_loop()) if SIMULATOR_ENABLED else None
    if not SIMULATOR_ENABLED:
        logger.info("Simulator disabled (SIMULATOR=off) — serving real ingested data only")
    yield
    if task:
        task.cancel()

app = FastAPI(title="MonoXAI Analytical API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- STORAGE LAYER (DAO PATTERN) ---

class TelemetryStorage(ABC):
    @abstractmethod
    async def save_alert(self, alert: Dict): pass
    @abstractmethod
    async def get_alerts(self, service: Optional[str] = None, limit: int = 50): pass
    @abstractmethod
    async def save_metric(self, metric: Dict): pass
    @abstractmethod
    async def get_metrics(self, service: str, metric_type: str, limit: int = 60): pass
    @abstractmethod
    async def save_log(self, log: Dict): pass
    @abstractmethod
    async def get_logs(self, service: Optional[str] = None, severity: Optional[str] = None,
                       trace_id: Optional[str] = None, limit: int = 100): pass

class SQLiteStorage(TelemetryStorage):
    def __init__(self, db_path=None):
        if db_path is None:
            # Always resolve relative to this file so it works regardless of cwd
            import pathlib
            db_path = str(pathlib.Path(__file__).parent / "telemetry.db")
        self.db_path = db_path
        self._db_ready = False

    async def init_db(self):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT,
                    route TEXT,
                    anomaly_score REAL,
                    is_anomaly BOOLEAN,
                    duration_ms REAL,
                    trace_id TEXT,
                    timestamp TEXT,
                    spans_json TEXT,
                    reasons_json TEXT,
                    ml_scores_json TEXT,
                    rule_flags_json TEXT,
                    anomaly_type TEXT
                )
            """)
            # Idempotent migrations for pre-existing DBs.
            for col_sql in (
                "ALTER TABLE alerts ADD COLUMN reasons_json TEXT",
                "ALTER TABLE alerts ADD COLUMN ml_scores_json TEXT",
                "ALTER TABLE alerts ADD COLUMN rule_flags_json TEXT",
                "ALTER TABLE alerts ADD COLUMN anomaly_type TEXT",
            ):
                try:
                    await db.execute(col_sql)
                except Exception:
                    pass
            await db.execute("""
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT,
                    metric_type TEXT,
                    value REAL,
                    timestamp TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS trace_inventory (
                    trace_id TEXT PRIMARY KEY,
                    duration_ms REAL,
                    spans_json TEXT,
                    timestamp TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trace_id TEXT,
                    span_id TEXT,
                    service_name TEXT,
                    body TEXT,
                    severity TEXT,
                    timestamp TEXT
                )
            """)
            await db.execute("CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service_name)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(trace_id)")
            await db.execute("""
                CREATE TABLE IF NOT EXISTS trace_counters (
                    service TEXT PRIMARY KEY,
                    total INTEGER NOT NULL DEFAULT 0,
                    anomalous INTEGER NOT NULL DEFAULT 0
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    txn_id TEXT,
                    order_id TEXT,
                    txn_type TEXT,
                    method TEXT,
                    provider TEXT,
                    gateway TEXT,
                    amount REAL,
                    currency TEXT,
                    status TEXT,
                    latency_ms REAL,
                    failure_reason TEXT,
                    user TEXT,
                    timestamp TEXT,
                    source TEXT DEFAULT 'sim'
                )
            """)
            try:
                await db.execute("ALTER TABLE transactions ADD COLUMN source TEXT DEFAULT 'sim'")
            except Exception:
                pass
            await db.execute("CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_txn_method ON transactions(method)")
            await db.execute("""
                CREATE TABLE IF NOT EXISTS txn_counters (
                    key TEXT PRIMARY KEY,
                    total INTEGER NOT NULL DEFAULT 0,
                    success INTEGER NOT NULL DEFAULT 0,
                    failed INTEGER NOT NULL DEFAULT 0,
                    pending INTEGER NOT NULL DEFAULT 0,
                    volume REAL NOT NULL DEFAULT 0
                )
            """)
            await db.execute("CREATE INDEX IF NOT EXISTS idx_logs_severity ON logs(severity)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_service ON alerts(service)")
            await db.commit()
        self._db_ready = True
        logger.info("✅ Database initialized successfully.")

    async def _ensure_db(self):
        """Re-initialize DB if tables are missing (e.g. after stop.sh cleared the file)."""
        if not self._db_ready:
            await self.init_db()

    async def save_alert(self, alert: Dict):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            spans_json = json.dumps(alert.get("spans", []))
            reasons_json = json.dumps(alert.get("reasons") or [])
            ml_scores_json = json.dumps(alert.get("ml_scores") or {})
            rule_flags_json = json.dumps(alert.get("rule_flags") or {})
            anomaly_type = alert.get("anomaly_type")
            await db.execute(
                "INSERT INTO alerts (service, route, anomaly_score, is_anomaly, duration_ms, trace_id, timestamp, spans_json, reasons_json, ml_scores_json, rule_flags_json, anomaly_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (alert["service"], alert["route"], alert["anomaly_score"], alert["is_anomaly"],
                 alert["duration_ms"], alert["trace_id"], alert["timestamp"], spans_json,
                 reasons_json, ml_scores_json, rule_flags_json, anomaly_type)
            )
            # Retention: keep only the most recent 500 alerts
            await db.execute("DELETE FROM alerts WHERE id < (SELECT MAX(id) - 500 FROM alerts)")
            await db.commit()

    async def get_alerts(self, service: Optional[str] = None, limit: int = 50):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            if service and service != "All Services":
                cursor = await db.execute("SELECT * FROM alerts WHERE service = ? ORDER BY id DESC LIMIT ?", (service, limit))
            else:
                cursor = await db.execute("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,))
            rows = await cursor.fetchall()
            results = []
            for row in rows:
                d = dict(row)
                d["spans"] = json.loads(d["spans_json"]) if d.get("spans_json") else []
                d["reasons"] = json.loads(d["reasons_json"]) if d.get("reasons_json") else []
                d["ml_scores"] = json.loads(d["ml_scores_json"]) if d.get("ml_scores_json") else {}
                d["rule_flags"] = json.loads(d["rule_flags_json"]) if d.get("rule_flags_json") else {}
                results.append(d)
            return results

    async def save_metric(self, metric: Dict):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO metrics (service, metric_type, value, timestamp) VALUES (?, ?, ?, ?)",
                (metric["service"], metric["metric_type"], metric["value"], metric["timestamp"])
            )
            # Retention: keep only the most recent 10k metric points so the
            # DB stays bounded when the simulator runs for days.
            await db.execute("DELETE FROM metrics WHERE id < (SELECT MAX(id) - 10000 FROM metrics)")
            await db.commit()

    async def get_metrics(self, service: str, metric_type: str, limit: int = 60):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            if service == "All Services":
                cursor = await db.execute(
                    "SELECT * FROM metrics WHERE metric_type = ? ORDER BY id DESC LIMIT ?",
                    (metric_type, limit)
                )
            else:
                cursor = await db.execute(
                    "SELECT * FROM metrics WHERE service = ? AND metric_type = ? ORDER BY id DESC LIMIT ?",
                    (service, metric_type, limit)
                )
            rows = await cursor.fetchall()
            return [dict(row) for row in reversed(rows)]

    async def save_trace(self, trace: Dict):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR REPLACE INTO trace_inventory (trace_id, duration_ms, spans_json, timestamp) VALUES (?, ?, ?, ?)",
                (trace["trace_id"], trace["duration_ms"], json.dumps(trace["spans"]), datetime.now(timezone.utc).isoformat())
            )
            # Retention: keep only the most recent 500 traces
            await db.execute("""
                DELETE FROM trace_inventory WHERE trace_id NOT IN (
                    SELECT trace_id FROM trace_inventory ORDER BY timestamp DESC LIMIT 500
                )
            """)
            await db.commit()

    async def get_trace(self, trace_id: str):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM trace_inventory WHERE trace_id = ?", (trace_id,))
            row = await cursor.fetchone()
            if row:
                d = dict(row)
                d["spans"] = json.loads(d["spans_json"])
                return d
            return None

    async def get_stats(self, service: Optional[str] = None):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            if service and service != "All Services":
                row = await (await db.execute(
                    "SELECT COALESCE(SUM(total),0), COALESCE(SUM(anomalous),0) FROM trace_counters WHERE service=?",
                    (service,)
                )).fetchone()
            else:
                row = await (await db.execute(
                    "SELECT COALESCE(SUM(total),0), COALESCE(SUM(anomalous),0) FROM trace_counters"
                )).fetchone()
            total_traces = row[0] if row else 0
            anomaly_count = row[1] if row else 0
            return {"total_traces": total_traces, "anomaly_count": anomaly_count}

    async def increment_trace_counter(self, service: str, is_anomaly: bool, count: int = 1, anomalous_count: int = -1):
        await self._ensure_db()
        if anomalous_count == -1:
            anomalous_count = count if is_anomaly else 0
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO trace_counters (service, total, anomalous) VALUES (?, ?, ?) "
                "ON CONFLICT(service) DO UPDATE SET total = total + excluded.total, anomalous = anomalous + excluded.anomalous",
                (service, count, anomalous_count),
            )
            await db.commit()

    async def save_transaction(self, txn: Dict):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO transactions (txn_id, order_id, txn_type, method, provider, gateway, amount, currency, status, latency_ms, failure_reason, user, timestamp, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (txn["txn_id"], txn["order_id"], txn["txn_type"], txn["method"], txn["provider"],
                 txn["gateway"], txn["amount"], txn["currency"], txn["status"], txn["latency_ms"],
                 txn.get("failure_reason"), txn["user"], txn["timestamp"], txn.get("source", "sim"))
            )
            # Cumulative counters (survive row retention below)
            await db.execute(
                "INSERT INTO txn_counters (key, total, success, failed, pending, volume) VALUES ('global', 1, ?, ?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET total = total + 1, success = success + excluded.success, "
                "failed = failed + excluded.failed, pending = pending + excluded.pending, volume = volume + excluded.volume",
                (1 if txn["status"] == "SUCCESS" else 0,
                 1 if txn["status"] == "FAILED" else 0,
                 1 if txn["status"] == "PENDING" else 0,
                 txn["amount"] if txn["status"] == "SUCCESS" and txn["currency"] == "INR" else 0.0)
            )
            # Retention: keep only the most recent 1000 transactions
            await db.execute("DELETE FROM transactions WHERE id < (SELECT MAX(id) - 1000 FROM transactions)")
            await db.commit()

    async def get_transactions(self, status: Optional[str] = None, method: Optional[str] = None,
                               txn_type: Optional[str] = None, limit: int = 50):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            query = "SELECT * FROM transactions WHERE 1=1"
            params = []
            if status and status != "All":
                query += " AND status = ?"
                params.append(status)
            if method and method != "All":
                query += " AND method = ?"
                params.append(method)
            if txn_type and txn_type != "All":
                query += " AND txn_type = ?"
                params.append(txn_type)
            query += " ORDER BY id DESC LIMIT ?"
            params.append(limit)
            rows = await (await db.execute(query, params)).fetchall()
            return [dict(r) for r in rows]

    async def get_transaction_by_id(self, txn_id: str):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            # match txn_id or order_id (case-insensitive)
            row = await (await db.execute(
                "SELECT * FROM transactions WHERE txn_id = ? COLLATE NOCASE OR order_id = ? COLLATE NOCASE "
                "ORDER BY id DESC LIMIT 1", (txn_id, txn_id))).fetchone()
            return dict(row) if row else None

    async def get_alerts_for_txn(self, txn_id: str, order_id: str = None):
        """Anomalies whose stored rule_flags reference this payment."""
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            like = f'%"{txn_id}"%'
            rows = await (await db.execute(
                "SELECT * FROM alerts WHERE rule_flags_json LIKE ? "
                "OR trace_id = ? ORDER BY id DESC LIMIT 20", (like, txn_id))).fetchall()
            results = []
            for row in rows:
                d = dict(row)
                d["spans"] = json.loads(d["spans_json"]) if d.get("spans_json") else []
                d["reasons"] = json.loads(d["reasons_json"]) if d.get("reasons_json") else []
                d["ml_scores"] = json.loads(d["ml_scores_json"]) if d.get("ml_scores_json") else {}
                d["rule_flags"] = json.loads(d["rule_flags_json"]) if d.get("rule_flags_json") else {}
                results.append(d)
            return results

    async def get_txn_counters(self):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            row = await (await db.execute(
                "SELECT total, success, failed, pending, volume FROM txn_counters WHERE key = 'global'"
            )).fetchone()
            total, success, failed, pending, volume = row if row else (0, 0, 0, 0, 0.0)
            return {
                "total": total, "success": success, "failed": failed, "pending": pending,
                "volume_inr": round(volume, 2),
                "success_rate": round(success / total * 100, 2) if total else 0.0,
            }

    async def get_gateway_activity(self):
        """Per-gateway live activity for the integrations dashboard."""
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            rows = await (await db.execute(
                "SELECT gateway, COUNT(*) AS count, "
                "SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS success, "
                "SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed, "
                "SUM(CASE WHEN status='SUCCESS' AND currency='INR' THEN amount ELSE 0 END) AS volume, "
                "MAX(timestamp) AS last_event, "
                "SUM(CASE WHEN source='live' THEN 1 ELSE 0 END) AS live_count "
                "FROM transactions GROUP BY gateway"
            )).fetchall()
            return {r["gateway"]: dict(r) for r in rows}

    async def get_txn_stats(self):
        """Cumulative counters + breakdowns over the retained window."""
        await self._ensure_db()
        stats = await self.get_txn_counters()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            method_rows = await (await db.execute(
                "SELECT method, COUNT(*) AS count, "
                "SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success, "
                "SUM(CASE WHEN status = 'SUCCESS' AND currency = 'INR' THEN amount ELSE 0 END) AS volume "
                "FROM transactions GROUP BY method ORDER BY count DESC"
            )).fetchall()
            type_rows = await (await db.execute(
                "SELECT txn_type, COUNT(*) AS count FROM transactions GROUP BY txn_type ORDER BY count DESC"
            )).fetchall()
            failure_rows = await (await db.execute(
                "SELECT failure_reason, COUNT(*) AS count FROM transactions "
                "WHERE status = 'FAILED' AND failure_reason IS NOT NULL "
                "GROUP BY failure_reason ORDER BY count DESC LIMIT 6"
            )).fetchall()
            gateway_rows = await (await db.execute(
                "SELECT gateway, COUNT(*) AS count, "
                "SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed, "
                "SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success, "
                "SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending, "
                "SUM(CASE WHEN status = 'SUCCESS' AND currency = 'INR' THEN amount ELSE 0 END) AS volume "
                "FROM transactions GROUP BY gateway ORDER BY count DESC"
            )).fetchall()
            avg_row = await (await db.execute(
                "SELECT AVG(latency_ms) FROM transactions WHERE status = 'SUCCESS'"
            )).fetchone()
        stats.update({
            "method_breakdown": [dict(r) for r in method_rows],
            "type_breakdown": [dict(r) for r in type_rows],
            "top_failure_reasons": [dict(r) for r in failure_rows],
            "gateway_breakdown": [dict(r) for r in gateway_rows],
            "avg_latency_ms": round(avg_row[0], 1) if avg_row and avg_row[0] else 0.0,
        })
        return stats

    async def save_log(self, log: Dict):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO logs (trace_id, span_id, service_name, body, severity, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                (log.get("trace_id", ""), log.get("span_id", ""), log["service_name"],
                 log["body"], log.get("severity", "INFO"), log["timestamp"])
            )
            # Enforce retention: keep only the last 1000 logs (efficient threshold check)
            await db.execute("""
                DELETE FROM logs WHERE id < (SELECT MAX(id) - 1000 FROM logs)
            """)
            await db.commit()

    async def get_logs(self, service: Optional[str] = None, severity: Optional[str] = None,
                       trace_id: Optional[str] = None, limit: int = 100):
        await self._ensure_db()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            query = "SELECT * FROM logs WHERE 1=1"
            params = []

            if service and service != "All Services":
                query += " AND service_name = ?"
                params.append(service)
            if severity and severity != "All":
                query += " AND severity = ?"
                params.append(severity)
            if trace_id:
                query += " AND trace_id = ?"
                params.append(trace_id)

            query += " ORDER BY id DESC LIMIT ?"
            params.append(limit)

            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

storage = SQLiteStorage()

# --- GEMINI AI ---

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY and genai:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-2.5-flash')
else:
    logger.warning("GEMINI_API_KEY not set. AI RCA will be unavailable.")
    model = None

# --- MODELS ---

class SpanInfo(BaseModel):
    name: str
    service: str
    duration_ms: float
    start_time: str
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    parent_span_id: Optional[str] = None
    status_code: Optional[int] = None
    is_anomaly: Optional[bool] = None

class AnomalyEvent(BaseModel):
    # All fields defaulted so RCA requests built from trace-less alerts
    # (payments, K8s, PII) never fail validation with a 422.
    service: str = "unknown"
    route: str = "unknown"
    anomaly_score: float = 0.0
    is_anomaly: bool = True
    duration_ms: float = 0.0
    trace_id: str = ""
    timestamp: str = ""
    spans: Optional[List[SpanInfo]] = None
    reasons: Optional[List[str]] = None
    ml_scores: Optional[Dict[str, float]] = None
    rule_flags: Optional[Dict[str, Any]] = None
    anomaly_type: Optional[str] = None

class TraceInventory(BaseModel):
    trace_id: str
    duration_ms: float
    spans: List[SpanInfo]

class MetricUpdate(BaseModel):
    service: str
    metric_type: str
    value: float
    timestamp: str

class LogEvent(BaseModel):
    trace_id: str = ""
    span_id: str = ""
    service_name: str
    body: str
    severity: str = "INFO"
    timestamp: str

# --- REAL-TIME HUB ---

active_connections: List[WebSocket] = []

async def broadcast(message: dict):
    """Broadcast a message to all connected WebSocket clients, safely removing dead ones."""
    dead = []
    for connection in active_connections:
        try:
            await connection.send_json(message)
        except Exception:
            dead.append(connection)
    for d in dead:
        if d in active_connections:
            active_connections.remove(d)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        # Send history on connect
        history = await storage.get_alerts(limit=20)
        await websocket.send_json({"type": "history", "data": history})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)

@app.post("/api/alerts")
async def receive_alert(event: AnomalyEvent):
    event_dict = event.model_dump()
    await storage.save_alert(event_dict)
    await broadcast({"type": "new_anomaly", "data": event_dict})
    return {"status": "ok"}

@app.post("/api/metrics")
async def receive_metric(metric: MetricUpdate):
    metric_dict = metric.model_dump()
    await storage.save_metric(metric_dict)
    await broadcast({"type": "metric_update", "data": metric_dict})
    return {"status": "ok"}

@app.get("/api/alerts")
async def get_alerts(service: Optional[str] = None):
    return await storage.get_alerts(service=service)

@app.get("/api/stats")
async def get_stats(service: Optional[str] = None):
    return await storage.get_stats(service=service)

@app.post("/api/trace_observed")
async def observe_trace(payload: Dict):
    services = payload.get("services", [])
    is_anomaly = bool(payload.get("is_anomaly", False))
    for svc in services:
        await storage.increment_trace_counter(svc, is_anomaly)
    return {"status": "ok"}

@app.post("/api/traces")
async def receive_trace(trace: TraceInventory):
    await storage.save_trace(trace.model_dump())
    return {"status": "ok"}

@app.get("/api/traces/{trace_id}")
async def get_trace(trace_id: str):
    trace = await storage.get_trace(trace_id)
    if not trace: 
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace

@app.get("/api/metrics/{service}/{metric_type}")
async def get_metrics_ts(service: str, metric_type: str):
    return await storage.get_metrics(service, metric_type)

@app.post("/api/logs")
async def receive_log(event: LogEvent):
    event_dict = event.model_dump()
    await storage.save_log(event_dict)
    return {"status": "ok"}

@app.get("/api/logs")
async def get_logs(service: Optional[str] = None, severity: Optional[str] = None,
                   trace_id: Optional[str] = None, limit: int = 100):
    return await storage.get_logs(service=service, severity=severity,
                                   trace_id=trace_id, limit=limit)

# --- TRANSACTIONS API ---

@app.get("/api/transactions")
async def get_transactions(status: Optional[str] = None, method: Optional[str] = None,
                           txn_type: Optional[str] = None, limit: int = 50):
    return await storage.get_transactions(status=status, method=method,
                                          txn_type=txn_type, limit=min(limit, 200))

@app.get("/api/transactions/stats")
async def get_transaction_stats():
    return await storage.get_txn_stats()

@app.get("/api/transactions/lookup/{txn_id}")
async def lookup_transaction(txn_id: str):
    """Look up a payment by transaction (or order) id and return any anomalies
    detected on it — so a user can check an incident straight from a txn id."""
    txn = await storage.get_transaction_by_id(txn_id)
    order_id = txn.get("order_id") if txn else None
    anomalies = await storage.get_alerts_for_txn(txn_id, order_id)
    # If they searched by order id, also catch anomalies tagged with the txn id
    if txn and txn.get("txn_id") and txn["txn_id"].lower() != txn_id.lower():
        extra = await storage.get_alerts_for_txn(txn["txn_id"])
        seen = {a.get("id") for a in anomalies}
        anomalies += [a for a in extra if a.get("id") not in seen]
    if not txn and not anomalies:
        raise HTTPException(status_code=404, detail="No transaction or anomaly found for that id")
    return {"transaction": txn, "anomalies": anomalies, "found": bool(txn)}

@app.get("/api/config")
async def get_config():
    """Expose runtime mode + which real-payment integrations are wired,
    so the UI can show a REAL/DEMO badge and setup hints."""
    return {
        "real_only": bool(AUTO_REAL_ONLY and REAL_PAYMENTS_SEEN["active"]),
        "real_payments_seen": REAL_PAYMENTS_SEEN["active"],
        "real_payment_count": REAL_PAYMENTS_SEEN["count"],
        "last_gateway": REAL_PAYMENTS_SEEN["last_gateway"],
        "since": REAL_PAYMENTS_SEEN["since"],
        "auto_real_only": AUTO_REAL_ONLY,
        "txn_simulator": TXN_SIMULATOR_ENABLED,
        "simulator": SIMULATOR_ENABLED,
        "integrations": {
            "razorpay": bool(RAZORPAY_WEBHOOK_SECRET),
            "stripe": bool(STRIPE_WEBHOOK_SECRET),
            "generic_ingest": bool(INGEST_API_KEY),
            "any_gateway": bool(RAZORPAY_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET or GATEWAY_WEBHOOK_SECRET
                                or any(os.getenv(f"{k}_WEBHOOK_SECRET") for k in
                                       ("PHONEPE", "PAYTM", "PAYU", "CASHFREE", "JUSPAY", "CCAVENUE", "CUSTOM"))),
        },
    }

# Canonical registry of payment gateways. Every gateway now has its OWN signed
# webhook endpoint. Razorpay/Stripe/PhonePe/Cashfree/PayU have native receivers
# that parse the gateway's real payload + verify its native signature; the rest
# use the universal signed webhook (/api/webhooks/gateway/<name>, HMAC-SHA256).
GATEWAY_REGISTRY = [
    {"name": "Razorpay", "region": "India", "method": "webhook", "path": "/api/webhooks/razorpay", "scheme": "HMAC-SHA256 (X-Razorpay-Signature)", "secret_key": "RAZORPAY"},
    {"name": "Stripe",   "region": "Global", "method": "webhook", "path": "/api/webhooks/stripe",   "scheme": "Stripe-Signature (t=,v1=)",       "secret_key": "STRIPE"},
    {"name": "PhonePe",  "region": "India",  "method": "webhook", "path": "/api/webhooks/phonepe",  "scheme": "X-VERIFY SHA256###saltIndex",     "secret_key": "PHONEPE"},
    {"name": "Cashfree", "region": "India",  "method": "webhook", "path": "/api/webhooks/cashfree", "scheme": "HMAC-SHA256 (x-webhook-signature)","secret_key": "CASHFREE"},
    {"name": "PayU",     "region": "India",  "method": "webhook", "path": "/api/webhooks/payu",     "scheme": "SHA512 reverse hash",             "secret_key": "PAYU"},
    {"name": "Paytm",    "region": "India",  "method": "webhook", "path": "/api/webhooks/gateway/paytm",  "scheme": "HMAC-SHA256 (X-Webhook-Signature)", "secret_key": "PAYTM"},
    {"name": "JusPay",   "region": "India",  "method": "webhook", "path": "/api/webhooks/gateway/juspay", "scheme": "HMAC-SHA256 (X-Webhook-Signature)", "secret_key": "JUSPAY"},
    {"name": "CCAvenue", "region": "India",  "method": "webhook", "path": "/api/webhooks/gateway/ccavenue","scheme": "HMAC-SHA256 (X-Webhook-Signature)", "secret_key": "CCAVENUE"},
    {"name": "Custom",   "region": "Any",    "method": "webhook", "path": "/api/webhooks/gateway/custom",  "scheme": "HMAC-SHA256 (X-Webhook-Signature)", "secret_key": "CUSTOM"},
]


def _gateway_configured(g: Dict) -> bool:
    key = g.get("secret_key", "")
    if key == "RAZORPAY":
        return bool(RAZORPAY_WEBHOOK_SECRET)
    if key == "STRIPE":
        return bool(STRIPE_WEBHOOK_SECRET)
    # native + universal gateways: their own secret, or the shared fallback
    return bool(os.getenv(f"{key}_WEBHOOK_SECRET") or GATEWAY_WEBHOOK_SECRET)


@app.get("/api/integrations")
async def get_integrations():
    """Per-gateway connection status for the API-Network dashboard."""
    activity = await storage.get_gateway_activity()
    now = datetime.now(timezone.utc)
    out = []
    for g in GATEWAY_REGISTRY:
        act = activity.get(g["name"], {})
        count = act.get("count") or 0
        success = act.get("success") or 0
        last = act.get("last_event")
        secs_since = None
        if last:
            try:
                secs_since = (now - datetime.fromisoformat(last)).total_seconds()
            except Exception:
                secs_since = None
        live = bool(act.get("live_count")) and secs_since is not None and secs_since < 300
        out.append({
            "name": g["name"], "region": g["region"], "method": g["method"],
            "path": g["path"], "scheme": g.get("scheme"),
            "configured": _gateway_configured(g), "live": live,
            "txn_count": count, "success": success,
            "success_rate": round(success / count * 100, 1) if count else 0.0,
            "volume_inr": round(act.get("volume") or 0.0, 2),
            "last_event": last, "secs_since_event": round(secs_since) if secs_since is not None else None,
        })
    return {
        "base_url": os.getenv("PUBLIC_BASE_URL", ""),  # UI falls back to window.origin
        "ingest_enabled": bool(INGEST_API_KEY),
        "gateways": out,
    }


# --- REAL PAYMENT INGESTION (gateway webhooks + generic API) ---
# These endpoints turn the dashboard into a live monitor for REAL
# transactions: point Razorpay/Stripe webhooks at them, or push
# normalized events from any system via /api/ingest/transaction.

def _rt_should_fire(key: str, now_epoch: float) -> bool:
    """Cooldown so the same alert target doesn't spam the stream."""
    last = RT_FIRED.get(key, 0)
    if now_epoch - last >= RT_TUNING["refire_cooldown_s"]:
        RT_FIRED[key] = now_epoch
        return True
    return False


def _rt_alert(anomaly_type: str, service: str, route: str, score: float, reason: str,
              flags_extra: Dict, duration_ms: float = 0.0) -> Dict:
    flags = dict(BASE_RULE_FLAGS)
    flags.update(flags_extra)
    return {
        "service": service, "route": route,
        "anomaly_score": round(score, 4), "is_anomaly": True, "duration_ms": duration_ms,
        "trace_id": f"rt-{uuid.uuid4().hex[:12]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "spans": [], "reasons": [reason], "ml_scores": {},
        "rule_flags": flags, "anomaly_type": anomaly_type,
    }


def _detect_realtime_anomalies(txn: Dict) -> List[Dict]:
    """Run rolling detectors on a REAL incoming transaction. Returns alerts."""
    import time as _time
    now = _time.time()
    gw = txn.get("gateway") or "unknown"
    user = txn.get("user") or "unknown"
    amount = float(txn.get("amount") or 0)
    status = txn.get("status")
    latency = float(txn.get("latency_ms") or 0)
    T = RT_TUNING
    alerts = []
    # Every anomaly carries the triggering payment's IDs so users can look it
    # up by transaction id (see GET /api/transactions/{txn_id}).
    ids = {"txn_id": txn.get("txn_id"), "order_id": txn.get("order_id"), "gateway": gw}

    RT_RECENT.append(txn)
    RT_USER_HITS[user].append(now)

    # 1) Gateway failure-rate spike
    gw_recent = [t for t in RT_RECENT if (t.get("gateway") or "unknown") == gw][-T["fail_window"]:]
    if len(gw_recent) >= T["fail_min"]:
        fails = sum(1 for t in gw_recent if t.get("status") == "FAILED")
        rate = fails / len(gw_recent)
        if rate >= T["fail_rate"] and _rt_should_fire(f"failspike:{gw}", now):
            alerts.append(_rt_alert(
                "Payment Failure Spike", "payment-service", f"payments.gateway/{gw}",
                min(0.99, rate + 0.4), "payment_failure_spike",
                {**ids, "payment_failure": True, "failure_rate": round(rate, 2)}))

    # 2) Fraud velocity (rapid txns from one account)
    hits = RT_USER_HITS[user]
    per_min = sum(1 for ts in hits if now - ts <= 60)
    if per_min >= T["velocity_per_min"] and _rt_should_fire(f"velocity:{user}", now):
        alerts.append(_rt_alert(
            "Fraud Velocity", "fraud-service", "payments.fraud/velocity",
            min(0.99, 0.7 + per_min / 100), "fraud_velocity",
            {**ids, "fraud_velocity": True, "txn_per_min": per_min, "account": user}))

    # 3) Duplicate charge (same user + amount within a short window)
    if status != "FAILED" and amount > 0:
        for (u, a, ts, tid) in list(RT_SEEN_CHARGES):
            if u == user and abs(a - amount) < 0.01 and now - ts <= T["dup_window_s"]:
                if _rt_should_fire(f"dup:{user}:{amount}", now):
                    alerts.append(_rt_alert(
                        "Duplicate Charge", "payment-service", "payments.idempotency/violation",
                        0.9, "duplicate_charge", {**ids, "duplicate_charge": True, "dup_txn_id": tid}))
                break
        RT_SEEN_CHARGES.append((user, amount, now, txn.get("txn_id")))

    # 4) Gateway timeout / severe latency
    if latency >= T["latency_ms"] and _rt_should_fire(f"timeout:{gw}", now):
        alerts.append(_rt_alert(
            "Gateway Timeout", "payment-service", f"payments.gateway/{gw}",
            min(0.95, 0.6 + latency / 40000), "gateway_timeout",
            {**ids, "gateway_timeout": True}, duration_ms=latency))

    return alerts


async def _ingest_transaction(txn: Dict):
    """Persist and broadcast a normalized transaction from a real source, then
    run real-time anomaly detection on it."""
    txn.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    txn["source"] = "live"
    # Flip into real-only mode on the first genuine payment.
    first_real = not REAL_PAYMENTS_SEEN["active"]
    REAL_PAYMENTS_SEEN["active"] = True
    REAL_PAYMENTS_SEEN["count"] += 1
    REAL_PAYMENTS_SEEN["last_gateway"] = txn.get("gateway")
    REAL_PAYMENTS_SEEN["since"] = REAL_PAYMENTS_SEEN["since"] or txn["timestamp"]
    if first_real and AUTO_REAL_ONLY:
        logger.info("🟢 First real payment received — simulator switched to REAL-ONLY mode")
        await broadcast({"type": "mode_change", "data": {"real_only": True, "since": REAL_PAYMENTS_SEEN["since"]}})
    await storage.save_transaction(txn)
    await broadcast({"type": "new_transaction", "data": txn})
    stats = await storage.get_txn_counters()
    stats["tps"] = 1
    stats["timestamp"] = txn["timestamp"]
    await broadcast({"type": "txn_stats", "data": stats})

    # Count this real payment toward total volume (for a real anomaly rate)
    await storage.increment_trace_counter("payment-service", False)

    # ── Real observability metrics, derived from the real payment stream ──
    import time as _t
    now_ep = _t.time()
    now_iso = txn["timestamp"]
    RT_PAY_TIMES.append(now_ep)
    RT_PAY_LAT.append(float(txn.get("latency_ms") or 0))
    throughput = float(sum(1 for ts in RT_PAY_TIMES if now_ep - ts <= 60))  # payments/min
    lat_sorted = sorted(RT_PAY_LAT)
    p99 = lat_sorted[min(len(lat_sorted) - 1, int(0.99 * (len(lat_sorted) - 1)))] if lat_sorted else 0.0
    for mt, val in (("throughput", throughput), ("p99_latency", round(p99, 2))):
        metric = {"service": "payment-service", "metric_type": mt, "value": val, "timestamp": now_iso}
        await storage.save_metric(metric)
        await broadcast({"type": "metric_update", "data": metric})

    # Real-time anomaly detection on genuine data
    for alert in _detect_realtime_anomalies(txn):
        await storage.save_alert(alert)
        # anomalous-only (the payment already counted toward the total above)
        await storage.increment_trace_counter(alert["service"], True, count=0, anomalous_count=1)
        await broadcast({"type": "new_anomaly", "data": alert})
        logger.info(f"🚨 Real-time anomaly: {alert['anomaly_type']} ({alert['reasons'][0]})")


def _mask_user(email: str = "", contact: str = "") -> str:
    if email:
        return email.split("@")[0][:5] + "***"
    if contact:
        return str(contact)[:5] + "***"
    return "customer***"


RAZORPAY_METHOD_MAP = {
    "upi": "UPI", "card": "CREDIT_CARD", "netbanking": "NET_BANKING",
    "wallet": "WALLET", "emi": "BNPL", "bank_transfer": "BANK_TRANSFER",
}
RAZORPAY_STATUS_MAP = {
    "payment.captured": "SUCCESS", "payment.authorized": "PENDING",
    "payment.failed": "FAILED", "refund.processed": "SUCCESS",
    "refund.failed": "FAILED",
}


@app.post("/api/webhooks/razorpay")
async def razorpay_webhook(request: Request):
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="RAZORPAY_WEBHOOK_SECRET not configured")
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event = json.loads(body)
    etype = event.get("event", "")
    status = RAZORPAY_STATUS_MAP.get(etype)
    if status is None:
        return {"status": "ignored", "event": etype}

    payload = event.get("payload", {}) or {}
    payment = (payload.get("payment") or {}).get("entity") or {}
    refund = (payload.get("refund") or {}).get("entity") or {}
    entity = refund if etype.startswith("refund.") else payment
    if not entity:
        return {"status": "ignored", "event": etype}

    method = RAZORPAY_METHOD_MAP.get((payment.get("method") or "").lower(),
                                     "UPI" if payment.get("vpa") else "CREDIT_CARD")
    provider = (payment.get("wallet") or payment.get("bank")
                or (payment.get("vpa", "").split("@")[-1] if payment.get("vpa") else None)
                or ((payment.get("card") or {}).get("network"))
                or "Razorpay")

    # Real latency = time from payment creation to this event (capture/failure).
    ev_created = event.get("created_at")
    pay_created = payment.get("created_at")
    latency = round(max(0.0, (ev_created - pay_created) * 1000.0), 1) if (ev_created and pay_created) else 0.0

    txn = {
        "txn_id": entity.get("id") or f"TXN{uuid.uuid4().hex[:12].upper()}",
        "order_id": entity.get("order_id") or payment.get("order_id") or "—",
        "txn_type": "REFUND" if etype.startswith("refund.") else "PURCHASE",
        "method": method,
        "provider": str(provider),
        "gateway": "Razorpay",
        "amount": round((entity.get("amount") or 0) / 100.0, 2),  # paise → rupees
        "currency": (entity.get("currency") or "INR").upper(),
        "status": status,
        "latency_ms": latency,
        "failure_reason": payment.get("error_code") or payment.get("error_reason"),
        "user": _mask_user(payment.get("email") or "", payment.get("contact") or ""),
    }
    await _ingest_transaction(txn)
    logger.info(f"💳 Razorpay webhook: {etype} → {txn['txn_id']} ({status})")
    return {"status": "ok"}


def _verify_stripe_signature(body: bytes, header: str, secret: str) -> bool:
    """Verify Stripe's t=...,v1=... signature scheme (HMAC-SHA256)."""
    try:
        parts = {}
        for kv in header.split(","):
            k, _, v = kv.strip().partition("=")
            parts.setdefault(k, []).append(v)
        timestamp = parts.get("t", [None])[0]
        if not timestamp:
            return False
        signed_payload = f"{timestamp}.".encode() + body
        expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
        return any(hmac.compare_digest(expected, v1) for v1 in parts.get("v1", []))
    except Exception:
        return False


STRIPE_STATUS_MAP = {
    "payment_intent.succeeded": "SUCCESS",
    "payment_intent.processing": "PENDING",
    "payment_intent.payment_failed": "FAILED",
    "charge.refunded": "SUCCESS",
}


@app.post("/api/webhooks/stripe")
async def stripe_webhook(request: Request):
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET not configured")
    body = await request.body()
    if not _verify_stripe_signature(body, request.headers.get("stripe-signature", ""), STRIPE_WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event = json.loads(body)
    etype = event.get("type", "")
    status = STRIPE_STATUS_MAP.get(etype)
    if status is None:
        return {"status": "ignored", "event": etype}

    obj = (event.get("data") or {}).get("object") or {}
    pm_types = obj.get("payment_method_types") or ["card"]
    method = {"card": "CREDIT_CARD", "upi": "UPI", "netbanking": "NET_BANKING",
              "wallet": "WALLET"}.get(pm_types[0], "CREDIT_CARD")
    err = obj.get("last_payment_error") or {}

    txn = {
        "txn_id": obj.get("id") or f"TXN{uuid.uuid4().hex[:12].upper()}",
        "order_id": obj.get("metadata", {}).get("order_id") or obj.get("invoice") or "—",
        "txn_type": "REFUND" if etype == "charge.refunded" else "PURCHASE",
        "method": method,
        "provider": (err.get("payment_method") or {}).get("card", {}).get("brand") or "Stripe",
        "gateway": "Stripe",
        "amount": round((obj.get("amount") or obj.get("amount_refunded") or 0) / 100.0, 2),
        "currency": (obj.get("currency") or "usd").upper(),
        "status": status,
        "latency_ms": 0.0,
        "failure_reason": err.get("code") or err.get("decline_code"),
        "user": _mask_user((obj.get("receipt_email") or "")),
    }
    await _ingest_transaction(txn)
    logger.info(f"💳 Stripe webhook: {etype} → {txn['txn_id']} ({status})")
    return {"status": "ok"}


# ── PhonePe (X-VERIFY: sha256(base64Payload + saltKey) + "###" + saltIndex) ──
@app.post("/api/webhooks/phonepe")
async def phonepe_webhook(request: Request):
    secret = _gateway_secret("PHONEPE")
    if not secret:
        raise HTTPException(status_code=503, detail="PHONEPE_WEBHOOK_SECRET not configured")
    body = await request.body()
    xverify = request.headers.get("x-verify", "")
    salt_index = xverify.split("###")[-1] if "###" in xverify else "1"
    payload = json.loads(body or b"{}")
    b64 = payload.get("response", "")
    expected = hashlib.sha256((b64 + secret).encode()).hexdigest() + "###" + salt_index
    if not hmac.compare_digest(expected, xverify):
        raise HTTPException(status_code=401, detail="Invalid X-VERIFY signature")
    import base64 as _b64
    data = json.loads(_b64.b64decode(b64)).get("data", {}) if b64 else payload
    state = (data.get("state") or data.get("responseCode") or "").upper()
    status = "SUCCESS" if state in ("COMPLETED", "SUCCESS", "PAYMENT_SUCCESS") else \
             "PENDING" if state in ("PENDING",) else "FAILED"
    txn = {
        "txn_id": data.get("transactionId") or data.get("merchantTransactionId") or f"TXN{uuid.uuid4().hex[:12].upper()}",
        "order_id": data.get("merchantTransactionId") or "—", "txn_type": "PURCHASE",
        "method": "UPI", "provider": "PhonePe", "gateway": "PhonePe",
        "amount": round((data.get("amount") or 0) / 100.0, 2), "currency": "INR",
        "status": status, "latency_ms": 0.0,
        "failure_reason": None if status == "SUCCESS" else state,
        "user": _mask_user("", data.get("mobileNumber") or ""),
    }
    await _ingest_transaction(txn)
    logger.info(f"💳 PhonePe webhook → {txn['txn_id']} ({status})")
    return {"status": "ok"}


# ── Cashfree (x-webhook-signature = base64(HMAC_SHA256(timestamp + rawBody))) ──
@app.post("/api/webhooks/cashfree")
async def cashfree_webhook(request: Request):
    secret = _gateway_secret("CASHFREE")
    if not secret:
        raise HTTPException(status_code=503, detail="CASHFREE_WEBHOOK_SECRET not configured")
    body = await request.body()
    sig = request.headers.get("x-webhook-signature", "")
    ts = request.headers.get("x-webhook-timestamp", "")
    import base64 as _b64
    expected = _b64.b64encode(hmac.new(secret.encode(), (ts + body.decode()).encode(), hashlib.sha256).digest()).decode()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    ev = json.loads(body or b"{}")
    d = ev.get("data", ev)
    pay = d.get("payment", d)
    st = (pay.get("payment_status") or "").upper()
    status = "SUCCESS" if st in ("SUCCESS", "PAID") else "PENDING" if st in ("PENDING",) else "FAILED"
    order = d.get("order", {})
    txn = {
        "txn_id": str(pay.get("cf_payment_id") or f"TXN{uuid.uuid4().hex[:12].upper()}"),
        "order_id": order.get("order_id") or "—", "txn_type": "PURCHASE",
        "method": {"upi": "UPI", "card": "CREDIT_CARD", "netbanking": "NET_BANKING", "app": "WALLET"}.get((pay.get("payment_group") or "").lower(), "UPI"),
        "provider": "Cashfree", "gateway": "Cashfree",
        "amount": round(float(order.get("order_amount") or pay.get("payment_amount") or 0), 2),
        "currency": order.get("order_currency") or "INR", "status": status, "latency_ms": 0.0,
        "failure_reason": pay.get("error_details", {}).get("error_reason") if status == "FAILED" else None,
        "user": "customer***",
    }
    await _ingest_transaction(txn)
    logger.info(f"💳 Cashfree webhook → {txn['txn_id']} ({status})")
    return {"status": "ok"}


# ── PayU (reverse hash: sha512(salt|status|udf..|email|firstname|productinfo|amount|txnid|key)) ──
@app.post("/api/webhooks/payu")
async def payu_webhook(request: Request):
    secret = _gateway_secret("PAYU")   # PayU merchant SALT
    if not secret:
        raise HTTPException(status_code=503, detail="PAYU_WEBHOOK_SECRET (salt) not configured")
    form = dict((await request.form()))
    key = form.get("key", ""); txnid = form.get("txnid", ""); amount = form.get("amount", "")
    productinfo = form.get("productinfo", ""); firstname = form.get("firstname", ""); email = form.get("email", "")
    status = form.get("status", ""); posted = form.get("hash", "")
    udf = [form.get(f"udf{i}", "") for i in range(1, 6)]
    seq = [secret, status] + list(reversed(udf)) + ["", "", "", "", "", email, firstname, productinfo, amount, txnid, key]
    expected = hashlib.sha512("|".join(seq).encode()).hexdigest()
    if not hmac.compare_digest(expected, posted):
        raise HTTPException(status_code=401, detail="Invalid PayU reverse hash")
    norm = "SUCCESS" if status.lower() == "success" else "PENDING" if status.lower() in ("pending", "in progress") else "FAILED"
    txn = {
        "txn_id": form.get("mihpayid") or txnid or f"TXN{uuid.uuid4().hex[:12].upper()}",
        "order_id": txnid or "—", "txn_type": "PURCHASE",
        "method": {"upi": "UPI", "cc": "CREDIT_CARD", "dc": "DEBIT_CARD", "nb": "NET_BANKING", "cash": "WALLET"}.get((form.get("mode") or "").lower(), "CREDIT_CARD"),
        "provider": "PayU", "gateway": "PayU",
        "amount": round(float(amount or 0), 2), "currency": "INR", "status": norm, "latency_ms": 0.0,
        "failure_reason": form.get("error_Message") if norm == "FAILED" else None,
        "user": _mask_user(email or ""),
    }
    await _ingest_transaction(txn)
    logger.info(f"💳 PayU webhook → {txn['txn_id']} ({norm})")
    return {"status": "ok"}


# ── Universal signed webhook: any gateway that posts our normalized JSON with
#    X-Webhook-Signature = HMAC_SHA256(rawBody, secret) (hex or base64). ──
@app.post("/api/webhooks/gateway/{name}")
async def universal_gateway_webhook(name: str, request: Request):
    secret = _gateway_secret(name)
    if not secret:
        raise HTTPException(status_code=503, detail=f"{name.upper()}_WEBHOOK_SECRET (or GATEWAY_WEBHOOK_SECRET) not configured")
    body = await request.body()
    sig = request.headers.get("x-webhook-signature", "")
    hex_sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    import base64 as _b64
    b64_sig = _b64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    if not (hmac.compare_digest(hex_sig, sig) or hmac.compare_digest(b64_sig, sig)):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    d = json.loads(body or b"{}")
    txn = {
        "txn_id": d.get("txn_id") or f"TXN{uuid.uuid4().hex[:12].upper()}",
        "order_id": d.get("order_id") or "—",
        "txn_type": d.get("txn_type", "PURCHASE"),
        "method": d.get("method", "UPI"), "provider": d.get("provider", name.title()),
        "gateway": d.get("gateway", name.title()),
        "amount": round(float(d.get("amount") or 0), 2), "currency": d.get("currency", "INR"),
        "status": d.get("status", "SUCCESS"), "latency_ms": float(d.get("latency_ms") or 0),
        "failure_reason": d.get("failure_reason"), "user": d.get("user", "customer***"),
    }
    await _ingest_transaction(txn)
    logger.info(f"💳 {name.title()} webhook → {txn['txn_id']} ({txn['status']})")
    return {"status": "ok"}


class IngestTxn(BaseModel):
    txn_id: Optional[str] = None
    order_id: Optional[str] = None
    txn_type: str = "PURCHASE"
    method: str = "UPI"
    provider: str = "external"
    gateway: str = "custom"
    amount: float
    currency: str = "INR"
    status: str = "SUCCESS"
    latency_ms: float = 0.0
    failure_reason: Optional[str] = None
    user: str = "customer***"
    timestamp: Optional[str] = None


@app.post("/api/ingest/transaction")
async def ingest_transaction(txn: IngestTxn, request: Request):
    """Generic authenticated ingestion — push transactions from any system."""
    if not INGEST_API_KEY:
        raise HTTPException(status_code=503, detail="INGEST_API_KEY not configured — set it as a secret to enable ingestion")
    if not hmac.compare_digest(request.headers.get("x-api-key", ""), INGEST_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")
    d = txn.model_dump()
    d["txn_id"] = d["txn_id"] or f"TXN{uuid.uuid4().hex[:12].upper()}"
    d["order_id"] = d["order_id"] or f"EXT{random.randint(10_000_000, 99_999_999)}"
    if not d["timestamp"]:
        d.pop("timestamp")
    await _ingest_transaction(d)
    return {"status": "ok", "txn_id": d["txn_id"]}

# --- KUBERNETES API ---
# When the simulator is off there is no real cluster behind the app, so we
# return a "disabled" empty snapshot instead of synthetic pods.
_K8S_DISABLED = {
    "disabled": True, "nodes": [], "pods": [], "events": [],
    "summary": {"nodes_ready": 0, "nodes_total": 0, "pods_running": 0, "pods_total": 0,
                "cluster_cpu_pct": 0, "cluster_mem_pct": 0, "total_restarts": 0},
}

@app.get("/api/k8s/cluster")
async def get_k8s_cluster():
    return k8s_cluster.snapshot() if SIMULATOR_ENABLED else _K8S_DISABLED

@app.get("/api/k8s/pods")
async def get_k8s_pods():
    return k8s_cluster.snapshot()["pods"] if SIMULATOR_ENABLED else []

@app.get("/api/k8s/events")
async def get_k8s_events():
    return k8s_cluster.events[:60] if SIMULATOR_ENABLED else []

@app.post("/api/rca/{trace_id}")
async def analyze_trace(trace_id: str, event: AnomalyEvent):
    if not model:
        # Graceful fallback when Gemini API key is missing
        await asyncio.sleep(1.5)  # Simulate AI thinking time
        
        anomaly_type = event.anomaly_type or "Unclassified Anomaly"
        rule_flags = event.rule_flags or {}
        
        fixes = [
            f"Investigate {event.service} for recent deployments affecting {event.route}",
            "Check database indexing and query patterns",
            "Review connection pool metrics"
        ]
        
        if "N+1" in anomaly_type:
            rca = f"Detected {rule_flags.get('n_plus_1_count', 'multiple')} sequential DB spans under a single parent, indicating a missing JOIN or unbatched ORM query in {event.service}."
            fixes = ["Implement eager loading (JOINs) for related entities", "Batch queries using DataLoader pattern", "Enable query logging to identify the exact ORM call"]
        elif "Bimodal" in anomaly_type:
            rca = f"Latency distribution for {event.route} has split into two modes (variance ~{rule_flags.get('latency_variance', 0):.0f}), likely due to intermittent cache misses or resource contention."
            fixes = ["Check cache hit rates and TTL configuration", "Investigate thread pool or connection pool exhaustion", "Add circuit breakers for downstream calls"]
        elif "Dependency" in anomaly_type:
            rca = f"Span references missing parent ({rule_flags.get('dangling_span', 'unknown')}), indicating a broken trace context or dropped network packet between services."
            fixes = ["Ensure W3C trace context is propagated in HTTP headers", "Check network reliability between services", "Verify OTel auto-instrumentation compatibility"]
        elif "PII" in anomaly_type:
            rca = f"High density of redacted tokens ({rule_flags.get('redaction_ratio', 0)*100:.0f}%) detected in logs. Possible data exfiltration path or overly verbose logging."
            fixes = ["Audit logging configuration to prevent PII leakage", "Review recent code changes for new debug logs", "Implement stricter egress filtering"]
        elif "Failure Spike" in anomaly_type:
            rca = f"Payment failure rate spiked to {rule_flags.get('failure_rate', 0)*100:.0f}% on gateway {rule_flags.get('gateway', 'unknown')}, indicating a PSP-side degradation or expired gateway credentials."
            fixes = [f"Fail over traffic from {rule_flags.get('gateway', 'the affected gateway')} to a healthy PSP via routing rules", "Enable automatic gateway retries with exponential backoff", "Check PSP status page and open a priority ticket"]
        elif "Gateway Timeout" in anomaly_type:
            rca = f"Gateway {rule_flags.get('gateway', 'unknown')} exceeded timeout budget ({event.duration_ms:.0f}ms), stalling checkout completions."
            fixes = ["Reduce gateway call timeout and add circuit breaker", "Route new transactions to a secondary gateway", "Reconcile PENDING transactions once the gateway recovers"]
        elif "Fraud Velocity" in anomaly_type:
            rca = f"Account {rule_flags.get('account', 'unknown')} initiated {rule_flags.get('txn_per_min', '?')} transactions/min, far above baseline — pattern consistent with card testing or account takeover."
            fixes = ["Temporarily block the account and force re-authentication", "Enable step-up verification (OTP/3DS) for high-velocity accounts", "Review device fingerprints linked to the account"]
        elif "Duplicate" in anomaly_type:
            rca = f"Duplicate charge detected (original {rule_flags.get('dup_txn_id', 'unknown')}) — idempotency key was not honored across retries."
            fixes = ["Auto-refund the duplicate transaction", "Enforce idempotency keys at the gateway adapter layer", "Add uniqueness constraint on (order_id, amount, window)"]
        elif "CrashLoopBackOff" in anomaly_type:
            rca = f"Pod {rule_flags.get('k8s_pod', 'unknown')} on {rule_flags.get('k8s_node', '?')} is crash-looping ({rule_flags.get('k8s_restarts', 0)} restarts) — likely a failing readiness dependency or bad config rollout."
            fixes = ["kubectl logs --previous to inspect the crashing container", "Roll back the latest deployment revision", "Verify ConfigMap/Secret mounts and liveness probe thresholds"]
        elif "OOMKilled" in anomaly_type:
            rca = f"Container in pod {rule_flags.get('k8s_pod', 'unknown')} was OOMKilled — memory usage exceeded its limit, suggesting a leak or undersized limits."
            fixes = ["Raise memory limits/requests after profiling actual usage", "Inspect for memory leaks under sustained load", "Add HPA on memory utilization to absorb spikes"]
        else:
            rca = f"Multiple ML detectors (Isolation Forest, Autoencoder) flagged {event.service}::{event.route} as a severe statistical outlier compared to baseline."
            
        return {
            "root_cause": rca + " (Simulated RCA: GEMINI_API_KEY not configured)",
            "suggested_fixes": fixes,
            "risk_prediction": "Potential service degradation or data exposure if left unresolved.",
            "confidence": round(random.uniform(0.75, 0.95), 2)
        }

    # ── Extract typed fields from AnomalyEvent ──────────────────────
    anomaly_type = event.anomaly_type or "Unclassified Anomaly"
    reasons = event.reasons or []
    rule_flags = event.rule_flags or {}
    ml_scores = event.ml_scores or {}
    service = event.service
    route = event.route
    duration_ms = event.duration_ms
    anomaly_score = event.anomaly_score
    timestamp = event.timestamp
    spans = [s.model_dump() for s in (event.spans or [])]

    # ── Span statistics ─────────────────────────────────────────────
    span_count = len(spans)
    error_spans = [s for s in spans if s.get("is_anomaly")]
    error_count = len(error_spans)
    unique_services = list({s.get("service", "?") for s in spans})
    durations = [s.get("duration_ms", 0) for s in spans]
    max_span_dur = max(durations) if durations else 0
    min_span_dur = min(durations) if durations else 0
    avg_span_dur = sum(durations) / len(durations) if durations else 0

    # ── Dependency chain (parent → child relationships) ─────────────
    span_ids = {s.get("span_id") or "" for s in spans if s.get("span_id")}
    dep_chain_lines = []
    dangling_parents = []
    for s in spans:
        parent = s.get("parent_span_id") or ""
        sid = s.get("span_id") or ""
        svc = s.get("service") or "?"
        name = s.get("name") or "?"
        if parent and parent in span_ids:
            dep_chain_lines.append(f"  {parent[:8]}… → {sid[:8]}… ({svc}::{name})")
        elif parent and parent not in span_ids:
            dangling_parents.append(f"  ⚠ {sid[:8]}… ({svc}::{name}) references missing parent {parent[:8]}…")
    dep_block = "\n".join(dep_chain_lines[:15]) if dep_chain_lines else "  (no parent-child links found)"
    dangling_block = "\n".join(dangling_parents) if dangling_parents else "  (none)"

    # ── Rule detectors (human-readable) ─────────────────────────────
    fired_detectors = []
    if rule_flags.get("n_plus_1"):
        fired_detectors.append(
            f"N+1 Query Regression — span_count={rule_flags.get('n_plus_1_count', 0)} "
            "(Chebyshev bound on rolling span-count distribution)"
        )
    if rule_flags.get("bimodal_latency"):
        fired_detectors.append(
            f"Bimodal Latency — EWMA variance≈{rule_flags.get('latency_variance', 0.0):.1f} "
            "(σ exceeds threshold → latency distribution has split into two modes)"
        )
    if rule_flags.get("dependency_break"):
        fired_detectors.append(
            f"Dependency Chain Break — dangling span '{rule_flags.get('dangling_span')}' "
            "(parent_span_id references a span not present in the reconstructed trace)"
        )
    if rule_flags.get("pii_density"):
        ratio = rule_flags.get("redaction_ratio", 0.0)
        fired_detectors.append(
            f"PII Redaction Density — {ratio*100:.0f}% of logs in 60s window redacted "
            "(possible data-exfil path or misconfigured logger)"
        )
    if rule_flags.get("k8s_pod"):
        fired_detectors.append(
            f"Kubernetes Pod Failure — pod '{rule_flags.get('k8s_pod')}' on node "
            f"'{rule_flags.get('k8s_node')}' (deployment={rule_flags.get('k8s_deployment')}, "
            f"restarts={rule_flags.get('k8s_restarts', 0)})"
        )
    if rule_flags.get("payment_failure"):
        fired_detectors.append(
            f"Payment Failure Spike — failure rate {rule_flags.get('failure_rate', 0)*100:.0f}% "
            f"on gateway '{rule_flags.get('gateway')}'"
        )
    if rule_flags.get("gateway_timeout"):
        fired_detectors.append(
            f"Gateway Timeout — gateway '{rule_flags.get('gateway')}' exceeded its timeout budget"
        )
    if rule_flags.get("fraud_velocity"):
        fired_detectors.append(
            f"Fraud Velocity — account '{rule_flags.get('account')}' at "
            f"{rule_flags.get('txn_per_min')} transactions/min (card-testing / ATO pattern)"
        )
    if rule_flags.get("duplicate_charge"):
        fired_detectors.append(
            f"Duplicate Charge — idempotency violation, original transaction {rule_flags.get('dup_txn_id')}"
        )
    detectors_block = "\n".join(f"- {d}" for d in fired_detectors) or "- (none; ML-only detection)"

    ml_block = "\n".join(f"- {name}: {float(v):.3f}" for name, v in ml_scores.items()) or "- (no ML scores)"

    # ── Span inventory (detailed) ───────────────────────────────────
    span_summary_lines = []
    for s in spans[:20]:
        line = (
            f"  - {s.get('service') or '?'}::{s.get('name') or '?'} "
            f"dur={s.get('duration_ms') or 0:.0f}ms status={s.get('status_code') or 0} "
            f"span={(s.get('span_id') or '')[:8]}… parent={(s.get('parent_span_id') or '')[:8]}…"
        )
        if s.get("is_anomaly"):
            line += " [ANOMALOUS]"
        span_summary_lines.append(line)
    spans_block = "\n".join(span_summary_lines) or "  (no spans)"

    # ── Correlated logs from DB ─────────────────────────────────────
    logs_block = "(no correlated logs)"
    try:
        trace_logs = await storage.get_logs(trace_id=trace_id, limit=25)
        if trace_logs:
            log_lines = []
            for lg in trace_logs:
                log_lines.append(
                    f"  - [{lg.get('severity','INFO')}] {lg.get('service_name','?')}: "
                    f"{(lg.get('body','') or '')[:240]}"
                )
            logs_block = "\n".join(log_lines)
    except Exception as e:
        logger.warning(f"Could not fetch correlated logs for RCA {trace_id}: {e}")

    # ── Raw anomaly event JSON (complete context for LLM) ───────────
    event_json = json.dumps(event.model_dump(), indent=2, default=str)

    prompt = f"""You are MonoXAI, an expert SRE root-cause-analysis engine.
Analyze the following anomaly event and produce a precise diagnosis.

═══ ANOMALY SUMMARY ═══════════════════════════════════════════════
Type            : {anomaly_type}
Service         : {service}
Route           : {route}
Duration        : {duration_ms:.1f} ms
Anomaly Score   : {anomaly_score:.4f}
Timestamp       : {timestamp}
Span Count      : {span_count} (errors: {error_count})
Unique Services : {', '.join(unique_services)}
Span Durations  : min={min_span_dur:.0f}ms  avg={avg_span_dur:.0f}ms  max={max_span_dur:.0f}ms

═══ RULE DETECTORS FIRED ══════════════════════════════════════════
{detectors_block}

═══ ML ENSEMBLE SCORES ════════════════════════════════════════════
{ml_block}

═══ DEPENDENCY CHAIN ══════════════════════════════════════════════
{dep_block}

Dangling Parents:
{dangling_block}

═══ SPAN INVENTORY (first 20) ═════════════════════════════════════
{spans_block}

═══ CORRELATED LOGS ═══════════════════════════════════════════════
{logs_block}

═══ RAW EVENT JSON ════════════════════════════════════════════════
{event_json}

═══ INSTRUCTIONS ══════════════════════════════════════════════════
1. Identify the root cause by correlating fired detectors, ML scores,
   span structure, dependency chain, and correlated logs.
2. Suggest 3 concrete, actionable fixes (not generic advice).
3. Predict the business-level risk if the issue is left unresolved.
4. Use ONLY identifiers that appear in the event data above (pod names,
   node names, gateways, accounts, trace ids). NEVER invent identifiers;
   if one is missing, refer to it generically.

Respond as STRICT JSON (no markdown fences, no commentary outside JSON):
{{
  "root_cause": "concise explanation tied to fired detectors and structural evidence (max 30 words)",
  "suggested_fixes": ["concrete fix 1", "concrete fix 2", "concrete fix 3"],
  "risk_prediction": "one-sentence impact if left unresolved",
  "confidence": 0.0-1.0
}}
"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Handle potential markdown formatting from AI
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].strip()
        return json.loads(text)
    except Exception as e:
        logger.error(f"RCA analysis failed for trace {trace_id}: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")


# --- STATIC FRONTEND (production build) ---
# When the React dashboard has been built into ./static, serve it from the
# same origin so a single container hosts both API and UI. API routes and
# /ws are registered above and therefore take precedence over the mount.
import pathlib
from fastapi.staticfiles import StaticFiles

STATIC_DIR = pathlib.Path(__file__).parent / "static"
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    logger.info(f"📦 Serving dashboard UI from {STATIC_DIR}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
