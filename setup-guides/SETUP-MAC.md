# 🍎 ObserveX (MonoXAI) — macOS Setup Guide

> **Complete step-by-step instructions to set up the full ObserveX / MonoXAI observability stack on macOS.**

---

## 📋 Table of Contents

1. [Prerequisites](#1--prerequisites)
2. [Install Prerequisites](#2--install-prerequisites)
3. [Clone / Copy the Project](#3--clone--copy-the-project)
4. [Environment Configuration](#4--environment-configuration)
5. [Install Python Dependencies](#5--install-python-dependencies)
6. [Install Node.js Dependencies](#6--install-nodejs-dependencies)
7. [Set Up RabbitMQ](#7--set-up-rabbitmq)
8. [Start the Stack](#8--start-the-stack)
9. [Generate Traffic (Optional)](#9--generate-traffic-optional)
10. [Stop the Stack](#10--stop-the-stack)
11. [Troubleshooting](#11--troubleshooting)
12. [Architecture Overview](#12--architecture-overview)

---

## 1. 📦 Prerequisites

Make sure the following are installed on your Mac:

| Tool               | Version | Install Method                    |
| ------------------ | ------- | --------------------------------- |
| **Homebrew**       | Latest  | https://brew.sh                   |
| **Python**         | 3.10+   | `brew install python@3.12`        |
| **Node.js**        | 18+     | `brew install node`               |
| **Docker Desktop** | Latest  | https://www.docker.com/products/docker-desktop/ |
| **RabbitMQ**       | 3.9+    | `brew install rabbitmq`           |
| **Git**            | Latest  | `brew install git` (or Xcode CLT) |

---

## 2. 🔧 Install Prerequisites

### Homebrew (if not installed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> **Apple Silicon Macs (M1/M2/M3/M4)**: After installing Homebrew, add it to your PATH:
> ```bash
> echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
> eval "$(/opt/homebrew/bin/brew shellenv)"
> ```

### Python
```bash
brew install python@3.12
```
Verify:
```bash
python3 --version    # Should show 3.10+
pip3 --version
```

### Node.js
```bash
brew install node
```
Verify:
```bash
node --version    # Should show 18+
npm --version
```

### Docker Desktop
1. Download from https://www.docker.com/products/docker-desktop/
   - Choose **Apple Silicon** or **Intel** based on your Mac
2. Drag to Applications, open Docker Desktop
3. Wait for it to fully start (whale icon should be steady in the menu bar)
4. Verify:
   ```bash
   docker --version
   docker compose version
   ```

### RabbitMQ
```bash
brew install rabbitmq
```

Start RabbitMQ as a background service:
```bash
brew services start rabbitmq
```

Add RabbitMQ tools to your PATH (add to `~/.zshrc`):
```bash
echo 'export PATH="/opt/homebrew/opt/rabbitmq/sbin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

> **Intel Macs**: The path is `/usr/local/opt/rabbitmq/sbin` instead.

Enable required plugins:
```bash
rabbitmq-plugins enable rabbitmq_stream rabbitmq_management
```

Create the telemetry user:
```bash
rabbitmqctl add_user telemetry telemetry_password
rabbitmqctl set_permissions -p / telemetry ".*" ".*" ".*"
rabbitmqctl set_user_tags telemetry administrator
```

Verify RabbitMQ management is running: open http://localhost:15672 (login: `guest` / `guest`)

---

## 3. 📂 Clone / Copy the Project

If you received a ZIP file:
```bash
unzip ObserveX-main.zip
cd ObserveX-main
```

If cloning from Git:
```bash
git clone <your-repo-url> ObserveX-main
cd ObserveX-main
```

Make all shell scripts executable:
```bash
chmod +x start.sh stop.sh status.sh traffic.sh
chmod +x instrumentation/node-wrapper/run_instrumented.sh
chmod +x instrumentation/python-wrapper/run_instrumented.sh
```

---

## 4. ⚙️ Environment Configuration

The project uses `.env` files for configuration. Two copies are needed:

### Root `.env`
```bash
cp .env.example .env
```

### Backend `.env`
```bash
cp .env.example dashboard/backend/.env
```

### Edit the `.env` files
Open each `.env` file and set your **Gemini API Key**:
```bash
nano .env
# or
nano dashboard/backend/.env
```

Set the values:
```env
# Required: Google Gemini API key for AI-powered Root Cause Analysis
GEMINI_API_KEY=your_actual_gemini_api_key_here

# OpenTelemetry Collector endpoint (default — don't change unless needed)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Quote Service URL for API Gateway (default — don't change unless needed)
QUOTE_SERVICE_URL=http://localhost:5000

# RabbitMQ credentials (must match what you set in Step 2)
RABBITMQ_USER=telemetry
RABBITMQ_PASSWORD=telemetry_password
```

> 💡 **Get a Gemini API Key**: Visit https://aistudio.google.com/app/apikey

---

## 5. 🐍 Install Python Dependencies

### Create a Virtual Environment
```bash
cd /path/to/ObserveX-main
python3 -m venv venv
source venv/bin/activate
```

### Install Backend Dependencies
```bash
pip install fastapi uvicorn aiosqlite python-dotenv google-generativeai pydantic httpx
```

### Install Stream Processor Dependencies
```bash
pip install -r stream-processor/requirements.txt
```

### Install Quote Service Dependencies
```bash
pip install -r microservices/quote-service/requirements.txt
```

### Install OpenTelemetry Python Instrumentation
```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install
```

### Install Traffic Generator Dependencies
```bash
pip install requests numpy
```

---

## 6. 📦 Install Node.js Dependencies

### Dashboard Frontend
```bash
cd dashboard/frontend
npm install
cd ../..
```

### API Gateway Microservice
```bash
cd microservices/api-gateway
npm install
cd ../..
```

---

## 7. 🐇 Set Up RabbitMQ Stream Queue

With your virtual environment activated, create the telemetry stream queue:
```bash
source venv/bin/activate
python3 -c "
import pika
connection = pika.BlockingConnection(pika.ConnectionParameters(
    host='localhost',
    credentials=pika.PlainCredentials('telemetry', 'telemetry_password')
))
channel = connection.channel()
channel.queue_declare(queue='otel-telemetry', durable=True, arguments={'x-queue-type': 'stream'})
print('Queue otel-telemetry declared successfully.')
connection.close()
"
```

---

## 8. 🚀 Start the Stack

### Quick Start (All-in-One Script)
The project includes a master startup script that launches everything:
```bash
source venv/bin/activate
./start.sh
```

This starts:
- ✅ OTel Collector (Docker, ports 4317/4318)
- ✅ RabbitMQ Stream Queue setup
- ✅ Dashboard Backend (port 8000)
- ✅ Bytewax Stream Processor
- ✅ API Gateway microservice (port 3001)
- ✅ Quote Service microservice (port 5000)
- ✅ Dashboard Frontend (port 5173)

### Manual Start (Component by Component)
If you prefer to start each component individually in separate terminal tabs:

**Terminal 1 — OTel Collector (Docker)**
```bash
cd infra/otel-collector
docker compose up -d
```

**Terminal 2 — Dashboard Backend**
```bash
source venv/bin/activate
cd dashboard/backend
python main.py
```

**Terminal 3 — Bytewax Stream Processor**
```bash
source venv/bin/activate
cd stream-processor
python -m bytewax.run dataflow:flow
```

**Terminal 4 — Quote Service (Python microservice)**
```bash
source venv/bin/activate
OTEL_SERVICE_NAME=python-service \
  instrumentation/python-wrapper/run_instrumented.sh \
  venv/bin/python microservices/quote-service/main.py
```

**Terminal 5 — API Gateway (Node.js microservice)**
```bash
OTEL_SERVICE_NAME=api-gateway \
  instrumentation/node-wrapper/run_instrumented.sh \
  node microservices/api-gateway/index.js
```

**Terminal 6 — Dashboard Frontend**
```bash
cd dashboard/frontend
npm run dev
```

### Access Points
| Service              | URL                          |
| -------------------- | ---------------------------- |
| **Dashboard**        | http://localhost:5173         |
| **Backend API Docs** | http://localhost:8000/docs    |
| **RabbitMQ Mgmt**    | http://localhost:15672        |

---

## 9. 🔁 Generate Traffic (Optional)

With the full stack running, generate synthetic telemetry traffic:
```bash
source venv/bin/activate
./traffic.sh 60 mixed 10
```

Or directly:
```bash
python trigger_traffic.py --duration 60 --mode mixed --rps 10
```

**Traffic Modes:**
| Mode      | Description                                |
| --------- | ------------------------------------------ |
| `mixed`   | Paper distribution (80/10/5/5 split)       |
| `normal`  | Only normal requests                       |
| `anomaly` | N+1 + bimodal anomalies                    |
| `pii`     | PII redaction probing                      |
| `all`     | All endpoints equally                      |
| `burst`   | Ramp 20→100 RPS over duration              |

---

## 10. 🛑 Stop the Stack

### Quick Stop (Script)
```bash
./stop.sh
```

This cleanly stops all components, purges the RabbitMQ stream, and clears logs.

### Manual Stop
1. Press `Ctrl+C` in each terminal running a service
2. Stop the OTel Collector:
   ```bash
   cd infra/otel-collector
   docker compose down
   ```
3. (Optional) Clean up the telemetry database:
   ```bash
   rm -f dashboard/backend/telemetry.db
   ```

### Check Status
```bash
./status.sh
```
This shows the running state of all components and endpoints.

---

## 11. 🔍 Troubleshooting

### Permission denied on `.sh` scripts
```bash
chmod +x start.sh stop.sh status.sh traffic.sh
chmod +x instrumentation/*/run_instrumented.sh
```

### Port already in use
```bash
# Find what's using the port (e.g., 8000)
lsof -i :8000
# Kill it
kill -9 <PID>
```

### Docker not running
- Make sure **Docker Desktop** is open and fully started (whale icon in menu bar should be steady)

### RabbitMQ connection refused
- Check if RabbitMQ is running:
  ```bash
  brew services list | grep rabbitmq
  # If not running:
  brew services start rabbitmq
  ```
- Verify the `telemetry` user exists:
  ```bash
  rabbitmqctl list_users
  ```

### "command not found: rabbitmq-plugins"
- Add RabbitMQ to your PATH:
  ```bash
  # Apple Silicon:
  export PATH="/opt/homebrew/opt/rabbitmq/sbin:$PATH"
  # Intel:
  export PATH="/usr/local/opt/rabbitmq/sbin:$PATH"
  ```

### Python module not found errors
- Make sure the virtual environment is activated:
  ```bash
  source venv/bin/activate
  ```
- Reinstall the missing package:
  ```bash
  pip install <package-name>
  ```

### Frontend won't start
```bash
cd dashboard/frontend
rm -rf node_modules
npm install
npm run dev
```

### Apple Silicon compatibility issues
Some Python packages may need Rosetta or specific builds:
```bash
# If you encounter compilation errors:
arch -arm64 pip install <package-name>
```

---

## 12. 🏗️ Architecture Overview

```
ObserveX-main/
├── .env                          # Root environment config
├── .env.example                  # Template for .env
├── start.sh                      # Master startup script (macOS/Linux)
├── stop.sh                       # Master shutdown script (macOS/Linux)
├── status.sh                     # Stack health check script
├── traffic.sh                    # Synthetic traffic generator wrapper
├── trigger_traffic.py            # Python traffic generator
│
├── dashboard/
│   ├── backend/
│   │   ├── main.py               # FastAPI backend (port 8000)
│   │   ├── .env                  # Backend env config
│   │   └── telemetry.db          # SQLite DB (auto-created)
│   └── frontend/
│       ├── src/                   # React + Vite frontend
│       └── package.json
│
├── infra/
│   └── otel-collector/
│       ├── docker-compose.yaml   # OTel Collector container
│       └── config.yaml           # Collector pipeline config
│
├── instrumentation/
│   ├── node-wrapper/             # Node.js OTel auto-instrumentation
│   │   └── run_instrumented.sh
│   └── python-wrapper/           # Python OTel auto-instrumentation
│       └── run_instrumented.sh
│
├── microservices/
│   ├── api-gateway/              # Node.js Express gateway (port 3001)
│   └── quote-service/            # Python FastAPI service (port 5000)
│
└── stream-processor/
    ├── dataflow.py               # Bytewax stream processing pipeline
    ├── detectors.py              # Anomaly detection logic
    └── rabbit_source.py          # RabbitMQ stream source
```

### Data Flow
```
Microservices → OTel Collector (Docker) → RabbitMQ Stream → Bytewax → FastAPI Backend → SQLite
                                                                                         ↓
                                                                        React Dashboard ← Gemini AI (RCA)
```

---

> 📌 **Need help?** Check the project `README.md` for additional architecture diagrams and feature descriptions.
