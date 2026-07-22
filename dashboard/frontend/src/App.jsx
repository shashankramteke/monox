import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity, AlertTriangle, Cpu, Globe, RefreshCcw, Zap, Search, Brain, X,
  Server, Shield, Box, LayoutPanelLeft, ChevronRight, BarChart3, Clock3, FileText,
  CreditCard, Boxes, Wallet, TrendingUp, Bell, Command, CheckCircle2, Copy,
  RotateCcw, ArrowRight, Terminal, Radio, Check, Network, Plug, Wifi, WifiOff
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Build a smooth SVG path from a series of values mapped into a viewBox.
// Uses Catmull-Rom → Cubic Bezier so data lines look polished instead of
// zig-zaggy when stretched to fill a card width.
function smoothPath(values, { width = 100, height = 20, padding = 2 } = {}) {
  if (!Array.isArray(values) || values.length === 0) return "";
  if (values.length === 1) {
    const y = height / 2;
    return `M 0 ${y} L ${width} ${y}`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: height - padding - ((v - min) / range) * (height - padding * 2),
  }));
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// ═══════════════════════════════════════════════════════════════════
// LIVING BACKGROUND — interactive constellation network on canvas.
// Nodes drift and interlink; lines reach toward the cursor; clicks send
// shockwaves through the field; live WebSocket events paint it: every
// transaction fires a particle burst (green ok / red fail) and every
// anomaly emits a radar ripple. The background IS the data stream.
// ═══════════════════════════════════════════════════════════════════
function NodeGlobe() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf, w, h, cx, cy, R;
    const resize = () => {
      w = canvas.width = window.innerWidth * DPR;
      h = canvas.height = window.innerHeight * DPR;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      cx = w / 2; cy = h / 2;
      R = Math.min(w, h) * 0.30;
    };
    resize();

    // Fibonacci sphere of unit vectors
    const N = reduced ? 90 : 150;
    const GA = Math.PI * (3 - Math.sqrt(5));
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * GA;
      pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
    }
    // Precompute nearest-neighbour links (wireframe)
    const links = [];
    for (let i = 0; i < N; i++) {
      const d = [];
      for (let j = 0; j < N; j++) if (i !== j) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z;
        d.push([dx * dx + dy * dy + dz * dz, j]);
      }
      d.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < 3; k++) { const j = d[k][1]; if (i < j) links.push([i, j]); }
    }
    // Orbiting particles (own tilted circular orbits)
    const orbits = Array.from({ length: reduced ? 3 : 6 }, () => ({
      a: Math.random() * Math.PI * 2,
      speed: 0.004 + Math.random() * 0.006,
      rad: 1.25 + Math.random() * 0.5,
      tilt: Math.random() * Math.PI,
    }));

    const mouse = { x: 0, y: 0 };
    const onMove = (e) => { mouse.x = (e.clientX / window.innerWidth - 0.5); mouse.y = (e.clientY / window.innerHeight - 0.5); };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Data reactivity
    let glow = 0, glowColor = "96,165,250";
    const ripples = [];
    const onTxn = (e) => { glow = 1; glowColor = e.detail?.status === "FAILED" ? "251,113,133" : "52,211,153"; };
    const onAnomaly = () => { ripples.push({ r: R * 0.9, alpha: 0.5 }); };
    window.addEventListener("monox:txn", onTxn);
    window.addEventListener("monox:anomaly", onAnomaly);
    window.addEventListener("resize", resize);

    let ay = 0;
    const project = (p, sin, cos, tSin, tCos) => {
      let x = p.x * cos - p.z * sin;
      let z = p.x * sin + p.z * cos;
      const y = p.y * tCos - z * tSin;
      z = p.y * tSin + z * tCos;
      return { x, y, z };
    };

    const step = () => {
      // Self-heal sizing: fixes a 0-width mount race and live viewport resizes.
      if (w !== window.innerWidth * DPR || h !== window.innerHeight * DPR) resize();
      ctx.clearRect(0, 0, w, h);
      ay += 0.0024;
      const targetTilt = -0.35 + mouse.y * 0.5;
      const sin = Math.sin(ay + mouse.x * 0.6), cos = Math.cos(ay + mouse.x * 0.6);
      const tSin = Math.sin(targetTilt), tCos = Math.cos(targetTilt);
      const ox = cx + mouse.x * 30 * DPR, oy = cy + mouse.y * 20 * DPR;

      const proj = pts.map(p => project(p, sin, cos, tSin, tCos));
      glow *= 0.94;

      // wireframe links (alpha by depth)
      for (const [i, j] of links) {
        const a = proj[i], b = proj[j];
        const zc = (a.z + b.z) / 2;
        const depth = (zc + 1) / 2;
        const alpha = 0.05 + depth * 0.22 + glow * 0.15;
        ctx.strokeStyle = `rgba(${glow > 0.05 ? glowColor : "96,165,250"},${alpha})`;
        ctx.lineWidth = (0.4 + depth * 0.7) * DPR;
        ctx.beginPath();
        ctx.moveTo(ox + a.x * R, oy + a.y * R);
        ctx.lineTo(ox + b.x * R, oy + b.y * R);
        ctx.stroke();
      }
      // nodes
      for (const a of proj) {
        const depth = (a.z + 1) / 2;
        const rad = (0.6 + depth * 1.9) * DPR;
        ctx.beginPath();
        ctx.arc(ox + a.x * R, oy + a.y * R, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${glow > 0.05 ? glowColor : "147,197,253"},${0.3 + depth * 0.6})`;
        ctx.fill();
      }
      // core glow
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 1.1);
      grad.addColorStop(0, `rgba(${glowColor},${0.05 + glow * 0.18})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(ox, oy, R * 1.1, 0, Math.PI * 2); ctx.fill();

      // orbiting particles
      for (const o of orbits) {
        o.a += o.speed;
        const px = Math.cos(o.a) * o.rad, pz = Math.sin(o.a) * o.rad;
        const oyv = pz * Math.sin(o.tilt);
        const ozv = pz * Math.cos(o.tilt);
        const pr = project({ x: px, y: oyv, z: ozv }, sin, cos, tSin, tCos);
        const depth = (pr.z + 1) / 2;
        ctx.beginPath();
        ctx.arc(ox + pr.x * R, oy + pr.y * R, (1 + depth * 1.6) * DPR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(191,219,254,${0.35 + depth * 0.5})`;
        ctx.fill();
      }
      // anomaly ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]; rp.r += 3 * DPR; rp.alpha *= 0.95;
        ctx.strokeStyle = `rgba(251,113,133,${rp.alpha})`;
        ctx.lineWidth = 1.5 * DPR;
        ctx.beginPath(); ctx.arc(ox, oy, rp.r, 0, Math.PI * 2); ctx.stroke();
        if (rp.alpha < 0.02) ripples.splice(i, 1);
      }
      raf = requestAnimationFrame(step);
    };
    if (reduced) { step(); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("monox:txn", onTxn);
      window.removeEventListener("monox:anomaly", onAnomaly);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="fixed inset-0 z-0 pointer-events-none" />;
}

// In dev, talk to the local backend directly; in production the API and UI
// are served from the same origin (single container deploy).
const BACKEND_URL = import.meta.env.DEV
  ? "http://localhost:8000"
  : window.location.origin;
const WS_URL = import.meta.env.DEV
  ? "ws://localhost:8000/ws"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

// Maps backend `anomaly_type` → Tailwind classes for the row badge and panel header.
const ANOMALY_STYLE = {
  "N+1 Query Regression":            { text: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-500/30", dot: "bg-orange-500" },
  "Bimodal Latency":                  { text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/30", dot: "bg-amber-500" },
  "Dependency Chain Break":           { text: "text-red-300", bg: "bg-red-600/15", border: "border-red-600/30", dot: "bg-red-600" },
  "PII Redaction Density":            { text: "text-purple-300", bg: "bg-purple-500/15", border: "border-purple-500/30", dot: "bg-purple-500" },
  "Statistical Outlier (HS-Trees)":   { text: "text-sky-300", bg: "bg-sky-500/15", border: "border-sky-500/30", dot: "bg-sky-500" },
  "Statistical Outlier (LOF)":        { text: "text-blue-300", bg: "bg-blue-500/15", border: "border-blue-500/30", dot: "bg-blue-500" },
  "Statistical Outlier (Isolation Forest)": { text: "text-indigo-300", bg: "bg-indigo-500/15", border: "border-indigo-500/30", dot: "bg-indigo-500" },
  "Reconstruction Anomaly (Autoencoder)":   { text: "text-pink-300", bg: "bg-pink-500/15", border: "border-pink-500/30", dot: "bg-pink-500" },
  "Boundary Anomaly (SVM)":           { text: "text-indigo-300", bg: "bg-indigo-500/15", border: "border-indigo-500/30", dot: "bg-indigo-500" },
  "ML Ensemble Anomaly":              { text: "text-blue-300", bg: "bg-blue-500/15", border: "border-blue-500/30", dot: "bg-blue-500" },
  "Unclassified Anomaly":             { text: "text-slate-300", bg: "bg-slate-500/15", border: "border-slate-500/30", dot: "bg-slate-500" },
  "Payment Failure Spike":            { text: "text-rose-300", bg: "bg-rose-600/15", border: "border-rose-600/30", dot: "bg-rose-600" },
  "Gateway Timeout":                  { text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/30", dot: "bg-amber-500" },
  "Fraud Velocity":                   { text: "text-sky-300", bg: "bg-sky-500/15", border: "border-sky-500/30", dot: "bg-sky-500" },
  "Duplicate Charge":                 { text: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-500/30", dot: "bg-orange-500" },
  "Pod CrashLoopBackOff":             { text: "text-red-300", bg: "bg-red-600/15", border: "border-red-600/30", dot: "bg-red-600" },
  "Pod OOMKilled":                    { text: "text-rose-300", bg: "bg-rose-500/15", border: "border-rose-500/30", dot: "bg-rose-500" },
};
const DEFAULT_STYLE = { text: "text-rose-300", bg: "bg-rose-500/15", border: "border-rose-500/30", dot: "bg-rose-500" };
const styleFor = (type) => ANOMALY_STYLE[type] || DEFAULT_STYLE;

// Rule-flag → pill metadata. `fmt` renders the numeric detail (count / variance / ratio).
const RULE_PILLS = [
  { key: "n_plus_1",         label: "N+1 Queries",      metaKey: "n_plus_1_count",   fmt: (v) => v > 0 ? `×${v}` : null, color: "orange" },
  { key: "bimodal_latency",  label: "Bimodal Latency",  metaKey: "latency_variance", fmt: (v) => v > 0 ? `σ²≈${Math.round(v).toLocaleString()}` : null, color: "amber" },
  { key: "dependency_break", label: "Dangling Parent",  metaKey: "dangling_span",    fmt: (v) => v ? `@${v}` : null, color: "red" },
  { key: "pii_density",      label: "PII Density",      metaKey: "redaction_ratio",  fmt: (v) => v > 0 ? `${Math.round(v * 100)}%` : null, color: "purple" },
  { key: "payment_failure",  label: "Failure Spike",    metaKey: "failure_rate",     fmt: (v) => v > 0 ? `${Math.round(v * 100)}%` : null, color: "red" },
  { key: "gateway_timeout",  label: "Gateway Timeout",  metaKey: "gateway",          fmt: (v) => v || null, color: "amber" },
  { key: "fraud_velocity",   label: "Fraud Velocity",   metaKey: "txn_per_min",      fmt: (v) => v > 0 ? `${v}/min` : null, color: "sky" },
  { key: "duplicate_charge", label: "Duplicate Charge", metaKey: "dup_txn_id",       fmt: (v) => v ? `#${String(v).slice(0, 10)}` : null, color: "orange" },
  { key: "k8s_pod",          label: "K8s Pod",          metaKey: "k8s_restarts",     fmt: (v) => v > 0 ? `${v} restarts` : null, color: "sky" },
];
const PILL_COLOR = {
  orange: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  amber:  "bg-amber-500/10 text-amber-300 border-amber-500/30",
  red:    "bg-red-500/10 text-red-300 border-red-500/30",
  purple: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  sky: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  sky:    "bg-sky-500/10 text-sky-300 border-sky-500/30",
};

// ── Transaction display metadata ──────────────────────────────────
const TXN_STATUS_STYLE = {
  SUCCESS: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  FAILED:  "bg-rose-500/10 text-rose-400 border-rose-500/30",
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};
const CURRENCY_SYMBOL = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

function fmtAmount(amount, currency = "INR") {
  const sym = CURRENCY_SYMBOL[currency] || "";
  return sym + Number(amount ?? 0).toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 });
}

function fmtINRCompact(v) {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const K8S_STATUS_STYLE = {
  Running:          "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  Pending:          "bg-amber-500/10 text-amber-400 border-amber-500/30",
  CrashLoopBackOff: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  OOMKilled:        "bg-red-500/10 text-red-400 border-red-500/30",
  ImagePullBackOff: "bg-orange-500/10 text-orange-400 border-orange-500/30",
};

const SERVICE_NAV = ["All Services", "api-gateway", "payment-service", "order-service", "fraud-service", "wallet-service", "notification-service"];

export default function App() {
  const [anomalies, setAnomalies] = useState([]);
  const [stats, setStats] = useState({ total_traces: 0, anomaly_count: 0 });
  const [statsHistory, setStatsHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [selectedService, setSelectedService] = useState("All Services");
  const [monitoringMode, setMonitoringMode] = useState("SRE (Standard)");
  const [liveMode, setLiveMode] = useState(true);
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [autoCorrelation, setAutoCorrelation] = useState(true);

  // View switcher + live payment/K8s state
  const [view, setView] = useState("Observability");
  const [txns, setTxns] = useState([]);
  const [txnStats, setTxnStats] = useState(null);
  const [txnSeries, setTxnSeries] = useState([]);
  const [k8s, setK8s] = useState(null);

  const [traceContext, setTraceContext] = useState(null);
  const [traceLogs, setTraceLogs] = useState([]);
  const [traceLogsLoading, setTraceLogsLoading] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState("Traces");
  const [status, setStatus] = useState("connecting");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [appConfig, setAppConfig] = useState(null);
  // New UI features
  const [selectedTxn, setSelectedTxn] = useState(null);   // detail drawer
  const [paletteOpen, setPaletteOpen] = useState(false);  // command palette
  const [notifOpen, setNotifOpen] = useState(false);      // notifications dropdown
  const [readNotifKey, setReadNotifKey] = useState(null); // key of newest read anomaly
  const [connectOpen, setConnectOpen] = useState(false);  // Razorpay wizard
  const [integrations, setIntegrations] = useState(null); // API network
  const ws = useRef(null);
  const liveModeRef = useRef(liveMode);
  const unmountedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { liveModeRef.current = liveMode; }, [liveMode]);

  // Load history and initialize WS
  useEffect(() => {
    unmountedRef.current = false;
    fetchHistory();
    connectWS();
    return () => {
      unmountedRef.current = true;
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, []);

  const fetchHistory = async () => {
    try {
      const alertRes = await fetch(`${BACKEND_URL}/api/alerts`);
      if (!alertRes.ok) throw new Error("Failed to fetch alerts");
      const alertData = await alertRes.json();
      setAnomalies(alertData);

      fetch(`${BACKEND_URL}/api/stats`)
        .then(r => r.ok ? r.json() : null)
        .then(s => {
          if (s) {
            setStats(s);
            const rate = s.total_traces > 0 ? (s.anomaly_count / s.total_traces) * 100 : 0;
            setStatsHistory(prev => [...prev, rate].slice(-30));
          }
        })
        .catch(() => {});

      // Fetch metrics history for current service context.
      // Fetch both the chart metric (p99/redaction) AND throughput so the
      // summary StatCard has data on first paint instead of waiting for WS.
      const metricType = getMetricTypeForMode(monitoringMode);
      const typesToFetch = metricType === "throughput"
        ? [metricType]
        : [metricType, "throughput"];
      const metricResults = await Promise.all(
        typesToFetch.map(t =>
          fetch(`${BACKEND_URL}/api/metrics/${selectedService}/${t}`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      const merged = metricResults.flat().sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      setMetrics(merged);
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const getMetricTypeForMode = (mode) => {
    if (mode === "Security (Redaction)") return "redaction_count";
    if (mode === "Bimodal Analysis") return "p99_latency";
    return "p99_latency";
  };

  const connectWS = () => {
    if (unmountedRef.current) return;
    if (ws.current) {
      ws.current.onclose = null;
      ws.current.close();
    }
    ws.current = new WebSocket(WS_URL);
    ws.current.onopen = () => setStatus("connected");
    ws.current.onclose = () => {
      setStatus("disconnected");
      if (!unmountedRef.current) setTimeout(connectWS, 2000);
    };
    ws.current.onerror = () => {};
    ws.current.onmessage = (event) => {
      if (!liveModeRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "new_anomaly") {
          // Radar ping in the living background
          window.dispatchEvent(new CustomEvent("monox:anomaly"));
          setAnomalies(prev => {
            const incoming = msg.data;
            const key = incoming.id ?? `${incoming.trace_id}-${incoming.timestamp}`;
            const filtered = prev.filter(a => (a.id ?? `${a.trace_id}-${a.timestamp}`) !== key);
            return [incoming, ...filtered].slice(0, 50);
          });
          fetch(`${BACKEND_URL}/api/stats`)
            .then(r => r.ok ? r.json() : null)
            .then(s => {
              if (s) {
                setStats(s);
                const rate = s.total_traces > 0 ? (s.anomaly_count / s.total_traces) * 100 : 0;
                setStatsHistory(prev => [...prev, rate].slice(-30));
              }
            })
            .catch(() => {});
        } else if (msg.type === "metric_update") {
          setMetrics(prev => [...prev, msg.data].slice(-600));
        } else if (msg.type === "new_transaction") {
          setTxns(prev => [msg.data, ...prev].slice(0, 200));
          // Particle burst in the living background (green ok / red fail)
          window.dispatchEvent(new CustomEvent("monox:txn", { detail: { status: msg.data.status } }));
        } else if (msg.type === "txn_stats") {
          const d = msg.data;
          setTxnStats(prev => ({ ...(prev || {}), ...d }));
          setTxnSeries(prev => {
            const last = prev[prev.length - 1];
            const point = {
              time: new Date(d.timestamp || Date.now()).toLocaleTimeString(),
              success_rate: d.success_rate,
              tps: d.tps ?? 0,
              successDelta: last ? Math.max(0, d.success - last._successCum) : 0,
              failedDelta: last ? Math.max(0, d.failed - last._failedCum) : 0,
              volumeDelta: last ? Math.max(0, d.volume_inr - last._volumeCum) : 0,
              _successCum: d.success, _failedCum: d.failed, _volumeCum: d.volume_inr,
            };
            return [...prev, point].slice(-60);
          });
        } else if (msg.type === "k8s_update") {
          setK8s(msg.data);
        } else if (msg.type === "mode_change") {
          setAppConfig(prev => ({ ...(prev || {}), real_only: msg.data.real_only, real_payments_seen: true }));
          setToast("🟢 Real payment detected — switched to REAL-ONLY mode");
          setTimeout(() => setToast(null), 4000);
        } else if (msg.type === "history") {
          setAnomalies(msg.data);
        }
      } catch (err) { console.error("WS message parse error:", err); }
    };
  };

  const runRCA = async (alert) => {
    // The Diagnostic Center lives in the Observability view — always switch
    // there so investigating from Transactions/Kubernetes views works.
    setView("Observability");
    setSelectedTrace(alert);
    setIsAnalyzing(false);
    setAnalysis(null);
    setTraceContext(null);
    setTraceLogs([]);
    setTraceLogsLoading(true);
    setActiveTab("Overview");
    try {
      // 1. Fetch FULL trace inventory for waterfall. Payment/K8s/PII alerts
      // have no stored trace (404) — fall back to the alert's own data so
      // AI Analysis still works.
      const traceRes = await fetch(`${BACKEND_URL}/api/traces/${alert.trace_id}`);
      const fullTrace = traceRes.ok
        ? await traceRes.json()
        : { duration_ms: alert.duration_ms ?? 0, spans: alert.spans || [] };

      const spans = fullTrace.spans || [];
      const firstStart = spans.length > 0 ? Math.min(...spans.map(s => new Date(s.start_time).getTime())) : 0;

      const normalizedSpans = spans.sort((a, b) => new Date(a.start_time) - new Date(b.start_time)).map(s => ({
        name: s.name,
        service: s.service,
        start: new Date(s.start_time).getTime() - firstStart,
        duration: s.duration_ms,
        type: s.service === "api-gateway" ? "API" : s.name.includes("db") ? "DATABASE" : "SERVICE"
      }));

      const context = {
        trace_id: alert.trace_id,
        duration_ms: fullTrace.duration_ms ?? alert.duration_ms ?? 0,
        spans: normalizedSpans
      };

      setTraceContext(context);

      // 2. Fetch correlated logs for this trace (when auto-correlation is on)
      if (autoCorrelation) {
        const logRes = await fetch(`${BACKEND_URL}/api/logs?trace_id=${alert.trace_id}`);
        const logData = await logRes.json();
        setTraceLogs(logData);
      }
    } catch (err) {
      console.error("RCA Failed:", err);
      // Even if the trace fetch dies, give AI Analysis a minimal context so
      // the tab is never stuck without data.
      setTraceContext({ trace_id: alert.trace_id, duration_ms: alert.duration_ms ?? 0, spans: [] });
    } finally {
      setTraceLogsLoading(false);
    }
  };

  const runAIAnalysis = async (ctx) => {
    setIsAnalyzing(true);
    try {
      const rcaPayload = {
        ...ctx,
        duration_ms: ctx.duration_ms ?? selectedTrace?.duration_ms ?? 0,
        service: selectedTrace?.service || "unknown",
        route: selectedTrace?.route || "unknown",
        anomaly_score: selectedTrace?.anomaly_score ?? 0,
        is_anomaly: selectedTrace?.is_anomaly ?? true,
        anomaly_type: selectedTrace?.anomaly_type,
        timestamp: selectedTrace?.timestamp || new Date().toISOString(),
        reasons: selectedTrace?.reasons,
        rule_flags: selectedTrace?.rule_flags,
        ml_scores: selectedTrace?.ml_scores,
        spans: (ctx.spans || []).map(s => ({
          name: s.name || "unknown",
          service: s.service || "unknown",
          duration_ms: s.duration ?? s.duration_ms ?? 0,
          start_time: s.start_time || new Date().toISOString(),
          status_code: s.status_code,
          is_anomaly: s.is_anomaly,
          span_id: s.span_id,
          parent_span_id: s.parent_span_id,
        })),
      };
      const response = await fetch(`${BACKEND_URL}/api/rca/${ctx.trace_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rcaPayload)
      });
      if (!response.ok) {
        const errBody = await response.text();
        console.error(`RCA API error ${response.status}:`, errBody);
        throw new Error(`API ${response.status}: ${errBody}`);
      }
      const data = await response.json();
      setAnalysis({ ...data, traceData: ctx });
    } catch (err) {
      console.error("AI Analysis Failed:", err);
      setAnalysis({
        root_cause: `AI analysis failed: ${err.message || "Unknown error"}`,
        suggested_fixes: ["Check GEMINI_API_KEY configuration", "Check backend logs for details", "Try again in a few moments"],
        risk_prediction: "N/A",
        traceData: ctx
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    if (tab === "AI Analysis" && traceContext && !analysis && !isAnalyzing) {
      runAIAnalysis(traceContext);
    }
  };

  // If the AI Analysis tab was opened before the incident context finished
  // loading, kick off the analysis as soon as the context arrives.
  useEffect(() => {
    if (activeTab === "AI Analysis" && traceContext && !analysis && !isAnalyzing) {
      runAIAnalysis(traceContext);
    }
  }, [activeTab, traceContext]);

  const chartData = useMemo(() => {
    const metricType = getMetricTypeForMode(monitoringMode);
    const filtered = metrics.filter(m =>
      (selectedService === "All Services" || m.service === selectedService) &&
      (m.metric_type === metricType)
    );
    return filtered.slice(-50).map((m) => {
      const ts = new Date(m.timestamp);
      return {
        // Human-readable timestamp for the X axis / tooltip
        time: ts.toLocaleTimeString(),
        // Raw numeric timestamp (ms) if needed later
        ts: ts.getTime(),
        val: m.value
      };
    });
  }, [metrics, selectedService, monitoringMode]);

  const chartLabel = useMemo(() => {
    const metricType = getMetricTypeForMode(monitoringMode);
    if (metricType === "redaction_count") {
      return "Security Redaction Count Over Time";
    }
    // Default is p99_latency in milliseconds
    return "P99 Latency (ms) Over Time";
  }, [monitoringMode]);

  // Derived summary stats for StatCards (Phase 2: replace hardcoded values)
  const summaryStats = useMemo(() => {
    const latencies = metrics.filter(m => m.metric_type === "p99_latency").map(m => m.value);
    const throughputs = metrics.filter(m => m.metric_type === "throughput").map(m => m.value);
    const throughputVal = throughputs.length > 0
      ? throughputs.reduce((a, b) => a + b, 0).toFixed(0)
      : "—";
    const latencyVal = latencies.length > 0
      ? latencies[latencies.length - 1].toFixed(0) + "ms"
      : "—";
    const errorRate = stats.total_traces > 0
      ? ((stats.anomaly_count / stats.total_traces) * 100).toFixed(1) + "%"
      : "0%";
    const latencyTrend = latencies.length > 0 && latencies[latencies.length - 1] > 500
      ? "Critical" : "Normal";
    const throughputTrend = throughputs.length >= 2
      ? ((throughputs[throughputs.length - 1] - throughputs[throughputs.length - 2]) >= 0 ? "+" : "") +
        ((throughputs[throughputs.length - 1] - throughputs[throughputs.length - 2])).toFixed(0)
      : "—";

    const throughputSeries = throughputs.slice(-50);
    const p99Series = latencies.slice(-50);
    const anomalySeries = statsHistory.slice(-50);

    return {
      throughput: throughputVal, p99: latencyVal, errorRate,
      latencyTrend, throughputTrend,
      throughputSeries, p99Series,
      anomalySeries,
    };
  }, [metrics, anomalies, stats, statsHistory]);

  // Dynamic AI Insight from latest anomaly
  const aiInsight = useMemo(() => {
    if (anomalies.length === 0) return { text: "No active anomalies detected. System operating normally.", hasAnomaly: false };
    const latest = anomalies[0];
    return {
      text: `Detected anomaly in ${latest.service} — ${(latest.duration_ms ?? 0).toFixed(0)}ms latency on ${latest.route}. Investigate for potential performance degradation.`,
      hasAnomaly: true,
      alert: latest,
    };
  }, [anomalies]);

  // Filtered anomalies for search + anomaliesOnly toggle.
  // Tokenized match: each whitespace-separated token must appear somewhere,
  // so "razor pay" matches "Razorpay" and word order/spacing doesn't matter.
  const filteredAnomalies = useMemo(() => {
    let filtered = anomalies;
    if (anomaliesOnly) {
      filtered = filtered.filter(a => a.is_anomaly);
    }
    const tokens = searchQuery.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (tokens.length) {
      filtered = filtered.filter(a => {
        const hay = [a.service, a.route, a.trace_id, a.anomaly_type, (a.reasons || []).join(" "),
          a.rule_flags?.gateway].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, "");
        return tokens.every(t => hay.includes(t.replace(/\s+/g, "")));
      });
    }
    return filtered;
  }, [anomalies, anomaliesOnly, searchQuery]);

  // Sync metrics when mode/service changes
  useEffect(() => {
    fetchHistory();
  }, [selectedService, monitoringMode]);

  // Sync transactions + K8s state. `force` overwrites the live-streamed feed
  // (used by the Refresh button); the periodic call is gentle and only fills
  // gaps so it never fights the WebSocket stream.
  const loadTxnAndK8s = async ({ force = false } = {}) => {
    try {
      const [txnData, statsData, k8sData] = await Promise.all([
        fetch(`${BACKEND_URL}/api/transactions?limit=200`).then(r => r.ok ? r.json() : []),
        fetch(`${BACKEND_URL}/api/transactions/stats`).then(r => r.ok ? r.json() : null),
        fetch(`${BACKEND_URL}/api/k8s/cluster`).then(r => r.ok ? r.json() : null),
      ]);
      setTxns(prev => (force || prev.length <= 5 ? txnData : prev));
      if (statsData) setTxnStats(prev => ({ ...(prev || {}), ...statsData }));
      if (k8sData) setK8s(k8sData);
    } catch { /* backend not ready yet */ }
  };

  // Refresh everything at once (header refresh button).
  // Look up a payment by transaction / order id and open its detail drawer
  // (which shows any anomalies detected on it).
  const lookupTxn = async (id) => {
    const q = (id || "").trim();
    if (!q) return;
    setToast(`Looking up ${q}…`);
    try {
      const res = await fetch(`${BACKEND_URL}/api/transactions/lookup/${encodeURIComponent(q)}`);
      if (!res.ok) { setToast(`No transaction or anomaly found for "${q}"`); setTimeout(() => setToast(null), 2500); return; }
      const d = await res.json();
      if (d.transaction) { setSelectedTxn(d.transaction); setToast(null); }
      else if ((d.anomalies || []).length) { setView("Observability"); runRCA(d.anomalies[0]); setToast(null); }
      else { setToast(`No transaction found for "${q}"`); setTimeout(() => setToast(null), 2500); }
    } catch { setToast("Lookup failed — check connection"); setTimeout(() => setToast(null), 2500); }
  };

  const refreshAll = async () => {
    setToast("Refreshing live data…");
    await Promise.all([
      fetchHistory(),
      loadTxnAndK8s({ force: true }),
      fetch(`${BACKEND_URL}/api/integrations`).then(r => r.ok ? r.json() : null).then(d => d && setIntegrations(d)).catch(() => {}),
    ]);
    setToast("Data refreshed");
    setTimeout(() => setToast(null), 1500);
  };

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      loadTxnAndK8s();
      fetch(`${BACKEND_URL}/api/config`).then(r => r.ok ? r.json() : null).then(c => { if (c && !cancelled) setAppConfig(c); }).catch(() => {});
      fetch(`${BACKEND_URL}/api/integrations`).then(r => r.ok ? r.json() : null).then(d => { if (d && !cancelled) setIntegrations(d); }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Interactive layer: cursor-following spotlight on every glass card and a
  // subtle 3D tilt on KPI tiles (.tilt). Drives the CSS vars used in index.css.
  useEffect(() => {
    const move = (e) => {
      // Parallax: background arc leans gently toward the cursor
      document.documentElement.style.setProperty("--par-x", `${((e.clientX / window.innerWidth) - 0.5) * 26}px`);
      document.documentElement.style.setProperty("--par-y", `${((e.clientY / window.innerHeight) - 0.5) * 14}px`);
      const card = e.target.closest?.(".glass-card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      if (card.classList.contains("tilt")) {
        card.style.setProperty("--rx", `${((0.5 - y / r.height) * 7).toFixed(2)}deg`);
        card.style.setProperty("--ry", `${((x / r.width - 0.5) * 7).toFixed(2)}deg`);
      }
    };
    const reset = (e) => {
      const card = e.target.closest?.(".tilt");
      if (card) { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); }
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", reset, { passive: true });
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", reset);
    };
  }, []);

  // Command palette shortcut (Ctrl/Cmd+K) + Escape to close overlays
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (e.key === "Escape") {
        setPaletteOpen(false); setNotifOpen(false); setConnectOpen(false); setSelectedTxn(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Unread anomaly count for the notifications bell (newest-first list; anything
  // above the last-read key is unread).
  const anomalyKey = (a) => a?.id ?? `${a?.trace_id}-${a?.timestamp}`;
  const unreadCount = useMemo(() => {
    if (!anomalies.length) return 0;
    if (!readNotifKey) return Math.min(anomalies.length, 99);
    const idx = anomalies.findIndex(a => anomalyKey(a) === readNotifKey);
    return idx === -1 ? Math.min(anomalies.length, 99) : idx;
  }, [anomalies, readNotifKey]);

  return (
    <div className="relative flex min-h-screen text-slate-100 font-sans">
      {/* Deep-space background: nebulas, starfield, shooting stars, and the
          rotating node globe (reacts to live data) — dimmed so the dashboard
          content stays in the foreground. */}
      <div className="bg-layer">
        <div className="aurora-bg" />
        <div className="particles" />
        <div className="shooting-stars" />
        <NodeGlobe />
      </div>

      {/* Sidebar */}
      <aside className="relative z-10 w-64 border-r border-white/5 bg-[#050b1e]/40 backdrop-blur-xl p-6 flex flex-col gap-8">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 via-indigo-600 to-sky-600 glow-blue">
            <Activity className="w-5 h-5" />
          </div>
          <span className="text-xl font-black tracking-tight text-gradient">MonoXAI</span>
        </div>

        <nav className="space-y-4">
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-500">Views</label>
          <div className="space-y-1">
            {[
              { name: "Observability", icon: Activity },
              { name: "Transactions", icon: CreditCard },
              { name: "Integrations", icon: Network },
              { name: "Kubernetes", icon: Boxes },
            ].map(({ name, icon: Icon }) => (
              <button
                key={name}
                onClick={() => setView(name)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-all flex items-center justify-between group",
                  view === name ? "bg-gradient-to-r from-blue-500/20 to-sky-500/10 text-blue-200 font-bold border border-blue-500/30 glow-blue" : "text-slate-400 hover:bg-white/5 border border-transparent"
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {name}
                </div>
                {view === name && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />}
              </button>
            ))}
          </div>
        </nav>

        <nav className="space-y-4">
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-500">Service Topology</label>
          <div className="space-y-1 max-h-52 overflow-y-auto custom-scrollbar">
            {SERVICE_NAV.map(svc => (
              <button
                key={svc}
                onClick={() => setSelectedService(svc)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-all flex items-center justify-between group",
                  selectedService === svc ? "bg-gradient-to-r from-blue-500/20 to-sky-500/10 text-blue-200 font-bold border border-blue-500/30 glow-blue" : "text-slate-400 hover:bg-white/5 border border-transparent"
                )}
              >
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  {svc}
                </div>
                {selectedService === svc && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />}
              </button>
            ))}
          </div>
        </nav>

        <div className="space-y-6 mt-4">
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-500">Display Options</label>
          <div className="space-y-4">
            <Toggle label="Live Mode" active={liveMode} onClick={() => setLiveMode(!liveMode)} />
            <Toggle label="Anomalies Only" active={anomaliesOnly} onClick={() => setAnomaliesOnly(!anomaliesOnly)} />
            <Toggle label="Auto-Correlation" active={autoCorrelation} onClick={() => setAutoCorrelation(!autoCorrelation)} />
          </div>

          <div className={cn("border p-4 rounded-xl mt-6", aiInsight.hasAnomaly ? "bg-rose-600/10 border-rose-500/20" : "bg-blue-600/10 border-blue-500/20")}>
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("w-1.5 h-1.5 rounded-full", aiInsight.hasAnomaly ? "bg-rose-500 animate-ping" : "bg-blue-500")} />
              <span className={cn("text-[10px] uppercase font-black tracking-widest", aiInsight.hasAnomaly ? "text-rose-400" : "text-blue-400")}>AI Insight</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {aiInsight.text}
            </p>
            {aiInsight.hasAnomaly && (
              <button
                onClick={() => runRCA(aiInsight.alert)}
                className="btn-gradient w-full mt-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-white"
              >
                Investigate Root Cause
              </button>
            )}
          </div>
        </div>

        <div className="mt-auto space-y-4 pt-6 border-t border-slate-800/40">
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-500">Monitoring Mode</label>
          <select
            value={monitoringMode}
            onChange={(e) => setMonitoringMode(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option>SRE (Standard)</option>
            <option>N+1 Detection</option>
            <option>Security (Redaction)</option>
            <option>Bimodal Analysis</option>
          </select>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 p-8 overflow-y-auto custom-scrollbar">
        <header className="glass-card flex justify-between items-center mb-8 p-4 slide-in-from-top-1">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-md">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-black text-emerald-500 uppercase">Production</span>
            </div>
            {appConfig?.real_only ? (
              <button onClick={() => setConnectOpen(true)} className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 hover:border-green-400/60 px-2 py-1 rounded-md transition-colors" title={`Live payments only${appConfig.last_gateway ? " · " + appConfig.last_gateway : ""} — click for details`}>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-black text-green-400 uppercase">Real Payments</span>
              </button>
            ) : (
              <button onClick={() => setConnectOpen(true)} className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 hover:border-amber-400/50 px-2 py-1 rounded-md transition-colors" title="Click to link Razorpay / go live">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-[10px] font-black text-amber-500 uppercase">
                  {appConfig?.integrations?.razorpay || appConfig?.integrations?.stripe ? "Awaiting Live" : "Demo Data"}
                </span>
              </button>
            )}
          </div>

          <div className="flex-1 max-w-md mx-8 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && searchQuery.trim()) lookupTxn(searchQuery.trim()); }}
              placeholder="Search, or press Enter to look up a transaction ID…"
              className="w-full bg-[#050b1e]/80 border border-slate-700/50 rounded-full py-2 pl-10 pr-16 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-500/50 focus:shadow-[0_0_20px_-4px_rgba(96,165,250,0.4)] transition-all"
            />
            <button onClick={() => setPaletteOpen(true)} title="Command palette"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-slate-700/60 bg-slate-900/60 text-[9px] font-bold text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors">
              <Command className="w-2.5 h-2.5" />K
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { setLiveMode(m => !m); setToast(liveMode ? "Live updates paused" : "Live updates resumed"); setTimeout(() => setToast(null), 1500); }}
              title={liveMode ? "Pause live updates" : "Resume live updates"}
              className={cn("px-3 py-1.5 rounded-full border text-xs flex items-center gap-2 transition-all",
                liveMode ? "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20" : "bg-[#050b1e] border-slate-800/50 hover:border-slate-700")}
            >
              <div className={cn("w-2 h-2 rounded-full", liveMode && status === "connected" ? "bg-emerald-500 animate-pulse" : liveMode ? "bg-amber-500" : "bg-slate-500")} />
              <span className={cn("uppercase font-black text-[9px]", liveMode ? "text-emerald-400" : "text-slate-400")}>{liveMode ? "Live" : "Paused"}</span>
            </button>
            <button onClick={refreshAll} className="relative p-2 bg-[#050b1e] border border-slate-800/50 rounded-lg text-slate-400 hover:text-white transition-colors" title="Refresh all data">
              <RefreshCcw className="w-4 h-4" />
            </button>
            {/* Notifications bell */}
            <div className="relative">
              <button onClick={() => { setNotifOpen(o => !o); if (!notifOpen && anomalies[0]) setReadNotifKey(anomalyKey(anomalies[0])); }}
                className="relative p-2 bg-[#050b1e] border border-slate-800/50 rounded-lg text-slate-400 hover:text-white transition-colors" title="Notifications">
                <Bell className={cn("w-4 h-4", unreadCount > 0 && "text-blue-300")} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center pulse-ring">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <NotificationsPanel
                  anomalies={anomalies}
                  onClose={() => setNotifOpen(false)}
                  onPick={(a) => { setNotifOpen(false); runRCA(a); }}
                  onClear={() => { if (anomalies[0]) setReadNotifKey(anomalyKey(anomalies[0])); }}
                />
              )}
            </div>
            <button
              onClick={() => {
                const target = filteredAnomalies[0] || anomalies[0];
                if (target) { runRCA(target); }
                else { setToast("No incidents to analyze yet — waiting for anomalies"); setTimeout(() => setToast(null), 2500); }
              }}
              className="btn-pill-white flex items-center gap-2 px-5 py-2 text-[10px] font-black uppercase tracking-widest"
            >
              <Brain className="w-4 h-4 icon-bounce" />
              AI Assistant
            </button>
          </div>
        </header>

        {/* Keyed wrapper re-animates the whole view on every switch */}
        <div key={view} className="view-anim">
        {view === "Transactions" ? (
          <TransactionsView
            txns={txns}
            stats={txnStats}
            series={txnSeries}
            searchQuery={searchQuery}
            anomalies={anomalies}
            onInvestigate={(a) => { setView("Observability"); runRCA(a); }}
            onSelectTxn={setSelectedTxn}
            onConnect={() => setConnectOpen(true)}
            onLookup={lookupTxn}
          />
        ) : view === "Integrations" ? (
          <IntegrationsView data={integrations} anomalies={anomalies}
            onConnect={() => setConnectOpen(true)}
            onLookup={lookupTxn}
            onInvestigate={(a) => { setView("Observability"); runRCA(a); }} />
        ) : view === "Kubernetes" ? (
          <KubernetesView k8s={k8s} />
        ) : (
        <>
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <StatCard label="Throughput" value={summaryStats.throughput} trend={summaryStats.throughputTrend} icon={<Activity className="text-blue-400" />} color="blue" series={summaryStats.throughputSeries} delay={0} />
          <StatCard label="P99 Latency" value={summaryStats.p99} trend={summaryStats.latencyTrend} icon={<Clock3 className="text-rose-400" />} color="rose" series={summaryStats.p99Series} delay={90} />
          <StatCard label="Anomaly Rate" value={summaryStats.errorRate} trend={stats.total_traces > 0 ? `${stats.anomaly_count}/${stats.total_traces}` : "Normal"} icon={<Shield className="text-emerald-400" />} color="emerald" series={summaryStats.anomalySeries} delay={180} />
        </div>

        {/* Real-data-only notice: service metrics need a live telemetry source */}
        {appConfig && appConfig.simulator === false && chartData.length === 0 && (
          <div className="glass-card p-4 mb-8 flex items-center gap-3 border border-amber-500/20">
            <Activity className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-slate-400">
              <b className="text-slate-200">Real-data-only mode.</b> Service metrics (latency/throughput) need a live
              telemetry source, so these charts are empty — but real payment anomalies still appear in the incident
              stream below. See the <b className="text-slate-200">Transactions</b> &amp; <b className="text-slate-200">Integrations</b> views for your live payment data.
            </p>
          </div>
        )}

        {/* Chart View */}
        <div className="glass-card p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300">
              <BarChart3 className="w-4 h-4 text-blue-400" />
              {chartLabel}
            </h3>
            <div className="flex gap-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                {getMetricTypeForMode(monitoringMode) === "redaction_count" ? "Redactions" : "P99 Latency (ms)"}
              </span>
            </div>
          </div>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#182849" />
                <XAxis
                  dataKey="time"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0a1230', border: '1px solid #1e3a5f', borderRadius: '8px' }}
                  itemStyle={{ color: '#93c5fd', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="val" stroke="#93c5fd" strokeWidth={3} fillOpacity={1} fill="url(#colorVal)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Incident Stream */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
              Historical Incident Stream
            </h3>
            <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
              {isLoading ? (
                <div className="text-center py-12 text-slate-600 text-sm">
                  <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
                  Loading incidents...
                </div>
              ) : filteredAnomalies.length === 0 ? (
                <div className="text-center py-12 text-slate-600 text-sm">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  {searchQuery ? "No incidents match your search." : "No incidents detected yet. Generate traffic to see anomalies."}
                </div>
              ) : (
                filteredAnomalies.map((item, idx) => (
                  <AnomalyRow key={item.id ?? `${item.trace_id}-${item.timestamp}-${idx}`} item={item} onClick={() => runRCA(item)} />
                ))
              )}
            </div>
          </div>

          {/* Diagnostics Right Panel */}
          <div className="space-y-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400" />
              Diagnostic Center
            </h3>
            {selectedTrace ? (
              <div className="glass-morphism rounded-2xl p-6 border border-slate-800/50 animate-in fade-in slide-in-from-bottom-2 min-h-[500px] flex flex-col">
                <div className="flex justify-between items-start mb-6">
                  {(() => {
                    const ts = styleFor(selectedTrace.anomaly_type);
                    return (
                      <div>
                        <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest border", ts.text, ts.bg, ts.border)}>
                          {selectedTrace.anomaly_type || "Critical Severity"}
                        </span>
                        <h4 className="text-xl font-bold mt-2">{selectedTrace.anomaly_type ? `${selectedTrace.anomaly_type} in ${selectedTrace.service}` : `Critical Latency Spike in ${selectedTrace.service}`}</h4>
                        <p className="text-xs text-slate-400 flex items-center gap-2 mt-1">
                          <Server className="w-3 h-3" /> {selectedTrace.service} {selectedTrace.route ? `| ${selectedTrace.route}` : ""}
                        </p>
                      </div>
                    );
                  })()}
                  <button onClick={() => setSelectedTrace(null)} className="p-1 hover:bg-slate-800/50 rounded-full transition-colors">
                    <X className="w-4 h-4 text-slate-500" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-6 border-b border-slate-800/50 mb-6">
                  {["Overview", "Traces", "Logs", "Metrics", "Scores", "AI Analysis"].map(tab => (
                    <button
                      key={tab}
                      onClick={() => handleTabClick(tab)}
                      className={cn(
                        "pb-3 text-xs font-bold transition-all relative",
                        activeTab === tab ? "text-white" : "text-slate-500 hover:text-slate-300"
                      )}
                    >
                      {tab}
                      {activeTab === tab && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />}
                    </button>
                  ))}
                </div>

                <div className="flex-1">
                  {isAnalyzing ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500">
                      <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                      <p className="text-sm font-medium animate-pulse">Consulting AI Assistant...</p>
                    </div>
                  ) : activeTab === "AI Analysis" && analysis ? (
                    <div className="space-y-8 animate-in fade-in duration-500">
                      <div className="relative p-6 bg-blue-600/5 border border-blue-500/20 rounded-2xl overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10"><Brain size={80} /></div>
                        <h5 className="text-blue-400 text-xs font-black uppercase tracking-widest flex items-center gap-2 mb-4">
                          <Zap size={14} className="fill-blue-400" /> Root Cause Analysis
                        </h5>
                        <p className="text-lg font-bold text-slate-100 leading-tight mb-4 tracking-tight">
                          ✨ {analysis.root_cause}
                        </p>
                        <div className="grid grid-cols-2 gap-6 mt-8">
                          <div className="space-y-3">
                            <h6 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Suggested Fixes</h6>
                            <ul className="space-y-2">
                              {Array.isArray(analysis.suggested_fixes) ? analysis.suggested_fixes.map((f, i) => (
                                <li key={i} className="text-xs text-slate-400 flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 flex-shrink-0" />
                                  {f}
                                </li>
                              )) : (
                                <li className="text-xs text-slate-400 flex items-start gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 flex-shrink-0" />
                                  {analysis.suggested_fixes}
                                </li>
                              )}
                            </ul>
                          </div>
                          <div className="space-y-3">
                            <h6 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Risk Prediction</h6>
                            <p className="text-xs text-slate-400 leading-relaxed bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50">
                              {analysis.risk_prediction}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Visual Blocks — span waterfall when a trace exists,
                          otherwise incident context (payments / K8s / PII). */}
                      {(analysis.traceData?.spans?.length ?? 0) > 0 ? (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-slate-900/60 border border-slate-800/50 p-4 rounded-xl">
                          <h6 className="text-[9px] font-black text-slate-500 uppercase mb-3">Timeline</h6>
                          <div className="h-2 bg-slate-800/50 rounded-full relative overflow-hidden">
                            {analysis.traceData?.spans?.map((s, i) => (
                              <div key={i} className={cn("absolute h-full rounded-full", s.type === "API" ? "bg-blue-500" : s.type === "DATABASE" ? "bg-rose-500" : "bg-emerald-500")}
                                style={{
                                  left: `${((s.start || 0) / (analysis.traceData.duration_ms || 1)) * 100}%`,
                                  width: `${Math.max(4, ((s.duration || 0) / (analysis.traceData.duration_ms || 1)) * 100)}%`,
                                }} />
                            ))}
                          </div>
                          <div className="flex justify-between text-[8px] text-slate-600 mt-2 font-mono">
                            <span>0ms</span>
                            <span className="text-rose-400">{((analysis.traceData?.duration_ms ?? 0) / 2).toFixed(0)}ms</span>
                            <span>{(analysis.traceData?.duration_ms ?? 0).toFixed(0)}ms</span>
                          </div>
                        </div>
                        <div className="bg-slate-900/60 border border-slate-800/50 p-4 rounded-xl">
                          <h6 className="text-[9px] font-black text-slate-500 uppercase mb-3">Affected Services</h6>
                          <div className="flex items-center justify-center gap-2 flex-wrap">
                            {[...new Set(analysis.traceData?.spans?.map(s => s.service) || [])].map((svc, i, arr) => (
                              <React.Fragment key={svc}>
                                <div className={cn("px-2 py-1 rounded text-[8px] font-bold border",
                                  i === arr.length - 1 ? "bg-rose-500/20 border-rose-500/50 text-rose-300" : "bg-slate-800/50 border-slate-700 text-slate-400"
                                )}>{svc}</div>
                                {i < arr.length - 1 && <div className="w-3 h-px bg-slate-700" />}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                        <div className="bg-slate-900/60 border border-slate-800/50 p-4 rounded-xl">
                          <h6 className="text-[9px] font-black text-slate-500 uppercase mb-3">Span Breakdown</h6>
                          <div className="space-y-1.5">
                            {(analysis.traceData?.spans || []).slice(0, 4).map((s, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <div className={cn("h-1 rounded-full", s.type === "API" ? "bg-blue-500" : s.type === "DATABASE" ? "bg-rose-500" : "bg-emerald-500")}
                                  style={{ width: `${Math.max(10, ((s.duration || 0) / (analysis.traceData.duration_ms || 1)) * 100)}%` }} />
                                <span className="text-[7px] text-slate-500 flex-shrink-0">{(s.duration || 0).toFixed(0)}ms</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      ) : (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-slate-900/60 border border-slate-800/50 p-4 rounded-xl">
                          <h6 className="text-[9px] font-black text-slate-500 uppercase mb-3">Incident Source</h6>
                          <div className="space-y-2">
                            <div>
                              <div className="text-[8px] text-slate-600 uppercase font-bold">Service</div>
                              <div className="text-xs font-bold text-blue-300">{selectedTrace?.service || "—"}</div>
                            </div>
                            <div>
                              <div className="text-[8px] text-slate-600 uppercase font-bold">Route / Target</div>
                              <div className="text-[10px] font-mono text-slate-300 break-all">{selectedTrace?.route || "—"}</div>
                            </div>
                          </div>
                        </div>
                        <div className="bg-slate-900/60 border border-slate-800/50 p-4 rounded-xl">
                          <h6 className="text-[9px] font-black text-slate-500 uppercase mb-3">Key Signals</h6>
                          <div className="flex flex-wrap gap-1.5">
                            {(() => {
                              const flags = selectedTrace?.rule_flags || {};
                              const pills = RULE_PILLS
                                .map(p => ({ ...p, active: !!flags[p.key], meta: flags[p.metaKey] }))
                                .filter(p => p.active);
                              if (!pills.length) return <span className="text-[10px] text-slate-600 italic">ML ensemble detection</span>;
                              return pills.map(p => {
                                const detail = p.fmt(p.meta);
                                return (
                                  <span key={p.key} className={cn("text-[9px] font-bold px-2 py-0.5 rounded border", PILL_COLOR[p.color])}>
                                    {p.label}{detail ? ` ${detail}` : ""}
                                  </span>
                                );
                              });
                            })()}
                          </div>
                        </div>
                        <div className="bg-slate-900/60 border border-slate-800/50 p-4 rounded-xl">
                          <h6 className="text-[9px] font-black text-slate-500 uppercase mb-3">Severity</h6>
                          {(() => {
                            const score = selectedTrace?.anomaly_score ?? 0;
                            const level = score >= 0.8 ? "Critical" : score >= 0.5 ? "Warning" : "Low Risk";
                            const color = score >= 0.8 ? "text-rose-400" : score >= 0.5 ? "text-amber-400" : "text-emerald-400";
                            return (
                              <div className="space-y-2">
                                <div className={cn("text-2xl font-black", color)}>{score.toFixed(2)}</div>
                                <div className={cn("text-[10px] font-black uppercase tracking-widest", color)}>{level}</div>
                                <div className="text-[9px] text-slate-500">{selectedTrace?.anomaly_type || "Unclassified"}</div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      )}

                      <div className="flex justify-end gap-3 pt-4 border-t border-slate-800/50">
                        <button onClick={() => setSelectedTrace(null)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-white transition-colors">Dismiss</button>
                        <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(analysis, null, 2)); alert("Analysis copied to clipboard — ticket created (demo mode)"); }} className="px-6 py-2 bg-white text-slate-950 text-xs font-black uppercase tracking-tight rounded-lg hover:bg-slate-200 transition-colors">Create Ticket</button>
                      </div>
                    </div>
                  ) : activeTab === "Traces" && traceContext ? (
                    <div className="space-y-4 animate-in fade-in">
                      <div className="flex justify-between items-center mb-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Detailed Waterfall</label>
                        <span className="text-[10px] text-slate-500 font-mono">Total Duration: {(traceContext.duration_ms ?? 0).toFixed(2)}ms</span>
                      </div>
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {traceContext.spans.map((span, i) => (
                          <div key={i} className="group">
                            <div className="flex justify-between text-[10px] mb-1">
                              <span className="text-slate-300 font-bold">{span.service} <span className="text-slate-500 font-medium">| {span.name}</span></span>
                              <span className="text-slate-500 tabular-nums">{span.duration.toFixed(1)}ms</span>
                            </div>
                            <div className="h-2 bg-slate-900 rounded-full relative overflow-hidden ring-1 ring-slate-800/60">
                              <div
                                className={cn(
                                  "absolute h-full rounded-full transition-all duration-1000",
                                  span.type === "API" ? "bg-blue-500" : span.type === "DATABASE" ? "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]" : "bg-emerald-500"
                                )}
                                style={{
                                  left: `${(span.start / traceContext.duration_ms) * 100}%`,
                                  width: `${(span.duration / traceContext.duration_ms) * 100}%`,
                                  minWidth: '2px'
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : activeTab === "Logs" ? (
                    <div className="space-y-4 animate-in fade-in">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <FileText className="w-3 h-3" /> Correlated Logs
                        </label>
                        <span className="text-[10px] text-slate-500 font-mono">{traceLogs.length} log{traceLogs.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="max-h-[350px] overflow-y-auto pr-2 custom-scrollbar space-y-1">
                        {traceLogs.length === 0 ? (
                          <div className="text-center py-12 text-slate-600 text-xs">
                            {traceLogsLoading ? "Loading logs..." : "No logs found for this trace"}
                          </div>
                        ) : (
                          traceLogs.map((log, idx) => (
                            <LogRow key={idx} log={log} />
                          ))
                        )}
                      </div>
                    </div>
                  ) : activeTab === "Overview" && selectedTrace ? (
                    <div className="space-y-4 animate-in fade-in">
                      {(() => {
                        const flags = selectedTrace.rule_flags || {};
                        const activePills = RULE_PILLS
                          .map(p => ({ ...p, active: !!flags[p.key], meta: flags[p.metaKey] }))
                          .filter(p => p.active);
                        const mlScores = selectedTrace.ml_scores || {};
                        const mlEntries = Object.entries(mlScores);
                        if (!activePills.length && !mlEntries.length) return null;
                        return (
                          <div className="bg-[#050b1e]/50 p-4 rounded-lg border border-slate-800/50 space-y-4">
                            {activePills.length > 0 && (
                              <div>
                                <div className="text-[9px] text-slate-500 uppercase font-bold mb-2 tracking-widest">Detectors Fired</div>
                                <div className="flex flex-wrap gap-2">
                                  {activePills.map(p => {
                                    const detail = p.fmt(p.meta);
                                    return (
                                      <span key={p.key} className={cn("text-[10px] font-bold px-2 py-0.5 rounded border", PILL_COLOR[p.color])}>
                                        {p.label}{detail ? ` ${detail}` : ""}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {mlEntries.length > 0 && (
                              <div>
                                <div className="text-[9px] text-slate-500 uppercase font-bold mb-2 tracking-widest">ML Scores</div>
                                <div className="space-y-2">
                                  {mlEntries.map(([name, val]) => {
                                    const pct = Math.max(0, Math.min(1, Number(val) || 0)) * 100;
                                    return (
                                      <div key={name}>
                                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                          <span className="font-mono">{name}</span>
                                          <span className="font-bold text-slate-200">{pct.toFixed(1)}%</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden ring-1 ring-slate-800/60">
                                          <div className="h-full bg-sky-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Incident Overview</label>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50">
                          <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Service</div>
                          <div className="text-sm font-bold text-slate-200">{selectedTrace.service}</div>
                        </div>
                        <div className="bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50">
                          <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Route</div>
                          <div className="text-sm font-bold text-slate-200">{selectedTrace.route || "—"}</div>
                        </div>
                        <div className="bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50">
                          <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Duration</div>
                          <div className="text-sm font-bold text-rose-400">{(selectedTrace.duration_ms ?? 0).toFixed(1)}ms</div>
                        </div>
                        <div className="bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50">
                          <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Anomaly Score</div>
                          <div className="text-sm font-bold text-amber-400">{(selectedTrace.anomaly_score ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50 col-span-2">
                          <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Trace ID</div>
                          <div className="text-xs font-mono text-blue-400 break-all">{selectedTrace.trace_id}</div>
                        </div>
                        <div className="bg-[#050b1e]/50 p-3 rounded-lg border border-slate-800/50 col-span-2">
                          <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Timestamp</div>
                          <div className="text-xs text-slate-300">{selectedTrace.timestamp ? new Date(selectedTrace.timestamp).toLocaleString() : "—"}</div>
                        </div>
                      </div>
                      {traceContext && (
                        <div className="mt-2 text-[10px] text-slate-500">
                          {traceContext.spans.length} span{traceContext.spans.length !== 1 ? "s" : ""} reconstructed
                        </div>
                      )}
                    </div>
                  ) : activeTab === "Metrics" && selectedTrace ? (
                    <div className="space-y-4 animate-in fade-in">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Service Metrics — {selectedTrace.service}</label>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#182849" />
                            <XAxis dataKey="time" stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#64748b" fontSize={9} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: '#0a1230', border: '1px solid #1e3a5f', borderRadius: '8px' }} itemStyle={{ color: '#93c5fd', fontWeight: 'bold' }} />
                            <Area type="monotone" dataKey="val" stroke="#93c5fd" strokeWidth={2} fillOpacity={0.2} fill="#60a5fa" isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="text-[10px] text-slate-500 italic">
                        Showing {getMetricTypeForMode(monitoringMode)} for {selectedService === "All Services" ? "all services" : selectedService}
                      </div>
                    </div>
                  ) : activeTab === "Scores" && selectedTrace ? (
                    <div className="space-y-5 animate-in fade-in max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                      {/* ── Anomaly Score Gauge ─────────────────────── */}
                      <div className="bg-[#050b1e]/50 p-5 rounded-xl border border-slate-800/50">
                        <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-4">Anomaly Score</div>
                        <div className="flex items-center gap-6">
                          <div className="relative w-20 h-20 flex-shrink-0">
                            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                              <circle cx="18" cy="18" r="15.91" fill="none" stroke="#182849" strokeWidth="3" />
                              <circle cx="18" cy="18" r="15.91" fill="none"
                                stroke={(() => {
                                  const s = selectedTrace.anomaly_score ?? 0;
                                  if (s >= 0.8) return "#f43f5e";
                                  if (s >= 0.5) return "#f59e0b";
                                  return "#34d399";
                                })()}
                                strokeWidth="3" strokeLinecap="round"
                                strokeDasharray={`${(selectedTrace.anomaly_score ?? 0) * 100} ${100 - (selectedTrace.anomaly_score ?? 0) * 100}`}
                                className="transition-all duration-1000"
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-lg font-black text-white">{(selectedTrace.anomaly_score ?? 0).toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">Classification</span>
                              <span className={cn("font-bold",
                                (selectedTrace.anomaly_score ?? 0) >= 0.8 ? "text-rose-400" :
                                (selectedTrace.anomaly_score ?? 0) >= 0.5 ? "text-amber-400" : "text-emerald-400"
                              )}>
                                {(selectedTrace.anomaly_score ?? 0) >= 0.8 ? "Critical" :
                                 (selectedTrace.anomaly_score ?? 0) >= 0.5 ? "Warning" : "Low Risk"}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">Anomaly Type</span>
                              <span className={cn("font-bold", styleFor(selectedTrace.anomaly_type).text)}>
                                {selectedTrace.anomaly_type || "Unclassified"}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">Is Anomaly</span>
                              <span className={cn("font-bold", selectedTrace.is_anomaly ? "text-rose-400" : "text-emerald-400")}>
                                {selectedTrace.is_anomaly ? "Yes" : "No"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── ML Model Scores ────────────────────────── */}
                      {(() => {
                        const mlScores = selectedTrace.ml_scores || {};
                        const mlEntries = Object.entries(mlScores);
                        if (!mlEntries.length) return null;
                        return (
                          <div className="bg-[#050b1e]/50 p-5 rounded-xl border border-slate-800/50">
                            <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-4">ML Ensemble Scores</div>
                            <div className="space-y-3">
                              {mlEntries.map(([name, val]) => {
                                const pct = Math.max(0, Math.min(1, Number(val) || 0)) * 100;
                                const isHigh = pct > 70;
                                const isMed = pct > 40;
                                return (
                                  <div key={name}>
                                    <div className="flex justify-between text-[11px] mb-1.5">
                                      <span className="text-slate-300 font-medium font-mono">{name}</span>
                                      <span className={cn("font-black tabular-nums",
                                        isHigh ? "text-rose-400" : isMed ? "text-amber-400" : "text-emerald-400"
                                      )}>{Number(val).toFixed(3)}</span>
                                    </div>
                                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden ring-1 ring-slate-800/60">
                                      <div
                                        className={cn("h-full rounded-full transition-all duration-700",
                                          isHigh ? "bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.4)]" :
                                          isMed ? "bg-gradient-to-r from-amber-600 to-amber-400" :
                                          "bg-gradient-to-r from-emerald-600 to-emerald-400"
                                        )}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-800/50 flex justify-between text-[10px]">
                              <span className="text-slate-500">Ensemble Average</span>
                              <span className="text-white font-bold">
                                {(mlEntries.reduce((sum, [, v]) => sum + (Number(v) || 0), 0) / mlEntries.length).toFixed(3)}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── Rule Detectors ─────────────────────────── */}
                      {(() => {
                        const flags = selectedTrace.rule_flags || {};
                        return (
                          <div className="bg-[#050b1e]/50 p-5 rounded-xl border border-slate-800/50">
                            <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-4">Rule Detector Flags</div>
                            <div className="space-y-2">
                              {RULE_PILLS.map(pill => {
                                const active = !!flags[pill.key];
                                const meta = flags[pill.metaKey];
                                const detail = pill.fmt(meta);
                                return (
                                  <div key={pill.key} className={cn(
                                    "flex items-center justify-between p-2.5 rounded-lg border transition-all",
                                    active
                                      ? `${PILL_COLOR[pill.color]} border-opacity-50`
                                      : "bg-slate-900/40 border-slate-800/50 text-slate-600"
                                  )}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={cn("w-2 h-2 rounded-full",
                                        active ? `bg-${pill.color}-500 shadow-[0_0_6px_rgba(255,255,255,0.2)]` : "bg-slate-700"
                                      )} />
                                      <span className={cn("text-[11px] font-bold", active ? "" : "text-slate-600")}>{pill.label}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {detail && <span className="text-[10px] font-mono font-bold">{detail}</span>}
                                      <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded",
                                        active ? "bg-white/10 text-white" : "bg-slate-800/50 text-slate-600"
                                      )}>{active ? "FIRED" : "CLEAR"}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── Detector Reasons ───────────────────────── */}
                      {(selectedTrace.reasons || []).length > 0 && (
                        <div className="bg-[#050b1e]/50 p-5 rounded-xl border border-slate-800/50">
                          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-3">Detector Reason Tags</div>
                          <div className="flex flex-wrap gap-2">
                            {selectedTrace.reasons.map((reason, i) => (
                              <span key={i} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/30">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Event Attributes Grid ──────────────────── */}
                      <div className="bg-[#050b1e]/50 p-5 rounded-xl border border-slate-800/50">
                        <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-4">Event Attributes</div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: "Service", value: selectedTrace.service, color: "text-blue-400" },
                            { label: "Route", value: selectedTrace.route || "—", color: "text-slate-200" },
                            { label: "Duration", value: `${(selectedTrace.duration_ms ?? 0).toFixed(1)}ms`, color: "text-rose-400" },
                            { label: "Anomaly Score", value: (selectedTrace.anomaly_score ?? 0).toFixed(4), color: "text-amber-400" },
                            { label: "Trace ID", value: selectedTrace.trace_id, color: "text-blue-400", mono: true, span: true },
                            { label: "Timestamp", value: selectedTrace.timestamp ? new Date(selectedTrace.timestamp).toLocaleString() : "—", color: "text-slate-300", span: true },
                          ].map((attr, i) => (
                            <div key={i} className={cn("bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/40", attr.span ? "col-span-2" : "")}>
                              <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">{attr.label}</div>
                              <div className={cn("text-xs font-bold break-all", attr.color, attr.mono ? "font-mono" : "")}>{attr.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Raw Event JSON ─────────────────────────── */}
                      <div className="bg-[#050b1e]/50 p-5 rounded-xl border border-slate-800/50">
                        <div className="flex justify-between items-center mb-3">
                          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Raw Anomaly Event</div>
                          <button
                            onClick={() => navigator.clipboard.writeText(JSON.stringify(selectedTrace, null, 2))}
                            className="text-[9px] text-blue-400 hover:text-blue-300 font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-blue-500/30 hover:border-blue-500/50 transition-all"
                          >
                            Copy JSON
                          </button>
                        </div>
                        <pre className="text-[10px] text-slate-400 font-mono bg-slate-900/60 p-3 rounded-lg border border-slate-800/40 max-h-48 overflow-y-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
                          {JSON.stringify(selectedTrace, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : activeTab === "AI Analysis" ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500">
                      <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                      <p className="text-sm font-medium animate-pulse">Preparing incident context…</p>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">
                      Select a tab to view data.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-20 text-center border-2 border-dashed border-slate-800/50 rounded-2xl text-slate-500">
                <Search className="w-10 h-10 mx-auto mb-4 opacity-20" />
                <p className="text-sm font-medium">Select an incident to investigate root cause</p>
              </div>
            )}
          </div>
        </div>
        {/* PII Redaction Density — paper §IV-C novel security primitive */}
        <div className="mt-8">
          <PIIRedactionPanel backendUrl={BACKEND_URL} />
        </div>
        </>
        )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 text-xs font-bold text-slate-200 animate-in fade-in slide-in-from-bottom-2 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          {toast}
        </div>
      )}

      {/* Transaction detail drawer */}
      {selectedTxn && (
        <TxnDrawer txn={selectedTxn} onClose={() => setSelectedTxn(null)}
          onToast={(m) => { setToast(m); setTimeout(() => setToast(null), 2000); }}
          onInvestigate={(a) => { setSelectedTxn(null); setView("Observability"); runRCA(a); }} />
      )}

      {/* Command palette */}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          services={SERVICE_NAV}
          gateways={(txnStats?.gateway_breakdown || []).map(g => g.gateway)}
          actions={{
            setView: (v) => setView(v),
            setService: (s) => { setSelectedService(s); setView("Observability"); },
            toggleLive: () => setLiveMode(m => !m),
            refresh: refreshAll,
            runAI: () => { const t = filteredAnomalies[0] || anomalies[0]; if (t) runRCA(t); },
            connect: () => setConnectOpen(true),
          }}
        />
      )}

      {/* Per-gateway connect wizard */}
      {connectOpen && (
        <ConnectWizard appConfig={appConfig} integrations={integrations} backendUrl={BACKEND_URL}
          onClose={() => setConnectOpen(false)}
          onToast={(m) => { setToast(m); setTimeout(() => setToast(null), 2000); }} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONS VIEW — universal real-time payment monitoring
// ═══════════════════════════════════════════════════════════════════

const PAYMENT_ANOMALY_TYPES = new Set(["Payment Failure Spike", "Gateway Timeout", "Fraud Velocity", "Duplicate Charge"]);

const METHOD_ICON = {
  UPI: Zap, CREDIT_CARD: CreditCard, DEBIT_CARD: CreditCard,
  NET_BANKING: Globe, WALLET: Wallet, BANK_TRANSFER: Server, BNPL: Clock3,
};

function TransactionsView({ txns, stats, series, searchQuery, anomalies, onInvestigate, onSelectTxn, onConnect }) {
  const [statusFilter, setStatusFilter] = useState("All");
  const [methodFilter, setMethodFilter] = useState("All");
  const [gatewayFilter, setGatewayFilter] = useState("All");

  // Gateway options: union of gateways seen in the stats breakdown and the
  // currently loaded feed, so real (Razorpay/Stripe/custom) gateways appear
  // automatically the moment they show up.
  const gatewayOptions = useMemo(() => {
    const set = new Set();
    (stats?.gateway_breakdown || []).forEach(g => g.gateway && set.add(g.gateway));
    txns.forEach(t => t.gateway && set.add(t.gateway));
    return ["All", ...[...set].sort()];
  }, [stats, txns]);

  const filteredTxns = useMemo(() => {
    let list = txns;
    if (statusFilter !== "All") list = list.filter(t => t.status === statusFilter);
    if (methodFilter !== "All") list = list.filter(t => t.method === methodFilter);
    if (gatewayFilter !== "All") list = list.filter(t => t.gateway === gatewayFilter);
    const tokens = searchQuery.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (tokens.length) {
      list = list.filter(t => {
        const hay = [t.txn_id, t.order_id, t.provider, t.gateway, t.method, t.txn_type, t.status, t.currency]
          .filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, "");
        return tokens.every(tok => hay.includes(tok.replace(/\s+/g, "")));
      });
    }
    return list.slice(0, 30);
  }, [txns, statusFilter, methodFilter, gatewayFilter, searchQuery]);

  const paymentIncidents = useMemo(
    () => anomalies.filter(a => PAYMENT_ANOMALY_TYPES.has(a.anomaly_type)).slice(0, 4),
    [anomalies]
  );

  const successRateSeries = series.map(p => p.success_rate);
  const tpsSeries = series.map(p => p.tps);
  const failedSeries = series.map(p => p.failedDelta);
  const volumeSeries = series.map(p => p.volumeDelta);
  const lastVolumeDelta = series.length ? series[series.length - 1].volumeDelta : 0;
  const lastTps = series.length ? series[series.length - 1].tps : 0;
  const flowData = series.slice(-40).map(p => ({ time: p.time, success: p.successDelta, failed: p.failedDelta }));
  const methodMax = Math.max(1, ...(stats?.method_breakdown || []).map(m => m.count));

  // KPI values — global by default, but rescoped to the selected gateway so
  // picking "Razorpay" makes the whole top row reflect Razorpay only.
  const scoped = gatewayFilter !== "All";
  const gwRow = scoped ? (stats?.gateway_breakdown || []).find(g => g.gateway === gatewayFilter) : null;
  const kpi = scoped
    ? {
        total: gwRow?.count ?? 0,
        success: gwRow?.success ?? 0,
        failed: gwRow?.failed ?? 0,
        volume: gwRow?.volume ?? 0,
        successRate: gwRow?.count ? ((gwRow.success ?? 0) / gwRow.count) * 100 : 0,
      }
    : {
        total: stats?.total ?? 0,
        success: stats?.success ?? 0,
        failed: stats?.failed ?? 0,
        volume: stats?.volume_inr ?? 0,
        successRate: stats?.success_rate ?? 0,
      };

  return (
    <div className="space-y-8 animate-in fade-in">
      {scoped && (
        <div className="flex items-center gap-3 -mb-2">
          <span className="text-xs font-black uppercase tracking-widest text-blue-300 bg-blue-500/10 border border-blue-500/30 px-3 py-1 rounded-lg">
            {gatewayFilter} — dedicated view
          </span>
          <button onClick={() => setGatewayFilter("All")} className="text-[11px] text-slate-500 hover:text-slate-300 font-bold">← back to all gateways</button>
        </div>
      )}
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-6">
        <StatCard label={scoped ? `${gatewayFilter} Success Rate` : "Success Rate"} value={`${(kpi.successRate ?? 0).toFixed(1)}%`}
          trend={`${(kpi.success ?? 0).toLocaleString("en-IN")} OK`} color="emerald" series={scoped ? [] : successRateSeries} delay={0} />
        <StatCard label={scoped ? `${gatewayFilter} Volume` : "Volume Processed"} value={fmtINRCompact(kpi.volume ?? 0)}
          trend={scoped ? `${gatewayFilter}` : (lastVolumeDelta > 0 ? `+${fmtINRCompact(lastVolumeDelta)}` : "LIVE")} color="blue" series={scoped ? [] : volumeSeries} delay={80} />
        <StatCard label={scoped ? `${gatewayFilter} Transactions` : "Transactions"} value={(kpi.total ?? 0).toLocaleString("en-IN")}
          trend={scoped ? `${(kpi.total ? (kpi.failed / kpi.total * 100) : 0).toFixed(1)}% failed` : `${lastTps} TPS`} color="amber" series={scoped ? [] : tpsSeries} delay={160} />
        <StatCard label={scoped ? `${gatewayFilter} Failed` : "Failed"} value={(kpi.failed ?? 0).toLocaleString("en-IN")}
          trend={stats?.top_failure_reasons?.[0]?.failure_reason || "—"} color="rose" series={scoped ? [] : failedSeries} delay={240} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="glass-card p-6">
          <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Payment Flow (per second)
          </h3>
          <div className="h-56">
            {flowData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-600">Collecting live data…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowData}>
                  <defs>
                    <linearGradient id="flow-ok" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="flow-fail" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#182849" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={9} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0a1230', border: '1px solid #1e3a5f', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="success" stackId="1" stroke="#34d399" strokeWidth={2} fill="url(#flow-ok)" isAnimationActive={false} name="Success" />
                  <Area type="monotone" dataKey="failed" stackId="1" stroke="#f43f5e" strokeWidth={2} fill="url(#flow-fail)" isAnimationActive={false} name="Failed" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="glass-card p-6 space-y-5">
          <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            Method &amp; Gateway Health
          </h3>
          <div className="space-y-2.5">
            {(stats?.method_breakdown || []).map(m => {
              const Icon = METHOD_ICON[m.method] || CreditCard;
              const okPct = m.count > 0 ? (m.success / m.count) * 100 : 0;
              return (
                <div key={m.method} className="flex items-center gap-3">
                  <Icon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span className="text-[11px] text-slate-300 font-bold w-28 flex-shrink-0">{m.method}</span>
                  <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden ring-1 ring-slate-800/60">
                    <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700"
                      style={{ width: `${(m.count / methodMax) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums w-12 text-right">{m.count}</span>
                  <span className={cn("text-[10px] font-bold tabular-nums w-14 text-right",
                    okPct >= 90 ? "text-emerald-400" : okPct >= 75 ? "text-amber-400" : "text-rose-400")}>
                    {okPct.toFixed(0)}% ok
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pt-4 border-t border-slate-800/50 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-2">Top Failure Reasons</div>
              <div className="space-y-1">
                {(stats?.top_failure_reasons || []).slice(0, 4).map(f => (
                  <div key={f.failure_reason} className="flex justify-between text-[10px]">
                    <span className="text-rose-300 font-mono truncate pr-2">{f.failure_reason}</span>
                    <span className="text-slate-500 tabular-nums">{f.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-2">Gateway Failure Rate</div>
              <div className="space-y-1">
                {(stats?.gateway_breakdown || []).slice(0, 4).map(g => {
                  const failPct = g.count > 0 ? (g.failed / g.count) * 100 : 0;
                  return (
                    <div key={g.gateway} className="flex justify-between text-[10px]">
                      <span className="text-slate-300 truncate pr-2">{g.gateway}</span>
                      <span className={cn("font-bold tabular-nums", failPct > 15 ? "text-rose-400" : "text-emerald-400")}>
                        {failPct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active payment incidents */}
      {paymentIncidents.length > 0 && (
        <div className="bg-rose-950/20 border border-rose-500/20 rounded-2xl p-5">
          <h3 className="text-xs font-black uppercase tracking-widest text-rose-400 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            Active Payment Incidents
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {paymentIncidents.map((a, i) => {
              const st = styleFor(a.anomaly_type);
              return (
                <button key={a.id ?? `${a.trace_id}-${i}`} onClick={() => onInvestigate(a)}
                  className="text-left bg-slate-900/60 border border-slate-800/50 hover:border-rose-500/40 rounded-xl p-3 transition-all group">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", st.text, st.bg, st.border)}>
                      {a.anomaly_type}
                    </span>
                    <span className="text-[9px] text-slate-500">{new Date(a.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-xs text-slate-300 mt-1.5 font-medium">{a.service} <span className="text-slate-500">→ {a.route}</span></div>
                  <div className="text-[9px] text-blue-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to investigate →</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Live transaction feed */}
      <div className="glass-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300">
            <Activity className="w-4 h-4 text-emerald-400" />
            Live Transaction Feed
            <span className="flex items-center gap-1.5 ml-2 text-[9px] font-black text-emerald-500 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> streaming
            </span>
            <span className="text-[9px] text-slate-600 font-normal normal-case">· click a row for details</span>
            <button onClick={onConnect} className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-blue-500/30 bg-blue-500/10 text-[9px] font-black uppercase tracking-wider text-blue-300 hover:bg-blue-500/20 transition-colors normal-case">
              <Radio className="w-2.5 h-2.5" /> Connect Gateway
            </button>
          </h3>
          <div className="flex items-center gap-2">
            {["All", "SUCCESS", "FAILED", "PENDING"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all",
                  statusFilter === s
                    ? (TXN_STATUS_STYLE[s] || "bg-blue-500/10 text-blue-300 border-blue-500/30")
                    : "bg-[#050b1e] text-slate-500 border-slate-800/50 hover:text-slate-300")}>
                {s}
              </button>
            ))}
            <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
              className="bg-[#050b1e] border border-slate-800/50 rounded-lg px-2 py-1 text-[10px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
              {["All", "UPI", "CREDIT_CARD", "DEBIT_CARD", "NET_BANKING", "WALLET", "BANK_TRANSFER", "BNPL"].map(m => (
                <option key={m} value={m}>{m === "All" ? "All Methods" : m}</option>
              ))}
            </select>
            <select value={gatewayFilter} onChange={e => setGatewayFilter(e.target.value)}
              className={cn("border rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500",
                gatewayFilter === "All" ? "bg-[#050b1e] border-slate-800/50 text-slate-300" : "bg-blue-500/10 border-blue-500/40 text-blue-300 font-bold")}>
              {gatewayOptions.map(g => (
                <option key={g} value={g}>{g === "All" ? "All Gateways" : g}</option>
              ))}
            </select>
          </div>
        </div>
        {gatewayFilter !== "All" && (() => {
          const g = (stats?.gateway_breakdown || []).find(x => x.gateway === gatewayFilter);
          const failPct = g && g.count ? (g.failed / g.count) * 100 : 0;
          return (
            <div className="flex items-center gap-2 mb-2 text-[10px]">
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 font-bold text-blue-300">
                {gatewayFilter} only
              </span>
              {g && (
                <>
                  <span className="text-slate-500">{g.count} txns</span>
                  <span className={cn("font-bold", failPct > 15 ? "text-rose-400" : "text-emerald-400")}>
                    {failPct.toFixed(1)}% failed
                  </span>
                </>
              )}
              <button onClick={() => setGatewayFilter("All")} className="text-slate-500 hover:text-slate-300 ml-1">clear</button>
            </div>
          );
        })()}
        <div className="grid grid-cols-[80px_1fr_90px_1.2fr_90px_110px_70px_110px] gap-2 px-3 pb-2 text-[9px] font-black uppercase tracking-widest text-slate-600 border-b border-slate-800/50">
          <span>Time</span><span>Transaction</span><span>Type</span><span>Method / Provider</span><span>Gateway</span><span className="text-right">Amount</span><span className="text-right">Latency</span><span className="text-right">Status</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto custom-scrollbar divide-y divide-slate-800/40">
          {filteredTxns.length === 0 ? (
            <div className="text-center py-12 text-slate-600 text-xs">No transactions match the current filters.</div>
          ) : (
            filteredTxns.map(t => <TxnRow key={t.txn_id} txn={t} onClick={() => onSelectTxn?.(t)} />)
          )}
        </div>
      </div>
    </div>
  );
}

function TxnRow({ txn, onClick }) {
  const Icon = METHOD_ICON[txn.method] || CreditCard;
  return (
    <div onClick={onClick} className="row-accent cursor-pointer grid grid-cols-[80px_1fr_90px_1.2fr_90px_110px_70px_110px] gap-2 px-3 py-2.5 items-center hover:bg-slate-800/25 animate-in fade-in slide-in-from-top-1">
      <span className="text-[10px] text-slate-500 tabular-nums font-mono">{new Date(txn.timestamp).toLocaleTimeString()}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-mono text-blue-300 truncate">{txn.txn_id}</div>
        <div className="text-[9px] text-slate-600 font-mono truncate">{txn.order_id} · {txn.user}</div>
      </div>
      <span className="text-[9px] font-bold text-slate-400 uppercase">{txn.txn_type}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className="w-3 h-3 text-slate-500 flex-shrink-0" />
        <span className="text-[10px] text-slate-300 truncate">{txn.provider}</span>
      </div>
      <span className="text-[10px] text-slate-500 truncate">{txn.gateway}</span>
      <span className="text-[11px] font-bold text-slate-100 tabular-nums text-right">{fmtAmount(txn.amount, txn.currency)}</span>
      <span className={cn("text-[10px] tabular-nums text-right", (txn.latency_ms ?? 0) > 3000 ? "text-rose-400" : "text-slate-500")}>
        {(txn.latency_ms ?? 0).toFixed(0)}ms
      </span>
      <div className="text-right">
        <span className={cn("inline-block text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", TXN_STATUS_STYLE[txn.status] || "bg-slate-500/10 text-slate-400 border-slate-500/30")}>
          {txn.status}
        </span>
        {txn.status === "FAILED" && txn.failure_reason && (
          <div className="text-[8px] text-rose-400/70 font-mono mt-0.5 truncate" title={txn.failure_reason}>{txn.failure_reason}</div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// KUBERNETES VIEW — live cluster state
// ═══════════════════════════════════════════════════════════════════

function K8sBar({ pct, danger = 80 }) {
  return (
    <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden ring-1 ring-slate-800/60">
      <div className={cn("h-full rounded-full transition-all duration-700",
        pct >= danger ? "bg-gradient-to-r from-rose-600 to-rose-400" :
        pct >= danger * 0.75 ? "bg-gradient-to-r from-amber-600 to-amber-400" :
        "bg-gradient-to-r from-emerald-600 to-emerald-400")}
        style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function podAge(startedAt) {
  const mins = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${Math.floor(mins)}m`;
  return `${Math.floor(mins / 60)}h${Math.floor(mins % 60)}m`;
}

function KubernetesView({ k8s }) {
  if (k8s?.disabled) {
    return (
      <div className="glass-card p-12 text-center animate-in fade-in">
        <Boxes className="w-12 h-12 mx-auto mb-4 text-slate-600" />
        <div className="text-lg font-bold text-slate-300 mb-2">No live cluster connected</div>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Synthetic data is off (real-data-only mode). Kubernetes monitoring needs a real
          cluster telemetry source — connect one to populate this view.
        </p>
      </div>
    );
  }
  if (!k8s) {
    return (
      <div className="py-24 text-center text-slate-600 text-sm">
        <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
        Connecting to cluster…
      </div>
    );
  }
  const s = k8s.summary;
  return (
    <div className="space-y-8 animate-in fade-in">
      {/* Cluster KPIs */}
      <div className="grid grid-cols-4 gap-6">
        {[
          { label: "Nodes Ready", value: `${s.nodes_ready}/${s.nodes_total}`, trend: "Healthy", color: "emerald" },
          { label: "Pods Running", value: `${s.pods_running}/${s.pods_total}`, trend: `${s.total_restarts} restarts`, color: s.pods_running === s.pods_total ? "emerald" : "rose" },
          { label: "Cluster CPU", value: `${s.cluster_cpu_pct}%`, trend: s.cluster_cpu_pct > 80 ? "Critical" : "Normal", color: "blue" },
          { label: "Cluster Memory", value: `${s.cluster_mem_pct}%`, trend: s.cluster_mem_pct > 80 ? "Pressure" : "Normal", color: "amber" },
        ].map((c, i) => (
          <div key={c.label} className="glass-card glass-card-hover tilt p-6 relative overflow-hidden group rise" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="absolute -top-12 -right-10 w-36 h-36 rounded-full blur-3xl opacity-70 pointer-events-none" style={{ background: statCardGlow[c.color] || statCardGlow.blue }} />
            <div className="relative">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{c.label}</div>
              <div className="text-3xl font-black text-white tracking-tight">{c.value}</div>
              <div className={cn("text-[10px] font-black uppercase tracking-widest mt-2 inline-block px-2.5 py-1 rounded-full border border-white/10",
                statCardColorMap[c.color] || "text-slate-400 bg-slate-400/10")}>{c.trend}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Nodes */}
      <div className="grid grid-cols-3 gap-6">
        {k8s.nodes.map(n => (
          <div key={n.name} className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold text-slate-200">{n.name}</span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">{n.zone}</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-400">
              <span className="w-10">CPU</span>
              <K8sBar pct={n.cpu_pct} />
              <span className="tabular-nums w-24 text-right">{n.cpu_used_m}m / {n.cpu_capacity_m}m</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-400">
              <span className="w-10">MEM</span>
              <K8sBar pct={n.mem_pct} />
              <span className="tabular-nums w-24 text-right">{(n.mem_used_mi / 1024).toFixed(1)}Gi / {(n.mem_capacity_mi / 1024).toFixed(0)}Gi</span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex gap-1.5">
                {n.conditions.map(c => (
                  <span key={c} className={cn("text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border",
                    c === "Ready" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30")}>
                    {c}
                  </span>
                ))}
              </div>
              <span className="text-[10px] text-slate-500">{n.pods} pods</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pods + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-8">
        <div className="glass-card p-6">
          <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300 mb-4">
            <Boxes className="w-4 h-4 text-blue-400" />
            Pods <span className="text-slate-500 font-medium">({k8s.pods.length})</span>
          </h3>
          <div className="grid grid-cols-[1.6fr_1fr_130px_50px_60px_60px_50px] gap-2 px-2 pb-2 text-[9px] font-black uppercase tracking-widest text-slate-600 border-b border-slate-800/50">
            <span>Pod</span><span>Node</span><span>Status</span><span className="text-right">↻</span><span className="text-right">CPU</span><span className="text-right">Mem</span><span className="text-right">Age</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto custom-scrollbar divide-y divide-slate-800/40">
            {k8s.pods.map(p => (
              <div key={p.name} className="grid grid-cols-[1.6fr_1fr_130px_50px_60px_60px_50px] gap-2 px-2 py-2 items-center hover:bg-slate-800/25 transition-colors">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-slate-300 truncate" title={p.name}>{p.name}</div>
                  <div className="text-[9px] text-slate-600">{p.deployment}</div>
                </div>
                <span className="text-[9px] text-slate-500 font-mono truncate">{p.node}</span>
                <span className={cn("text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border text-center",
                  K8S_STATUS_STYLE[p.status] || "bg-slate-500/10 text-slate-400 border-slate-500/30")}>
                  {p.status}
                </span>
                <span className={cn("text-[10px] tabular-nums text-right", p.restarts > 3 ? "text-rose-400 font-bold" : "text-slate-500")}>{p.restarts}</span>
                <span className="text-[10px] text-slate-400 tabular-nums text-right">{Math.round(p.cpu_m)}m</span>
                <span className="text-[10px] text-slate-400 tabular-nums text-right">{Math.round(p.mem_mi)}Mi</span>
                <span className="text-[10px] text-slate-500 tabular-nums text-right">{podAge(p.started_at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300 mb-4">
            <FileText className="w-4 h-4 text-amber-400" />
            Cluster Events
          </h3>
          <div className="max-h-[460px] overflow-y-auto custom-scrollbar space-y-1.5">
            {(k8s.events || []).length === 0 ? (
              <div className="text-center py-12 text-slate-600 text-xs">No recent events.</div>
            ) : (
              k8s.events.map((e, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-slate-800/30 text-[10px] font-mono">
                  <span className="text-slate-600 flex-shrink-0 w-16 tabular-nums">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className={cn("flex-shrink-0 w-16 text-center rounded px-1 py-0.5 text-[8px] font-black uppercase",
                    e.type === "Warning" ? "text-amber-400 bg-amber-400/10" : "text-emerald-400 bg-emerald-400/10")}>
                    {e.type}
                  </span>
                  <span className="text-blue-400 flex-shrink-0 w-24 truncate">{e.reason}</span>
                  <span className="text-slate-400 flex-1 leading-relaxed">{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INTEGRATIONS / API NETWORK — all payment gateways, live connection state
// ═══════════════════════════════════════════════════════════════════
const GATEWAY_GLYPH = {
  Razorpay: "R", Stripe: "S", PhonePe: "Pe", Paytm: "P", PayU: "Pu",
  Cashfree: "Cf", JusPay: "J", CCAvenue: "CC", Custom: "＋",
};
const PAYMENT_ANOMALY_SET = new Set(["Payment Failure Spike", "Gateway Timeout", "Fraud Velocity", "Duplicate Charge"]);

function IntegrationsView({ data, anomalies, onConnect, onInvestigate, onLookup }) {
  const [lookupId, setLookupId] = useState("");
  if (!data) {
    return (
      <div className="py-24 text-center text-slate-600 text-sm">
        <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
        Loading integrations…
      </div>
    );
  }
  const gws = data.gateways || [];
  const liveCount = gws.filter(g => g.live).length;
  const configuredCount = gws.filter(g => g.configured).length;
  const totalTxns = gws.reduce((s, g) => s + (g.txn_count || 0), 0);
  const payIncidents = (anomalies || []).filter(a => PAYMENT_ANOMALY_SET.has(a.anomaly_type)).slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-6">
        {[
          { label: "Gateways Live", value: `${liveCount}/${gws.length}`, hint: "receiving data", color: "emerald" },
          { label: "Configured", value: configuredCount, hint: "ready to receive", color: "blue" },
          { label: "Events Captured", value: totalTxns.toLocaleString("en-IN"), hint: "across all gateways", color: "amber" },
          { label: "Payment Incidents", value: payIncidents.length, hint: "detected on real data", color: "rose" },
        ].map(c => (
          <div key={c.label} className="glass-card glass-card-hover tilt p-6 rise">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{c.label}</div>
            <div className="text-2xl font-black text-white value-pop" key={String(c.value)}>{c.value}</div>
            <div className={cn("text-[10px] font-black uppercase tracking-widest mt-2 inline-block px-2 py-0.5 rounded", statCardColorMap[c.color])}>{c.hint}</div>
          </div>
        ))}
      </div>

      {/* Transaction lookup — check a payment (and its anomalies) by ID */}
      <div className="glass-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-200 flex-shrink-0">
            <Search className="w-4 h-4 text-blue-400" /> Look up a transaction
          </div>
          <div className="flex-1 relative">
            <input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && lookupId.trim()) onLookup(lookupId.trim()); }}
              placeholder="Enter transaction ID or order ID (e.g. TXN…, pay_…, ORD…) and press Enter"
              className="w-full bg-[#050b1e]/80 border border-slate-700/50 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-500/50 transition-all"
            />
          </div>
          <button onClick={() => lookupId.trim() && onLookup(lookupId.trim())}
            className="btn-gradient px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-white flex-shrink-0">
            Look up
          </button>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">Opens the payment's full timeline and shows any anomalies detected on it — investigate with AI in one click.</p>
      </div>

      {/* Network topology */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold flex items-center gap-2 text-slate-300">
            <Network className="w-4 h-4 text-blue-400" /> Payment API Network
          </h3>
          <button onClick={onConnect} className="btn-gradient flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white">
            <Plug className="w-3 h-3" /> Connect Gateway
          </button>
        </div>
        <NetworkGraph gateways={gws} />
      </div>

      {/* Gateway cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {gws.map((g, i) => (
          <GatewayCard key={g.name} g={g} onConnect={onConnect} delay={i * 60} />
        ))}
      </div>

      {/* Real-data incidents */}
      {payIncidents.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-xs font-black uppercase tracking-widest text-rose-400 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" /> Anomalies Detected on Real Payments
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {payIncidents.map((a, i) => {
              const st = styleFor(a.anomaly_type);
              return (
                <button key={a.id ?? `${a.trace_id}-${i}`} onClick={() => onInvestigate(a)}
                  className="text-left row-accent bg-slate-900/50 border border-slate-800 hover:border-rose-500/40 rounded-xl p-3 transition-all">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", st.text, st.bg, st.border)}>{a.anomaly_type}</span>
                    <span className="text-[9px] text-slate-500">{new Date(a.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-xs text-slate-300 mt-1.5">{a.service} <span className="text-slate-500">→ {a.route}</span></div>
                  <div className="text-[9px] text-blue-400 mt-1">Investigate with AI →</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NetworkGraph({ gateways }) {
  // Radial layout: central "MonoXAI" hub with a spoke to each gateway.
  const W = 900, H = 320, cx = W / 2, cy = H / 2;
  const R = 128;
  const nodes = gateways.map((g, i) => {
    const ang = (i / gateways.length) * Math.PI * 2 - Math.PI / 2;
    return { ...g, x: cx + Math.cos(ang) * R * 1.7, y: cy + Math.sin(ang) * R };
  });
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 640 }}>
        <defs>
          <radialGradient id="hub-glow"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></radialGradient>
        </defs>
        {nodes.map((n, i) => {
          const on = n.live || n.configured;
          return (
            <g key={n.name}>
              <line x1={cx} y1={cy} x2={n.x} y2={n.y}
                stroke={n.live ? "#34d399" : on ? "#3b82f6" : "#334155"}
                strokeWidth={n.live ? 2 : 1} strokeDasharray={n.live ? "0" : "4 4"}
                opacity={on ? 0.8 : 0.35} />
              {n.live && (
                <circle r="3" fill="#34d399">
                  <animateMotion dur="2.2s" repeatCount="indefinite" path={`M${cx},${cy} L${n.x},${n.y}`} />
                </circle>
              )}
            </g>
          );
        })}
        {/* Hub */}
        <circle cx={cx} cy={cy} r="52" fill="url(#hub-glow)" />
        <circle cx={cx} cy={cy} r="26" fill="#0b1120" stroke="#3b82f6" strokeWidth="2" />
        <text x={cx} y={cy - 1} textAnchor="middle" fill="#93c5fd" fontSize="10" fontWeight="bold">MonoXAI</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fill="#64748b" fontSize="7">API HUB</text>
        {/* Gateway nodes */}
        {nodes.map(n => {
          const on = n.live || n.configured;
          return (
            <g key={n.name + "-node"}>
              <circle cx={n.x} cy={n.y} r="20"
                fill={n.live ? "#052e2b" : "#0b1120"}
                stroke={n.live ? "#34d399" : n.configured ? "#3b82f6" : "#334155"} strokeWidth="2" />
              <text x={n.x} y={n.y + 3} textAnchor="middle" fill={on ? "#e2e8f0" : "#64748b"} fontSize="9" fontWeight="bold">{GATEWAY_GLYPH[n.name] || n.name[0]}</text>
              <text x={n.x} y={n.y + 34} textAnchor="middle" fill={on ? "#94a3b8" : "#475569"} fontSize="8">{n.name}</text>
              {n.live && <circle cx={n.x + 15} cy={n.y - 15} r="3.5" fill="#34d399" className="pulse-ring" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function GatewayCard({ g, onConnect, delay }) {
  const status = g.live ? "live" : g.configured ? "ready" : "available";
  const ago = g.secs_since_event == null ? null : g.secs_since_event < 60 ? `${g.secs_since_event}s ago` : `${Math.floor(g.secs_since_event / 60)}m ago`;
  return (
    <div className="glass-card glass-card-hover p-5 rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm border",
            g.live ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : g.configured ? "bg-blue-500/15 border-blue-500/40 text-blue-300" : "bg-slate-800/60 border-slate-700 text-slate-400")}>
            {GATEWAY_GLYPH[g.name] || g.name[0]}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-200">{g.name}</div>
            <div className="text-[10px] text-slate-500">{g.region} · {g.method === "webhook" ? "Webhook" : "Ingest API"}</div>
          </div>
        </div>
        <span className={cn("flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
          status === "live" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
          status === "ready" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
          "bg-slate-700/30 text-slate-500 border-slate-700/50")}>
          {status === "live" ? <Wifi className="w-2.5 h-2.5" /> : status === "ready" ? <Radio className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
          {status}
        </span>
      </div>
      {g.txn_count > 0 ? (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800/50">
            <div className="text-[8px] text-slate-500 uppercase font-bold">Events</div>
            <div className="text-sm font-black text-slate-200 tabular-nums">{g.txn_count}</div>
          </div>
          <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800/50">
            <div className="text-[8px] text-slate-500 uppercase font-bold">Success</div>
            <div className={cn("text-sm font-black tabular-nums", g.success_rate >= 90 ? "text-emerald-400" : g.success_rate >= 70 ? "text-amber-400" : "text-rose-400")}>{g.success_rate}%</div>
          </div>
          <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800/50">
            <div className="text-[8px] text-slate-500 uppercase font-bold">Volume</div>
            <div className="text-sm font-black text-slate-200 tabular-nums">{fmtINRCompact(g.volume_inr)}</div>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 mb-3 py-2">No events yet — {g.configured ? "waiting for the first payment." : "connect to start receiving."}</div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-slate-600">{ago ? `last event ${ago}` : "no events"}</span>
        <button onClick={onConnect} className="flex items-center gap-1 text-[10px] font-bold text-blue-300 hover:text-blue-200 border border-blue-500/30 hover:border-blue-500/50 rounded-lg px-2.5 py-1 transition-colors">
          <Plug className="w-3 h-3" /> {g.configured ? "Setup" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function AnomalyRow({ item, onClick }) {
  const style = styleFor(item.anomaly_type);
  return (
    <div
      onClick={onClick}
      className="row-accent group bg-slate-900/40 p-3 rounded-xl border border-slate-800/40 hover:border-blue-500/30 hover:bg-slate-800/30 cursor-pointer flex items-center justify-between"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className={cn("w-2 h-8 rounded-full flex items-center justify-center", style.bg)}>
          <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.5)]", style.dot)} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-bold text-slate-200 truncate">{item.service} <span className="text-slate-500 font-medium">→ {item.route}</span></div>
            {item.anomaly_type && (
              <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border", style.text, style.bg, style.border)}>
                {item.anomaly_type}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">#{(item.trace_id ?? "").slice(0, 12)} • {new Date(item.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
      <div className="text-right flex items-center gap-2">
        <div className="text-sm font-black text-rose-500">{(item.duration_ms ?? 0).toFixed(0)}ms</div>
        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  );
}

function PIIRedactionPanel({ backendUrl }) {
  const [series, setSeries] = useState({ "api-gateway": [], "payment-service": [] });

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [gw, pay] = await Promise.all([
          fetch(`${backendUrl}/api/metrics/api-gateway/redaction_count`).then(r => r.ok ? r.json() : []),
          fetch(`${backendUrl}/api/metrics/payment-service/redaction_count`).then(r => r.ok ? r.json() : []),
        ]);
        if (!cancelled) setSeries({ "api-gateway": gw, "payment-service": pay });
      } catch {}
    };
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [backendUrl]);

  const chartData = useMemo(() => {
    const merged = {};
    for (const [svc, rows] of Object.entries(series)) {
      for (const r of rows) {
        const t = new Date(r.timestamp).toLocaleTimeString();
        if (!merged[t]) merged[t] = { time: t };
        merged[t][svc] = r.value;
      }
    }
    return Object.values(merged).slice(-30);
  }, [series]);

  const latest = {
    gw: series["api-gateway"].slice(-1)[0]?.value ?? 0,
    py: series["payment-service"].slice(-1)[0]?.value ?? 0,
  };
  const total = (latest.gw + latest.py).toFixed(0);

  return (
    <div className="bg-slate-900/40 border border-slate-800/60 p-6 rounded-2xl">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h6 className="text-[10px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-2">
            <Shield className="w-3 h-3 text-emerald-400" />
            PII Redaction Density
          </h6>
          <p className="text-[10px] text-slate-600 mt-1 italic">Paper §IV-C — novel security primitive derived from redaction-token counts</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-emerald-400">{total}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">total tokens redacted</div>
        </div>
      </div>
      <div className="h-40">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-600">
            No redaction events yet. Run <code className="text-slate-400 mx-1">./traffic.sh 60 pii</code> to populate.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="redact-gw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="redact-py" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#93c5fd" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#93c5fd" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#182849" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0a1230', border: '1px solid #1e3a5f', borderRadius: '8px' }} />
              <Area type="monotone" dataKey="api-gateway" stroke="#34d399" strokeWidth={2} fill="url(#redact-gw)" isAnimationActive={false} />
              <Area type="monotone" dataKey="payment-service" stroke="#93c5fd" strokeWidth={2} fill="url(#redact-py)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, active, onClick }) {
  return (
    <div className="flex items-center justify-between group cursor-pointer" onClick={onClick}>
      <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors font-medium">{label}</span>
      <div className={cn(
        "w-8 h-4 rounded-full transition-all relative",
        active ? "bg-blue-600" : "bg-slate-800/50"
      )}>
        <div className={cn(
          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm",
          active ? "left-[18px]" : "left-0.5"
        )} />
      </div>
    </div>
  );
}

function LogRow({ log, onTraceClick }) {
  const severityColors = {
    DEBUG: "text-slate-500 bg-slate-500/10",
    INFO: "text-blue-400 bg-blue-400/10",
    WARNING: "text-amber-400 bg-amber-400/10",
    WARN: "text-amber-400 bg-amber-400/10",
    ERROR: "text-rose-400 bg-rose-400/10",
    FATAL: "text-red-500 bg-red-500/10 font-black",
  };
  const colorClass = severityColors[log.severity] || severityColors.INFO;

  return (
    <div className="flex items-start gap-3 py-1.5 px-2 rounded-md hover:bg-slate-800/30 transition-colors text-[11px] font-mono group">
      <span className="text-slate-600 flex-shrink-0 w-20 tabular-nums">
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>
      <span className={cn("flex-shrink-0 w-14 text-center rounded px-1 py-0.5 text-[9px] font-black uppercase", colorClass)}>
        {log.severity}
      </span>
      <span className="text-blue-400 flex-shrink-0 w-28 truncate">
        {log.service_name}
      </span>
      <span className="text-slate-300 flex-1 truncate" title={log.body}>
        {log.body}
      </span>
      {log.trace_id && onTraceClick && (
        <button
          onClick={(e) => { e.stopPropagation(); onTraceClick(); }}
          className="flex-shrink-0 text-[9px] text-blue-400 hover:text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity border border-blue-500/30 rounded px-1.5 py-0.5"
        >
          Trace
        </button>
      )}
    </div>
  );
}

const statCardColorMap = {
  blue: "text-blue-400 bg-blue-400/10",
  rose: "text-rose-400 bg-rose-400/10",
  emerald: "text-emerald-400 bg-emerald-400/10",
  amber: "text-amber-400 bg-amber-400/10",
};

const statCardGlow = {
  blue: "rgba(99,102,241,0.28)",
  rose: "rgba(244,63,94,0.24)",
  emerald: "rgba(16,185,129,0.24)",
  amber: "rgba(245,158,11,0.24)",
};

function StatCard({ label, value, trend, color, series, delay = 0 }) {
  const stroke = color === 'blue' ? '#60a5fa' : color === 'rose' ? '#f43f5e' : color === 'amber' ? '#f59e0b' : '#34d399';
  const gradId = `spark-grad-${color}`;
  const hasData = Array.isArray(series) && series.length >= 2;
  const sparkPath = hasData
    ? smoothPath(series, { width: 100, height: 20, padding: 2 })
    : "M 0 15 Q 10 5, 20 15 T 40 15 T 60 5 T 80 15 T 100 10";
  const areaPath = hasData ? `${sparkPath} L 100 20 L 0 20 Z` : null;
  return (
    <div className="glass-card glass-card-hover tilt p-6 relative overflow-hidden group rise" style={{ animationDelay: `${delay}ms` }}>
      {/* corner accent glow */}
      <div className="absolute -top-12 -right-10 w-36 h-36 rounded-full blur-3xl opacity-70 pointer-events-none transition-opacity group-hover:opacity-100"
           style={{ background: statCardGlow[color] || statCardGlow.blue }} />
      <div className="relative flex justify-between items-start mb-6 gap-2">
        <div className="space-y-1">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
          <div key={String(value)} className="value-pop text-2xl font-black text-white tracking-tight tabular-nums drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">{value}</div>
        </div>
        <div className={cn("shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/10 backdrop-blur", statCardColorMap[color] || "text-slate-400 bg-slate-400/10")} title={String(trend)}>
          {trend}
        </div>
      </div>

      <div className="relative h-12 w-full mt-4">
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />}
          <path
            d={sparkPath}
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={hasData ? "" : "animate-wave"}
          />
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS PANEL — dropdown of recent anomalies
// ═══════════════════════════════════════════════════════════════════
function NotificationsPanel({ anomalies, onClose, onPick, onClear }) {
  const list = anomalies.slice(0, 12);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-hidden z-50 glass-card rounded-2xl border border-white/10 shadow-2xl shadow-black/60 flex flex-col animate-in fade-in slide-in-from-top-1">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-300">
            <Bell className="w-3.5 h-3.5 text-blue-300" /> Notifications
          </div>
          <button onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-300 font-bold">Mark all read</button>
        </div>
        <div className="overflow-y-auto custom-scrollbar">
          {list.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-600">No incidents yet.</div>
          ) : list.map((a, i) => {
            const st = styleFor(a.anomaly_type);
            return (
              <button key={a.id ?? `${a.trace_id}-${i}`} onClick={() => onPick(a)}
                className="w-full text-left px-4 py-3 border-b border-slate-800/40 hover:bg-slate-800/40 transition-colors flex items-start gap-3">
                <div className={cn("w-2 h-2 mt-1.5 rounded-full flex-shrink-0", st.dot)} />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[11px] font-bold", st.text)}>{a.anomaly_type || "Anomaly"}</div>
                  <div className="text-[10px] text-slate-400 truncate">{a.service} → {a.route}</div>
                  <div className="text-[9px] text-slate-600 mt-0.5">{new Date(a.timestamp).toLocaleTimeString()}</div>
                </div>
                <ArrowRight className="w-3 h-3 text-slate-600 mt-1 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// COMMAND PALETTE — Ctrl/Cmd+K quick nav & actions
// ═══════════════════════════════════════════════════════════════════
function CommandPalette({ onClose, services, gateways, actions }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => {
    const base = [
      { group: "Go to", label: "Observability", hint: "View", run: () => actions.setView("Observability") },
      { group: "Go to", label: "Transactions", hint: "View", run: () => actions.setView("Transactions") },
      { group: "Go to", label: "Integrations", hint: "View", run: () => actions.setView("Integrations") },
      { group: "Go to", label: "Kubernetes", hint: "View", run: () => actions.setView("Kubernetes") },
      { group: "Action", label: "Toggle live updates", hint: "Live", run: actions.toggleLive },
      { group: "Action", label: "Refresh all data", hint: "Refresh", run: actions.refresh },
      { group: "Action", label: "Run AI root-cause on latest incident", hint: "AI", run: actions.runAI },
      { group: "Action", label: "Connect payment gateway", hint: "Setup", run: actions.connect },
      ...(services || []).filter(s => s !== "All Services").map(s => ({ group: "Service", label: s, hint: "Filter", run: () => actions.setService(s) })),
      ...[...new Set(gateways || [])].filter(Boolean).map(g => ({ group: "Gateway", label: g, hint: "Payments", run: () => { actions.setView("Transactions"); } })),
    ];
    if (!q.trim()) return base;
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    return base.filter(it => toks.every(t => (it.label + " " + it.group).toLowerCase().includes(t)));
  }, [q, services, gateways]);

  useEffect(() => { setSel(0); }, [q]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = items[sel]; if (it) { it.run(); onClose(); } }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4 bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-xl glass-card rounded-2xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/60">
          <Command className="w-4 h-4 text-blue-300" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Type a command or search… (↑↓ to move, ↵ to run)"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none" />
          <kbd className="text-[9px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto custom-scrollbar py-1">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-600">No matches.</div>
          ) : items.map((it, i) => (
            <button key={i} onMouseEnter={() => setSel(i)} onClick={() => { it.run(); onClose(); }}
              className={cn("w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors",
                i === sel ? "bg-blue-500/15" : "hover:bg-slate-800/40")}>
              <span className="flex items-center gap-3 min-w-0">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 w-16 flex-shrink-0">{it.group}</span>
                <span className="text-sm text-slate-200 truncate">{it.label}</span>
              </span>
              <span className="text-[9px] text-slate-600 font-bold uppercase flex-shrink-0">{it.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTION DETAIL DRAWER — full lifecycle + gateway response
// ═══════════════════════════════════════════════════════════════════
function TxnDrawer({ txn, onClose, onToast, onInvestigate }) {
  const [refunded, setRefunded] = useState(false);
  const [linkedAnomalies, setLinkedAnomalies] = useState([]);
  const Icon = METHOD_ICON[txn.method] || CreditCard;
  const isReal = txn.source === "live";
  const failed = txn.status === "FAILED";

  // Fetch any anomalies detected on this transaction id.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/transactions/lookup/${encodeURIComponent(txn.txn_id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !cancelled) setLinkedAnomalies(d.anomalies || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [txn.txn_id]);

  // Build a plausible payment lifecycle from the txn status.
  const t0 = new Date(txn.timestamp).getTime();
  const steps = [
    { label: "Payment initiated", at: t0 - 1200, done: true },
    { label: "Sent to gateway", sub: txn.gateway, at: t0 - 900, done: true },
    { label: failed ? "Authorization declined" : "Authorized by bank", sub: failed ? txn.failure_reason : txn.provider, at: t0 - 400, done: true, bad: failed },
    { label: failed ? "Payment failed" : (txn.status === "PENDING" ? "Awaiting settlement" : "Captured / settled"),
      at: t0, done: !failed && txn.status !== "PENDING", bad: failed, pending: txn.status === "PENDING" },
  ];

  const field = (k, v, mono = true) => (
    <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
      <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">{k}</div>
      <div className={cn("text-xs font-bold text-slate-200 break-all", mono && "font-mono")}>{v ?? "—"}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-md h-full overflow-y-auto custom-scrollbar bg-[#060c22] border-l border-white/10 shadow-2xl shadow-black/60 slide-in-from-right"
        style={{ animation: "slideInRight .35s cubic-bezier(0.2,0.7,0.2,1)" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#060c22]/95 backdrop-blur border-b border-slate-800/60 p-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", TXN_STATUS_STYLE[txn.status] || "bg-slate-500/10 text-slate-400 border-slate-500/30")}>{txn.status}</span>
              <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", isReal ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-slate-500/10 text-slate-400 border-slate-500/30")}>{isReal ? "Live" : "Demo"}</span>
            </div>
            <div className="text-2xl font-black text-white mt-2 tabular-nums">{fmtAmount(txn.amount, txn.currency)}</div>
            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{txn.txn_id}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-full transition-colors"><X className="w-4 h-4 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-6">
          {/* Lifecycle timeline */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Payment Timeline</div>
            <div className="space-y-0">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                      s.bad ? "bg-rose-500/20 text-rose-400" : s.pending ? "bg-amber-500/20 text-amber-400" : s.done ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700/40 text-slate-500")}>
                      {s.bad ? <X className="w-3 h-3" /> : s.pending ? <Clock3 className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                    </div>
                    {i < steps.length - 1 && <div className="w-px flex-1 min-h-[26px] bg-slate-800" />}
                  </div>
                  <div className="pb-4">
                    <div className={cn("text-xs font-bold", s.bad ? "text-rose-300" : "text-slate-200")}>{s.label}</div>
                    {s.sub && <div className="text-[10px] text-slate-500 font-mono">{s.sub}</div>}
                    <div className="text-[9px] text-slate-600">{new Date(s.at).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gateway response */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Details</div>
            <div className="grid grid-cols-2 gap-2">
              {field("Order ID", txn.order_id)}
              {field("Type", txn.txn_type, false)}
              {field("Method", txn.method, false)}
              {field("Provider", txn.provider, false)}
              {field("Gateway", txn.gateway, false)}
              {field("Currency", txn.currency, false)}
              {field("Latency", `${(txn.latency_ms ?? 0).toFixed(0)} ms`, false)}
              {field("Customer", txn.user)}
              {failed && <div className="col-span-2">{field("Failure reason", txn.failure_reason)}</div>}
            </div>
          </div>

          {/* Raw payload */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Raw Event</div>
              <button onClick={() => { navigator.clipboard?.writeText(JSON.stringify(txn, null, 2)); onToast("Transaction JSON copied"); }}
                className="flex items-center gap-1 text-[9px] text-blue-300 hover:text-blue-200 font-bold uppercase tracking-wider border border-blue-500/30 rounded px-2 py-0.5">
                <Copy className="w-2.5 h-2.5" /> Copy
              </button>
            </div>
            <pre className="text-[10px] text-slate-400 font-mono bg-slate-950/60 p-3 rounded-lg border border-slate-800/50 max-h-44 overflow-y-auto custom-scrollbar whitespace-pre-wrap">{JSON.stringify(txn, null, 2)}</pre>
          </div>

          {/* Linked anomalies detected on this transaction */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 text-rose-400" /> Anomalies on this transaction
            </div>
            {linkedAnomalies.length === 0 ? (
              <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4" /> No anomalies detected — this payment looks healthy.
              </div>
            ) : (
              <div className="space-y-2">
                {linkedAnomalies.map((a, i) => {
                  const st = styleFor(a.anomaly_type);
                  return (
                    <button key={a.id ?? i} onClick={() => { onInvestigate?.(a); onClose(); }}
                      className="w-full text-left bg-slate-950/50 border border-slate-800 hover:border-rose-500/40 rounded-lg p-3 transition-all">
                      <div className="flex items-center justify-between">
                        <span className={cn("text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", st.text, st.bg, st.border)}>{a.anomaly_type}</span>
                        <span className="text-[9px] text-slate-500">{new Date(a.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1.5">{(a.reasons || [])[0]} · score {(a.anomaly_score ?? 0).toFixed(2)}</div>
                      <div className="text-[9px] text-blue-400 mt-1">Investigate with AI →</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          {txn.status === "SUCCESS" && (
            <button
              disabled={refunded}
              onClick={() => { setRefunded(true); onToast(`Refund of ${fmtAmount(txn.amount, txn.currency)} initiated (demo)`); }}
              className={cn("w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all",
                refunded ? "bg-slate-800 text-slate-500 cursor-not-allowed" : "bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25")}>
              <RotateCcw className="w-4 h-4" /> {refunded ? "Refund initiated" : "Refund payment"}
            </button>
          )}
          <p className="text-[9px] text-slate-600 text-center">
            {isReal ? "Real gateway event." : "Simulated transaction — actions are demo-only."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONNECT WIZARD — per-gateway webhook setup, from inside the UI
// ═══════════════════════════════════════════════════════════════════
const GATEWAY_TEST_TIPS = {
  Razorpay: { events: "payment.captured, payment.failed, refund.processed", test: [["Test UPI", "success@razorpay"], ["Test card", "4111 1111 1111 1111"]], where: "Settings → Webhooks → Add New Webhook" },
  Stripe:   { events: "payment_intent.succeeded, payment_intent.payment_failed, charge.refunded", test: [["Test card", "4242 4242 4242 4242"], ["Any future expiry", "12/34 · CVV 123"]], where: "Developers → Webhooks → Add endpoint" },
  PhonePe:  { events: "Payment status callback (S2S)", test: [["Sandbox", "PhonePe UAT simulator"]], where: "Merchant Dashboard → Webhooks / callback URL" },
  Cashfree: { events: "PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK", test: [["Test UPI", "testsuccess@gocash"], ["Test card", "4111 1111 1111 1111"]], where: "Developers → Webhooks" },
  PayU:     { events: "Success/Failure callback (SURL/FURL)", test: [["Test card", "5123 4567 8901 2346"], ["Sandbox", "PayU test dashboard"]], where: "Integration → Webhooks / callback" },
  Paytm:    { events: "Transaction status callback", test: [["Sandbox", "Paytm staging"]], where: "Dashboard → Webhooks (post normalized JSON, HMAC-SHA256)" },
  JusPay:   { events: "Order status webhook", test: [["Sandbox", "JusPay sandbox"]], where: "Dashboard → Webhooks (post normalized JSON, HMAC-SHA256)" },
  CCAvenue: { events: "Response handler", test: [["Test card", "4111 1111 1111 1111"]], where: "Settings → Webhooks (post normalized JSON, HMAC-SHA256)" },
  Custom:   { events: "Any payment event", test: [["Your system", "POST normalized JSON"]], where: "Send POST with X-Webhook-Signature = HMAC-SHA256(body, secret)" },
};

function ConnectWizard({ appConfig, integrations, backendUrl, onClose, onToast }) {
  const origin = (typeof window !== "undefined" ? window.location.origin : backendUrl);
  const gateways = integrations?.gateways || [];
  const [sel, setSel] = useState(gateways[0]?.name || "Razorpay");
  const g = gateways.find(x => x.name === sel) || {};
  const tip = GATEWAY_TEST_TIPS[sel] || GATEWAY_TEST_TIPS.Custom;
  const webhookUrl = `${origin}${g.path || "/api/webhooks/gateway/" + sel.toLowerCase()}`;
  const realOnly = !!appConfig?.real_only;
  const count = appConfig?.real_payment_count ?? 0;
  const secretEnv = sel === "Razorpay" ? "RAZORPAY_WEBHOOK_SECRET"
    : sel === "Stripe" ? "STRIPE_WEBHOOK_SECRET"
    : `${sel.toUpperCase()}_WEBHOOK_SECRET (or shared GATEWAY_WEBHOOK_SECRET)`;

  const copy = (v, label) => { navigator.clipboard?.writeText(v); onToast(`${label} copied`); };
  const Field = ({ label, value, secret }) => (
    <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[9px] text-slate-500 uppercase font-bold">{label}</div>
        <div className="text-[11px] font-mono text-slate-200 truncate">{secret ? "•••••••• (set as a Space secret)" : value}</div>
      </div>
      {!secret && (
        <button onClick={() => copy(value, label)} className="flex items-center gap-1 text-[9px] text-blue-300 hover:text-blue-200 font-bold uppercase border border-blue-500/30 rounded px-2 py-1 flex-shrink-0">
          <Copy className="w-2.5 h-2.5" /> Copy
        </button>
      )}
    </div>
  );
  const Step = ({ n, title, children }) => (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-black flex items-center justify-center flex-shrink-0">{n}</div>
      <div className="flex-1 min-w-0"><div className="text-sm font-bold text-slate-200 mb-1">{title}</div><div className="text-xs text-slate-400 space-y-2">{children}</div></div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/55 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar glass-card rounded-2xl border border-white/10 shadow-2xl shadow-black/60" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[#060c22]/95 backdrop-blur border-b border-slate-800/60 p-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center glow-blue"><Radio className="w-4 h-4" /></div>
            <div>
              <div className="text-sm font-black text-white">Connect Payment Gateways</div>
              <div className="text-[10px] text-slate-500">Each gateway has its own signed webhook</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-full"><X className="w-4 h-4 text-slate-400" /></button>
        </div>

        {/* Gateway selector */}
        <div className="p-5 pb-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Choose a gateway</div>
          <div className="flex flex-wrap gap-2">
            {gateways.map(x => (
              <button key={x.name} onClick={() => setSel(x.name)}
                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all",
                  sel === x.name ? "bg-blue-500/15 border-blue-500/50 text-blue-200" : "bg-slate-900/50 border-slate-700/50 text-slate-400 hover:text-slate-200")}>
                <span className={cn("w-1.5 h-1.5 rounded-full", x.live ? "bg-emerald-500" : x.configured ? "bg-blue-500" : "bg-slate-500")} />
                {x.name}
              </button>
            ))}
          </div>
        </div>

        {/* Status banner */}
        <div className={cn("mx-5 mt-4 p-3 rounded-xl border flex items-center gap-3",
          g.live ? "bg-green-500/10 border-green-500/30" : g.configured ? "bg-amber-500/10 border-amber-500/30" : "bg-slate-800/40 border-slate-700/50")}>
          <div className={cn("w-2.5 h-2.5 rounded-full", g.live ? "bg-green-500 animate-pulse" : g.configured ? "bg-amber-500 animate-pulse" : "bg-slate-500")} />
          <div className="text-xs font-bold text-slate-200">
            {g.live ? `${sel} live — ${g.txn_count} event${g.txn_count === 1 ? "" : "s"} received`
              : g.configured ? `${sel} secret set · awaiting first real payment`
              : `${sel} not configured · set its webhook secret to enable`}
          </div>
        </div>

        <div className="p-5 space-y-5">
          <Step n={1} title={`Add the webhook in your ${sel} dashboard`}>
            <p>{tip.where}. Point it at:</p>
            <Field label={`${sel} Webhook URL`} value={webhookUrl} />
            <Field label="Signature scheme" value={g.scheme || "HMAC-SHA256"} />
            <Field label="Secret env var" value={secretEnv} secret />
            <p className="text-[10px] text-slate-500">Events: <span className="font-mono text-slate-300">{tip.events}</span></p>
          </Step>
          <Step n={2} title="Make a test payment (sandbox / test mode — free)">
            <div className="grid grid-cols-2 gap-2">
              {tip.test.map(([l, v]) => <Field key={l} label={l} value={v} />)}
            </div>
          </Step>
          <Step n={3} title="Watch it appear — real data only">
            The payment shows in your live feed within seconds and <b className="text-green-400">real-only mode</b> switches on{realOnly ? ` (already active — ${count} real payment${count === 1 ? "" : "s"} so far)` : ""}, so the simulator goes quiet and you see only genuine gateway data.
          </Step>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60">
            <button onClick={() => copy(webhookUrl, `${sel} webhook URL`)} className="btn-gradient flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-white flex items-center justify-center gap-2">
              <Copy className="w-3.5 h-3.5" /> Copy {sel} URL
            </button>
            <button onClick={onClose} className="px-4 py-2.5 text-[11px] font-bold text-slate-400 hover:text-white">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
