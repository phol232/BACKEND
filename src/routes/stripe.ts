import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StripeService } from '../services/stripeService';
import Stripe from 'stripe';
import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';

export async function stripeRoutes(fastify: FastifyInstance) {
  const stripeService = new StripeService();

  /**
   * Webhook de Stripe
   * Este endpoint recibe notificaciones de Stripe cuando ocurren eventos
   */
  fastify.post('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const signature = request.headers['stripe-signature'] as string;
      
      if (!signature) {
        return reply.code(400).send({ error: 'Falta la firma del webhook' });
      }

      // Obtener el raw body
      const payload = (request as any).rawBody;
      
      if (!payload) {
        console.error('❌ No raw body available');
        return reply.code(400).send({ error: 'No se pudo obtener el raw body' });
      }
      
      console.log('✅ Using rawBody, length:', payload.length);

      // Verificar la firma del webhook
      let event: Stripe.Event;
      try {
        event = stripeService.verifyWebhookSignature(payload, signature);
      } catch (error: any) {
        console.error('❌ Error al verificar webhook:', error);
        return reply.code(400).send({ error: 'Firma inválida' });
      }

      console.log('📨 Webhook recibido:', event.type);

      // Manejar diferentes tipos de eventos
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          
          console.log('✅ Pago completado:', session.id);
          
          // Extraer metadata del session
          const metadata = session.metadata || {};
          const microfinancieraId = metadata.microfinancieraId;
          const accountId = metadata.accountId;
          const installmentsData = metadata.installments;

          if (!microfinancieraId || !accountId || !installmentsData) {
            console.error('❌ Metadata incompleta en el session');
            return reply.code(200).send({ received: true });
          }

          // Parsear installments
          const installments = JSON.parse(installmentsData);

          // Procesar el pago
          await stripeService.processCompletedPayment({
            sessionId: session.id,
            microfinancieraId,
            accountId,
            installments,
          });

          break;
        }

        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          console.log('💰 PaymentIntent exitoso:', paymentIntent.id);
          
          // Extraer metadata del paymentIntent
          const metadata = paymentIntent.metadata || {};
          const microfinancieraId = metadata.microfinancieraId;
          const accountId = metadata.accountId;
          const installmentsData = metadata.installments;

          if (microfinancieraId && accountId && installmentsData) {
            try {
              // Parsear installments
              const installments = JSON.parse(installmentsData);

              // Procesar el pago directamente sin verificar sesión
              // (para PaymentIntent no hay sesión de checkout)
              console.log('💳 Procesando PaymentIntent:', paymentIntent.id);

              // Obtener userId del primer installment
              const firstInstallment = installments[0];
              const loanDoc = await db()
                .collection('microfinancieras')
                .doc(microfinancieraId)
                .collection('loanApplications')
                .doc(firstInstallment.loanId)
                .get();

              if (!loanDoc.exists) {
                throw new Error('Préstamo no encontrado');
              }

              const userId = loanDoc.data()?.userId;
              if (!userId) {
                throw new Error('Usuario no encontrado en el préstamo');
              }

              // Obtener o crear cuenta especial de Stripe
              const accountsSnapshot = await db()
                .collection('microfinancieras')
                .doc(microfinancieraId)
                .collection('accounts')
                .where('userId', '==', userId)
                .where('accountType', '==', 'stripe')
                .limit(1)
                .get();

              let stripeAccountId: string;
              if (!accountsSnapshot.empty) {
                stripeAccountId = accountsSnapshot.docs[0].id;
                console.log('✅ Cuenta Stripe existente:', stripeAccountId);
              } else {
                // Crear cuenta Stripe
                const accountData = {
                  userId,
                  accountType: 'stripe',
                  accountNumber: `STRIPE-${Date.now()}`,
                  balance: 0,
                  currency: 'PEN',
                  status: 'active',
                  description: 'Cuenta para pagos con Stripe',
                  createdAt: Timestamp.now(),
                  updatedAt: Timestamp.now(),
                };
                const accountRef = await db()
                  .collection('microfinancieras')
                  .doc(microfinancieraId)
                  .collection('accounts')
                  .add(accountData);
                stripeAccountId = accountRef.id;
                console.log('✅ Nueva cuenta Stripe creada:', stripeAccountId);
              }

              // Procesar cada cuota
              for (const installment of installments) {
                // Marcar cuota como pagada
                await db()
                  .collection('microfinancieras')
                  .doc(microfinancieraId)
                  .collection('loanApplications')
                  .doc(installment.loanId)
                  .collection('repaymentSchedule')
                  .doc(installment.installmentId)
                  .update({
                    status: 'paid',
                    paidAmount: installment.amount,
                    paidAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                  });

                // Registrar transacción
                await db()
                  .collection('microfinancieras')
                  .doc(microfinancieraId)
                  .collection('transactions')
                  .add({
                    type: 'payment',
                    accountId: stripeAccountId,
                    refType: 'account',
                    refId: stripeAccountId,
                    loanId: installment.loanId,
                    installmentId: installment.installmentId,
                    amount: installment.amount,
                    debit: installment.amount,
                    credit: 0,
                    currency: 'PEN',
                    paymentMethod: 'stripe',
                    stripePaymentIntent: paymentIntent.id,
                    status: 'completed',
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                  });

                console.log('✅ Cuota procesada:', installment.installmentId);
              }

              console.log('✅ PaymentIntent procesado exitosamente');
            } catch (error: any) {
              console.error('❌ Error procesando PaymentIntent:', error);
            }
          }
          
          break;
        }

        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          console.error('❌ PaymentIntent fallido:', paymentIntent.id);
          break;
        }

        default:
          console.log(`ℹ️ Evento no manejado: ${event.type}`);
      }

      return reply.code(200).send({ received: true });
    } catch (error: any) {
      console.error('❌ Error en webhook de Stripe:', error);
      return reply.code(500).send({ error: 'Error interno del servidor' });
    }
  });

  /**
   * Validar y procesar pago manualmente
   */
  fastify.post('/validate-payment', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { sessionId } = body;

      if (!sessionId) {
        return reply.code(400).send({ error: 'Session ID es requerido' });
      }

      console.log('🔍 Validando pago manual:', sessionId);

      // Verificar la sesión en Stripe
      const session = await stripeService.verifyPaymentSession(sessionId);

      if (session.payment_status !== 'paid') {
        return reply.code(400).send({ 
          error: 'El pago no está completado',
          paymentStatus: session.payment_status 
        });
      }

      // Extraer metadata
      const metadata = session.metadata || {};
      const microfinancieraId = metadata.microfinancieraId;
      const accountId = metadata.accountId;
      const installmentsData = metadata.installments;

      if (!microfinancieraId || !accountId || !installmentsData) {
        return reply.code(400).send({ 
          error: 'Metadata incompleta en la sesión',
          metadata 
        });
      }

      // Parsear installments
      const installments = JSON.parse(installmentsData);

      // Procesar el pago
      const result = await stripeService.processCompletedPayment({
        sessionId,
        microfinancieraId,
        accountId,
        installments,
      });

      console.log('✅ Pago validado y procesado exitosamente');

      return reply.send({
        paymentStatus: session.payment_status,
        ...result,
      });
    } catch (error: any) {
      console.error('❌ Error al validar pago:', error);
      return reply.code(500).send({ error: error.message || 'Error al validar el pago' });
    }
  });

  /**
   * Buscar sesiones de pago por fecha/hora
   */
  fastify.get('/search-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as any;
      const { startTime, endTime } = query;

      if (!startTime) {
        return reply.code(400).send({ error: 'startTime es requerido (timestamp en segundos)' });
      }

      const stripe = new Stripe(process.env.API_STRIPE_PRIV || '', {
        apiVersion: '2025-11-17.clover',
      });

      // Buscar sesiones en el rango de tiempo
      const sessions = await stripe.checkout.sessions.list({
        created: {
          gte: parseInt(startTime),
          ...(endTime && { lte: parseInt(endTime) }),
        },
        limit: 20,
      });

      const sessionsData = sessions.data.map(session => ({
        id: session.id,
        amount: session.amount_total ? session.amount_total / 100 : 0,
        currency: session.currency,
        paymentStatus: session.payment_status,
        created: new Date(session.created * 1000).toISOString(),
        metadata: session.metadata,
      }));

      return reply.send({ sessions: sessionsData });
    } catch (error: any) {
      console.error('❌ Error al buscar sesiones:', error);
      return reply.code(500).send({ error: 'Error al buscar sesiones' });
    }
  });

  /**
   * Crear PaymentIntent para usar con Payment Sheet (SDK móvil)
   */
  fastify.post('/create-payment-intent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { amount, microfinancieraId, accountId, installments } = body;

      if (!amount || !microfinancieraId || !accountId || !installments) {
        return reply.code(400).send({ error: 'Faltan parámetros requeridos' });
      }

      const stripe = new Stripe(process.env.API_STRIPE_PRIV || '', {
        apiVersion: '2025-11-17.clover',
      });

      // Crear Customer (opcional, pero recomendado para guardar métodos de pago)
      const customer = await stripe.customers.create({
        metadata: {
          microfinancieraId,
          accountId,
        },
      });

      // Crear Ephemeral Key para el customer
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customer.id },
        { apiVersion: '2025-11-17.clover' }
      );

      // Crear PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convertir a centavos
        currency: 'pen',
        customer: customer.id,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          microfinancieraId,
          accountId,
          installments: JSON.stringify(installments),
        },
      });

      console.log('✅ PaymentIntent creado:', paymentIntent.id);

      return reply.send({
        paymentIntent: paymentIntent.client_secret,
        ephemeralKey: ephemeralKey.secret,
        customer: customer.id,
        publishableKey: process.env.API_STRIPE_PUBLIC || '',
      });
    } catch (error: any) {
      console.error('❌ Error al crear PaymentIntent:', error);
      return reply.code(500).send({ error: 'Error al crear intención de pago' });
    }
  });

  /**
   * Crear sesión de pago de Stripe (para web/checkout externo)
   */
  fastify.post('/create-checkout-session', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { amount, microfinancieraId, accountId, installments } = body;

      if (!amount || !microfinancieraId || !accountId || !installments) {
        return reply.code(400).send({ error: 'Faltan parámetros requeridos' });
      }

      const stripe = new Stripe(process.env.API_STRIPE_PRIV || '', {
        apiVersion: '2025-11-17.clover',
      });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'pen',
              product_data: {
                name: 'Pago de Cuotas',
                description: `Pago de ${installments.length} cuota(s)`,
              },
              unit_amount: Math.round(amount * 100), // Convertir a centavos
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        ui_mode: 'hosted',
        // Stripe mostrará su página de confirmación antes de redirigir
        success_url: `${process.env.FRONTEND_URL || 'https://financiera-mocha.vercel.app'}/validate-payment?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://financiera-mocha.vercel.app'}/validate-payment?canceled=true`,
        metadata: {
          microfinancieraId,
          accountId,
          installments: JSON.stringify(installments),
        },
      });

      return reply.send({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error('❌ Error al crear sesión de Stripe:', error);
      return reply.code(500).send({ error: 'Error al crear sesión de pago' });
    }
  });
}
