# 🖥️ ObserveX (MonoXAI) — Windows Setup Guide

> **Complete step-by-step instructions to set up the full ObserveX / MonoXAI observability stack on Windows.**

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

Make sure the following are installed on your Windows machine:

| Tool               | Version    | Download Link                                              |
| ------------------ | ---------- | ---------------------------------------------------------- |
| **Python**         | 3.10+      | https://www.python.org/downloads/                          |
| **Node.js**        | 18+        | https://nodejs.org/                                        |
| **Docker Desktop** | Latest     | https://www.docker.com/products/docker-desktop/            |
| **RabbitMQ**       | 3.9+       | https://www.rabbitmq.com/install-windows.html              |
| **Erlang/OTP**     | (Required) | https://www.erlang.org/downloads (required before RabbitMQ)|
| **Git**            | Latest     | https://git-scm.com/download/win                           |

---

## 2. 🔧 Install Prerequisites

### Python
1. Download from https://www.python.org/downloads/
2. **IMPORTANT**: Check ✅ **"Add Python to PATH"** during installation
3. Verify:
   ```powershell
   python --version    # Should show 3.10+
   pip --version
   ```

### Node.js
1. Download the LTS version from https://nodejs.org/
2. Run the installer (includes npm)
3. Verify:
   ```powershell
   node --version    # Should show 18+
   npm --version
   ```

### Docker Desktop
1. Download from https://www.docker.com/products/docker-desktop/
2. Install and restart your PC if prompted
3. Launch Docker Desktop and wait for it to fully start
4. Verify:
   ```powershell
   docker --version
   docker compose version
   ```

### RabbitMQ
1. **Install Erlang first**: Download from https://www.erlang.org/downloads
2. **Install RabbitMQ**: Download from https://www.rabbitmq.com/install-windows.html
3. Enable required plugins — open a **PowerShell as Administrator**:
   ```powershell
   # Navigate to RabbitMQ sbin directory (adjust path if needed)
   cd "C:\Program Files\RabbitMQ Server\rabbitmq_server-*\sbin"

   # Enable required plugins
   .\rabbitmq-plugins.bat enable rabbitmq_stream rabbitmq_management
   ```
4. Restart the RabbitMQ service:
   ```powershell
   net stop RabbitMQ
   net start RabbitMQ
   ```
5. Create the telemetry user (run in the same sbin directory):
   ```powershell
   .\rabbitmqctl.bat add_user telemetry telemetry_password
   .\rabbitmqctl.bat set_permissions -p / telemetry ".*" ".*" ".*"
   .\rabbitmqctl.bat set_user_tags telemetry administrator
   ```
6. Verify RabbitMQ management is running: open http://localhost:15672 (login: `guest` / `guest`)

---

## 3. 📂 Clone / Copy the Project

If you received a ZIP file:
```powershell
# Extract the ZIP, then navigate to the project
cd C:\path\to\ObserveX-main
```

If cloning from Git:
```powershell
git clone <your-repo-url> ObserveX-main
cd ObserveX-main
```

---

## 4. ⚙️ Environment Configuration

The project uses `.env` files for configuration. Two copies are needed:

### Root `.env`
```powershell
# Copy the example to create your .env
copy .env.example .env
```

### Backend `.env`
```powershell
copy .env.example dashboard\backend\.env
```

### Edit the `.env` files
Open each `.env` file and set your **Gemini API Key**:
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
```powershell
cd C:\path\to\ObserveX-main
python -m venv venv
.\venv\Scripts\Activate.ps1
```

> ⚠️ If you get an execution policy error, run this first:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

### Install Backend Dependencies
```powershell
pip install fastapi uvicorn aiosqlite python-dotenv google-generativeai pydantic httpx
```

### Install Stream Processor Dependencies
```powershell
pip install -r stream-processor\requirements.txt
```

### Install Quote Service Dependencies
```powershell
pip install -r microservices\quote-service\requirements.txt
```

### Install OpenTelemetry Python Instrumentation
```powershell
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install
```

### Install Traffic Generator Dependencies
```powershell
pip install requests numpy
```

---

## 6. 📦 Install Node.js Dependencies

### Dashboard Frontend
```powershell
cd dashboard\frontend
npm install
cd ..\..
```

### API Gateway Microservice
```powershell
cd microservices\api-gateway
npm install
cd ..\..
```

---

## 7. 🐇 Set Up RabbitMQ Stream Queue

With your virtual environment activated, create the telemetry stream queue:
```powershell
.\venv\Scripts\Activate.ps1
python -c "
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

### Quick Start (Dashboard Only)
Use the provided PowerShell script for the simplest startup:
```powershell
.\start-windows.ps1
```
This starts:
- ✅ Dashboard Backend (port 8000)
- ✅ Dashboard Frontend (port 5173)

### Full Stack Start (All Components)
To run the complete observability pipeline, start each component in separate PowerShell terminals:

**Terminal 1 — OTel Collector (Docker)**
```powershell
cd infra\otel-collector
docker compose up -d
```

**Terminal 2 — Dashboard Backend**
```powershell
cd dashboard\backend
..\..\venv\Scripts\python.exe main.py
```

**Terminal 3 — Bytewax Stream Processor**
```powershell
cd stream-processor
..\..\venv\Scripts\python.exe -m bytewax.run dataflow:flow
```

**Terminal 4 — Quote Service (Python microservice)**
```powershell
$env:OTEL_SERVICE_NAME="python-service"
$env:OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
$env:OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
cd microservices\quote-service
..\..\venv\Scripts\opentelemetry-instrument.exe python main.py
```

**Terminal 5 — API Gateway (Node.js microservice)**
```powershell
$env:OTEL_SERVICE_NAME="api-gateway"
$env:OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
$env:NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"
cd microservices\api-gateway
node index.js
```

**Terminal 6 — Dashboard Frontend**
```powershell
cd dashboard\frontend
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
```powershell
.\venv\Scripts\Activate.ps1
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

### Quick Stop (Dashboard Only)
```powershell
.\stop-windows.ps1
```

### Full Stack Stop
1. Press `Ctrl+C` in each terminal running a service
2. Stop the OTel Collector:
   ```powershell
   cd infra\otel-collector
   docker compose down
   ```
3. (Optional) Clean up the telemetry database:
   ```powershell
   Remove-Item dashboard\backend\telemetry.db -Force -ErrorAction SilentlyContinue
   ```

---

## 11. 🔍 Troubleshooting

### "execution policy" error when running `.ps1` scripts
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Port already in use
```powershell
# Find what's using the port (e.g., 8000)
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
# Kill it
Stop-Process -Id <PID> -Force
```

### Docker not running
- Make sure **Docker Desktop** is open and fully started (whale icon in the system tray should be steady, not animating)

### RabbitMQ connection refused
- Ensure RabbitMQ service is running:
  ```powershell
  Get-Service RabbitMQ
  # If stopped:
  Start-Service RabbitMQ
  ```
- Verify the `telemetry` user exists:
  ```powershell
  cd "C:\Program Files\RabbitMQ Server\rabbitmq_server-*\sbin"
  .\rabbitmqctl.bat list_users
  ```

### Python module not found errors
- Make sure the virtual environment is activated:
  ```powershell
  .\venv\Scripts\Activate.ps1
  ```
- Reinstall the missing package:
  ```powershell
  pip install <package-name>
  ```

### Frontend won't start
```powershell
cd dashboard\frontend
Remove-Item -Recurse -Force node_modules
npm install
npm run dev
```

---

## 12. 🏗️ Architecture Overview

```
ObserveX-main/
├── .env                          # Root environment config
├── .env.example                  # Template for .env
├── start-windows.ps1             # Quick-start script (Windows)
├── stop-windows.ps1              # Quick-stop script (Windows)
├── trigger_traffic.py            # Synthetic traffic generator
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
│   └── python-wrapper/           # Python OTel auto-instrumentation
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
