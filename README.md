# Backend - API Microfinanciera

API REST desarrollada con Fastify y TypeScript para la gestión de cuentas, tarjetas y solicitudes de crédito.

## Stack Tecnológico

- **Fastify** (framework web)
- **TypeScript**
- **Firebase Admin SDK** (Firestore)
- **Brevo** (envío de correos)
- **JWT** (autenticación)

## Instalación

```bash
cd backend
npm install
```

## Configuración

Crea un archivo `.env` en la raíz del proyecto `backend/`:

```env
PORT=3000
NODE_ENV=development

# Firebase
FIREBASE_PROJECT_ID=tu-project-id
FIREBASE_CLIENT_EMAIL=tu-client-email
FIREBASE_PRIVATE_KEY="tu-private-key"

# Brevo (Email)
BREVO_API_KEY=tu-api-key
BREVO_FROM_EMAIL=noreply@microfinanciera.com
BREVO_FROM_NAME=Microfinanciera

# JWT
JWT_SECRET=tu-secret-key-super-segura

# Server
SERVER_URL=http://localhost:3000
ADMIN_EMAIL=admin@microfinanciera.com
```

## Desarrollo

```bash
npm run dev
```

La API estará disponible en `http://localhost:3000`
La documentación Swagger estará disponible en `http://localhost:3000/docs` (solo en desarrollo)

## Estructura del Proyecto

```
backend/
├── src/
│   ├── config/             # Configuración (Firebase, variables de entorno)
│   ├── middleware/         # Middlewares (auth, roles)
│   ├── routes/             # Rutas de la API
│   │   ├── accounts.ts     # Gestión de cuentas
│   │   ├── cards.ts        # Gestión de tarjetas
│   │   ├── applications.ts # Solicitudes de crédito
│   │   └── scoring.ts      # Configuración y métricas de scoring
│   ├── services/           # Lógica de negocio
│   │   ├── accountService.ts
│   │   ├── cardService.ts
│   │   ├── emailService.ts
│   │   ├── auditService.ts
│   │   └── exportService.ts
│   ├── types/              # Tipos TypeScript
│   │   ├── account.ts
│   │   └── card.ts
│   └── server.ts           # Punto de entrada
└── scripts/                 # Scripts de utilidad
```

## Endpoints Principales

### Cuentas (`/api/accounts`)
- `GET /` - Listar cuentas con filtros
- `GET /:microfinancieraId/:accountId` - Obtener cuenta por ID
- `POST /:microfinancieraId/:accountId/approve` - Aprobar cuenta
- `POST /:microfinancieraId/:accountId/reject` - Rechazar cuenta
- `PUT /:microfinancieraId/:accountId/status` - Cambiar estado (admin)
- `GET /active` - Listar cuentas activas con KPIs
- `GET /export` - Exportar lista filtrada

### Tarjetas (`/api/cards`)
- `GET /` - Listar tarjetas con filtros
- `GET /:microfinancieraId/:cardId` - Obtener tarjeta por ID
- `POST /:microfinancieraId/:cardId/approve` - Aprobar tarjeta
- `POST /:microfinancieraId/:cardId/reject` - Rechazar tarjeta
- `PUT /:microfinancieraId/:cardId/suspend` - Suspender tarjeta (admin)
- `PUT /:microfinancieraId/:cardId/reactivate` - Reactivar tarjeta (admin)
- `PUT /:microfinancieraId/:cardId/close` - Cerrar tarjeta (admin)
- `GET /active` - Listar tarjetas activas con métricas

### Solicitudes (`/api/applications`)
- `GET /` - Listar solicitudes con filtros
- `GET /:microfinancieraId/:applicationId` - Obtener solicitud por ID
- `POST /assign` - Asignar solicitud a analista
- `PATCH /:microfinancieraId/:applicationId/status` - Cambiar estado

### Scoring (`/api/scoring`)
- `POST /config` - Configurar umbrales y pesos (admin)
- `GET /config` - Obtener configuración actual
- `GET /metrics` - Obtener métricas del modelo

## Autenticación

Todos los endpoints requieren autenticación mediante JWT Bearer token:

```
Authorization: Bearer <token>
```

El token se obtiene mediante Firebase Auth en el frontend.

## Base de Datos

La aplicación utiliza **Firebase Firestore** con estructura multi-tenant:

```
microfinancieras/
  {mfId}/
    accounts/          # Cuentas de clientes
    cards/             # Tarjetas
    loanApplications/  # Solicitudes de crédito
    users/             # Usuarios del sistema
    scoringConfig/     # Configuración de scoring
```

## Estados y Transiciones

### Cuentas
- `pending` → `active` (aprobación) o `rejected` (rechazo)
- `active` ↔ `blocked` (admin)
- `active`/`blocked` → `closed` (admin)

### Tarjetas
- `pending` → `active` (aprobación) o `rejected` (rechazo)
- `active` ↔ `suspended` (admin)
- `active`/`suspended` → `closed` (admin)

## Auditoría

Todas las acciones importantes se registran en la colección `auditLogs` con:
- Usuario que realizó la acción
- Tipo de acción
- Entidad afectada
- Estado antes y después
- IP de origen
- Timestamp

## Notificaciones por Email

El sistema envía emails automáticamente cuando:
- Una cuenta es aprobada/rechazada
- Una tarjeta cambia de estado
- Una solicitud es procesada

Los emails se envían mediante **Brevo** (anteriormente Sendinblue).

## Próximos Pasos

- [ ] Implementar exportación CSV/Excel completa
- [ ] Agregar más métricas y KPIs
- [ ] Implementar sistema de pagos
- [ ] Agregar sistema de incidencias
- [ ] Mejorar validaciones y manejo de errores
- [ ] Agregar tests unitarios e integración
