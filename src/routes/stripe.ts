import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StripeService } from '../services/stripeService';
import Stripe from 'stripe';

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

      // Obtener el body como string
      const payload = JSON.stringify(request.body);

      // Verificar la firma del webhook
      let event: Stripe.Event;
      try {
        event = stripeService.verifyWebhookSignature(payload as any, signature);
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
   * Crear sesión de pago de Stripe (opcional, si quieres crear el link dinámicamente)
   */
  fastify.post('/create-checkout-session', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { amount, microfinancieraId, accountId, installments } = body;

      if (!amount || !microfinancieraId || !accountId || !installments) {
        return reply.code(400).send({ error: 'Faltan parámetros requeridos' });
      }

      const stripe = new Stripe(process.env.API_STRIPE_PRIV || '', {
        apiVersion: '2025-02-24.acacia',
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
        success_url: 'https://stripe.com/success',
        cancel_url: 'https://stripe.com/cancel',
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
