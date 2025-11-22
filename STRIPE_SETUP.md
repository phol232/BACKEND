# Configuración de Stripe

## 1. Configurar Webhook en Stripe

1. Ve a https://dashboard.stripe.com/test/webhooks
2. Click en "Add endpoint"
3. URL del endpoint: `https://tu-backend.vercel.app/api/stripe/webhook`
4. Selecciona estos eventos:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copia el **Signing secret** (empieza con `whsec_...`)
6. Agrégalo a tu `.env` como `STRIPE_WEBHOOK_SECRET`

## 2. Configurar Payment Link

### Opción A: Usar Payment Link existente
Ya tienes uno configurado: `https://buy.stripe.com/test_aFaeVdefsfxAaVbAsfw401`

### Opción B: Crear Payment Link dinámico
Usa el endpoint `/api/stripe/create-checkout-session` para crear sesiones dinámicas con metadata.

## 3. Agregar Metadata al Payment Link

Para que el webhook funcione correctamente, necesitas agregar metadata al Payment Link:

1. Ve a https://dashboard.stripe.com/test/payment-links
2. Edita tu Payment Link
3. En "Metadata", agrega:
   - `microfinancieraId`: ID de la microfinanciera
   - `accountId`: ID de la cuenta
   - `installments`: JSON con las cuotas a pagar

**Ejemplo de metadata:**
```json
{
  "microfinancieraId": "mf_demo_001",
  "accountId": "acc_123",
  "installments": "[{\"loanId\":\"loan_1\",\"installmentId\":\"inst_1\",\"amount\":851.04}]"
}
```

## 4. Flujo de Pago

1. Usuario hace click en "Pagar con Stripe" en la app
2. Se abre el Payment Link de Stripe
3. Usuario completa el pago
4. Stripe envía webhook a `/api/stripe/webhook`
5. Backend verifica el pago
6. Backend marca las cuotas como pagadas
7. Backend registra las transacciones

## 5. Testing

### Tarjetas de prueba:
- **Éxito**: 4242 4242 4242 4242
- **Requiere autenticación**: 4000 0025 0000 3155
- **Declinada**: 4000 0000 0000 9995

### Fecha de expiración: Cualquier fecha futura
### CVV: Cualquier 3 dígitos

## 6. Variables de Entorno

```env
API_STRIPE_PUBLIC=pk_test_...
API_STRIPE_PRIV=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 7. Endpoints Disponibles

- `POST /api/stripe/webhook` - Recibe webhooks de Stripe
- `POST /api/stripe/create-checkout-session` - Crea sesión de pago dinámica

## 8. Logs

El backend registra todos los eventos:
- ✅ Pago completado
- 💰 PaymentIntent exitoso
- ❌ PaymentIntent fallido
- 📨 Webhook recibido

## 9. Troubleshooting

### Webhook no funciona:
1. Verifica que la URL sea accesible públicamente
2. Verifica que el `STRIPE_WEBHOOK_SECRET` sea correcto
3. Revisa los logs en Stripe Dashboard → Webhooks → Attempts

### Metadata no se recibe:
1. Asegúrate de agregar metadata al Payment Link
2. O usa el endpoint `/create-checkout-session` para crear sesiones dinámicas

### Cuotas no se marcan como pagadas:
1. Verifica que el `microfinancieraId`, `loanId` e `installmentId` sean correctos
2. Revisa los logs del backend
3. Verifica que las cuotas existan en Firestore
