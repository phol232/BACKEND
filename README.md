# Microfinance Backend API

Backend REST API con Fastify + TypeScript para sistema de microfinanzas.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials

# Run in development
npm run dev

# Build for production
npm run build

# Run production
npm start
```

## 📡 API Endpoints

### Health Check
- `GET /health` - Server health status

### Applications
- `GET /api/applications/assigned` - Get assigned applications
- `GET /api/applications/:mfId/:appId` - Get application details
- `POST /api/applications/take-ownership` - Take ownership
- `PATCH /api/applications/:mfId/:appId/status` - Update status
- `GET /api/applications/stats` - Get statistics

### Scoring
- `POST /api/scoring/calculate` - Calculate scoring and decision
- `GET /api/scoring/:mfId/:appId` - Get scoring details

### Decisions
- `POST /api/decisions/manual` - Make manual decision
- `GET /api/decisions/stats` - Get decision statistics

### Disbursements
- `POST /api/disbursements/disburse` - Disburse loan
- `GET /api/disbursements/schedule/:mfId/:appId` - Get repayment schedule
- `GET /api/disbursements/accounting/:mfId/:appId` - Get accounting entries

### Reports
- `POST /api/reports/generate` - Generate report (JSON/CSV)
- `GET /api/reports/metrics` - Get conversion metrics
- `GET /api/reports/agent-performance` - Get agent performance

### Tracking (Public)
- `GET /api/tracking/:token` - Get application status by token
- `POST /api/tracking/generate-token` - Generate tracking token

### Webhooks
- `POST /api/webhooks/firestore` - Receive Firestore events
- `POST /api/webhooks/process-pending` - Process pending applications

## 📚 Documentation

Swagger UI available at: `http://localhost:3000/docs`

## 🔐 Authentication

All endpoints (except tracking and webhooks) require Firebase ID token:

```bash
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

## 🌐 Deploy

### Vercel (Recommended - Easiest)

```bash
# Option 1: Dashboard (5 minutes)
# 1. Push to GitHub
# 2. Go to vercel.com → Import repository
# 3. Root directory: backend
# 4. Add environment variables
# 5. Deploy

# Option 2: CLI
npm install -g vercel
vercel login
cd backend
vercel
# Follow prompts and add environment variables
vercel --prod
```

**See**: `DEPLOY_VERCEL.md` for detailed guide

### Railway

```bash
railway login
railway init
railway variables set FIREBASE_PROJECT_ID=...
railway up
```

### Render

1. Connect GitHub repo
2. Create Web Service
3. Build: `cd backend && npm install && npm run build`
4. Start: `cd backend && npm start`
5. Add environment variables

### Fly.io

```bash
fly auth login
cd backend
fly launch
fly secrets set FIREBASE_PROJECT_ID=...
fly deploy
```

**See**: `DEPLOYMENT_OPTIONS.md` for comparison

## 🧪 Testing

```bash
# Health check
curl http://localhost:3000/health

# Get docs
open http://localhost:3000/docs
```

## 📦 Tech Stack

- **Fastify** - Fast web framework
- **TypeScript** - Type safety
- **Firebase Admin** - Firestore & Auth
- **Brevo** - Email notifications
- **JWT** - Token generation
- **Swagger** - API documentation

## 🔧 Environment Variables

See `.env.example` for required variables.

## 📝 License

MIT
