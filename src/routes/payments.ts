import { FastifyInstance } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { PaymentService } from '../services/paymentService';

const paymentService = new PaymentService();

export async function paymentRoutes(fastify: FastifyInstance) {
  // Crear cargo con Culqi
  fastify.post<{
    Body: {
      tokenId: string;
      amount: number;
      currency: string;
      description: string;
      email: string;
      microfinancieraId: string;
      loanId?: string;
      accountId?: string;
      metadata?: Record<string, any>;
    };
  }>(
    '/create-charge',
    {
      preHandler: authenticate,
      schema: {
        description: 'Crear cargo con Culqi',
        tags: ['payments'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['tokenId', 'amount', 'currency', 'description', 'email', 'microfinancieraId'],
          properties: {
            tokenId: { type: 'string', description: 'Token de Culqi generado en el cliente' },
            amount: { type: 'number', description: 'Monto en centavos (ej: 1000 = 10.00 PEN)' },
            currency: { type: 'string', enum: ['PEN', 'USD'], default: 'PEN' },
            description: { type: 'string' },
            email: { type: 'string', format: 'email' },
            microfinancieraId: { type: 'string' },
            loanId: { type: 'string' },
            accountId: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const user = (request as AuthenticatedRequest).user;
        const { tokenId, amount, currency, description, email, microfinancieraId, loanId, accountId, metadata } = request.body;

        // Validar monto mínimo (1 PEN = 100 centavos)
        if (amount < 100) {
          return reply.code(400).send({ error: 'El monto mínimo es 1.00 PEN' });
        }

        // Crear cargo en Culqi
        const charge = await paymentService.createCharge({
          tokenId,
          amount,
          currency_code: currency,
          description,
          email,
          metadata: {
            ...metadata,
            userId: user.uid,
            microfinancieraId,
            loanId,
            accountId,
          },
        });

        // Registrar transacción en Firestore
        const transaction = await paymentService.recordTransaction({
          microfinancieraId,
          userId: user.uid,
          chargeId: charge.id,
          amount: amount / 100, // Convertir de centavos a unidades
          currency,
          status: charge.outcome.type === 'venta_exitosa' ? 'completed' : 'failed',
          description,
          loanId,
          accountId,
          stripeResponse: charge,
        });

        return reply.send({
          success: true,
          charge,
          transaction,
          message: 'Pago procesado exitosamente',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Error al procesar el pago',
          message: error.message,
          details: error.response?.data || error,
        });
      }
    }
  );

  // Obtener historial de pagos del usuario
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      loanId?: string;
      accountId?: string;
      limit?: number;
    };
  }>(
    '/history',
    {
      preHandler: authenticate,
      schema: {
        description: 'Obtener historial de pagos',
        tags: ['payments'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
            loanId: { type: 'string' },
            accountId: { type: 'string' },
            limit: { type: 'number', default: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const user = (request as AuthenticatedRequest).user;
        const { microfinancieraId, loanId, accountId, limit = 50 } = request.query;

        const transactions = await paymentService.getTransactionHistory({
          microfinancieraId,
          userId: user.uid,
          loanId,
          accountId,
          limit,
        });

        return reply.send({ transactions });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Verificar estado de un pago
  fastify.get<{
    Params: {
      chargeId: string;
    };
  }>(
    '/charge/:chargeId',
    {
      preHandler: authenticate,
      schema: {
        description: 'Verificar estado de un cargo',
        tags: ['payments'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { chargeId } = request.params;
        const charge = await paymentService.getCharge(chargeId);

        return reply.send({ charge });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
