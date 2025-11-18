# Optimizaciones de Backend

## Problema Identificado

El backend está respondiendo lento porque:
1. **Sin límites en consultas**: Trae TODOS los documentos de Firestore
2. **Sin paginación**: No hay control sobre cuántos registros se retornan
3. **Enriquecimiento de datos lento**: Hace consultas adicionales para cada registro
4. **Sin caché**: Cada request hace consultas a Firestore

## Cambios Aplicados

### 1. Límites en Consultas (`accountService.ts`)

**Antes:**
```typescript
const snapshot = await query.get(); // Sin límite
```

**Después:**
```typescript
const limit = Math.min(filters?.limit || 100, 500); // Default 100, máximo 500
query = query.limit(limit);
```

### 2. Paginación (`accounts.ts`)

**Antes:**
```typescript
const accounts = await accountService.getAccounts(microfinancieraId, filters);
```

**Después:**
```typescript
const accounts = await accountService.getAccounts(microfinancieraId, {
  ...filters,
  limit: 100,
  page: 1
});
```

## Optimizaciones Pendientes

### 1. Implementar Caché con Redis o Node-Cache

```bash
npm install node-cache
```

```typescript
import NodeCache from 'node-cache';
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutos

async getAccounts(microfinancieraId: string, filters?: any) {
  const cacheKey = `accounts_${microfinancieraId}_${JSON.stringify(filters)}`;
  
  const cached = cache.get<Account[]>(cacheKey);
  if (cached) {
    console.log('✅ Cache hit:', cacheKey);
    return cached;
  }
  
  const accounts = await this.fetchAccountsFromFirestore(microfinancieraId, filters);
  cache.set(cacheKey, accounts);
  
  return accounts;
}
```

### 2. Optimizar Enriquecimiento de Datos

**Problema actual**: Hace 1 consulta por cada cuenta para obtener datos del usuario

**Solución**: Batch queries

```typescript
// En lugar de:
for (const account of accounts) {
  const user = await getUserData(account.userId);
}

// Hacer:
const userIds = accounts.map(a => a.userId);
const users = await batchGetUsers(userIds); // 1 sola consulta
```

### 3. Índices de Firestore

Crear índices compuestos en `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "accounts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "mfId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "mfId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "loanApplications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "mfId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "assignedUserId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

### 4. Lazy Loading de Datos Relacionados

No cargar datos relacionados automáticamente, solo cuando se soliciten:

```typescript
// En lugar de cargar todo:
GET /api/accounts/:id
{
  account: {...},
  history: [...],  // ❌ Siempre carga
  transactions: [...],  // ❌ Siempre carga
  documents: [...]  // ❌ Siempre carga
}

// Hacer endpoints separados:
GET /api/accounts/:id  // Solo datos básicos
GET /api/accounts/:id/history  // Solo cuando se necesite
GET /api/accounts/:id/transactions  // Solo cuando se necesite
GET /api/accounts/:id/documents  // Solo cuando se necesite
```

### 5. Compresión de Respuestas

```bash
npm install @fastify/compress
```

```typescript
import compress from '@fastify/compress';

fastify.register(compress, {
  global: true,
  threshold: 1024, // Comprimir respuestas > 1KB
});
```

### 6. Rate Limiting

```bash
npm install @fastify/rate-limit
```

```typescript
import rateLimit from '@fastify/rate-limit';

fastify.register(rateLimit, {
  max: 100, // 100 requests
  timeWindow: '1 minute'
});
```

### 7. Query Optimization

**Evitar múltiples where clauses sin índices:**

```typescript
// ❌ Lento sin índice compuesto
query
  .where('status', '==', 'active')
  .where('zone', '==', 'Lima')
  .where('accountType', '==', 'personal');

// ✅ Mejor: Filtrar en el cliente si no hay índice
const accounts = await query
  .where('status', '==', 'active')
  .get();

const filtered = accounts.filter(a => 
  a.zone === 'Lima' && 
  a.accountType === 'personal'
);
```

### 8. Parallel Queries

Ejecutar consultas independientes en paralelo:

```typescript
// ❌ Secuencial (lento)
const accounts = await getAccounts();
const cards = await getCards();
const applications = await getApplications();

// ✅ Paralelo (rápido)
const [accounts, cards, applications] = await Promise.all([
  getAccounts(),
  getCards(),
  getApplications(),
]);
```

### 9. Select Only Needed Fields

```typescript
// ❌ Trae todos los campos
const snapshot = await query.get();

// ✅ Solo campos necesarios (si Firestore lo soporta)
const snapshot = await query
  .select('id', 'status', 'displayName', 'balance')
  .get();
```

### 10. Monitoring y Logging

```bash
npm install pino pino-pretty
```

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

// Log slow queries
const start = Date.now();
const accounts = await getAccounts();
const duration = Date.now() - start;

if (duration > 1000) {
  logger.warn({ duration, query: 'getAccounts' }, 'Slow query detected');
}
```

## Métricas Objetivo

- **Response Time**: < 500ms para listas
- **Response Time**: < 200ms para detalles
- **Cache Hit Rate**: > 70%
- **Database Queries**: < 5 por request

## Implementación Prioritaria

1. ✅ Agregar límites a consultas (HECHO)
2. ✅ Agregar paginación (HECHO)
3. ⏳ Implementar caché con node-cache
4. ⏳ Crear índices en Firestore
5. ⏳ Optimizar enriquecimiento de datos
6. ⏳ Agregar compresión
7. ⏳ Implementar lazy loading
8. ⏳ Agregar monitoring

## Testing

```bash
# Probar con límites
curl "http://localhost:3001/api/accounts?microfinancieraId=mf_demo_001&limit=10"

# Probar paginación
curl "http://localhost:3001/api/accounts?microfinancieraId=mf_demo_001&limit=10&page=2"

# Medir tiempo de respuesta
time curl "http://localhost:3001/api/accounts?microfinancieraId=mf_demo_001"
```
