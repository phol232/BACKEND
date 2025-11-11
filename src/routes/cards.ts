import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { CardService } from '../services/cardService';
import { CardStatus } from '../types/card';

const cardService = new CardService();

export async function cardRoutes(fastify: FastifyInstance) {
  // Listar tarjetas con filtros
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      status?: CardStatus;
      cardType?: 'debit' | 'credit' | 'prepaid';
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/',
    {
      preHandler: authenticate,
      schema: {
        description: 'Listar tarjetas con filtros',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'active', 'suspended', 'closed', 'rejected'],
            },
            cardType: { type: 'string', enum: ['debit', 'credit', 'prepaid'] },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, status, cardType, startDate, endDate } = request.query;

        const filters: any = {};
        if (status) filters.status = status;
        if (cardType) filters.cardType = cardType;
        if (startDate) filters.startDate = new Date(startDate);
        if (endDate) filters.endDate = new Date(endDate);

        const cards = await cardService.getCards(microfinancieraId, filters);
        return reply.send({ cards });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Obtener tarjeta por ID
  fastify.get<{
    Params: {
      microfinancieraId: string;
      cardId: string;
    };
  }>(
    '/:microfinancieraId/:cardId',
    {
      preHandler: authenticate,
      schema: {
        description: 'Obtener detalles de tarjeta con documentos',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, cardId } = request.params;
        const card = await cardService.getCard(microfinancieraId, cardId);

        if (!card) {
          return reply.code(404).send({ error: 'Tarjeta no encontrada' });
        }

        // Obtener historial de transiciones
        const history = await cardService.getCardHistory(microfinancieraId, cardId);

        return reply.send({ card, history });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Aprobar tarjeta (trabajador)
  fastify.post<{
    Params: {
      microfinancieraId: string;
      cardId: string;
    };
  }>(
    '/:microfinancieraId/:cardId/approve',
    {
      preHandler: authenticate,
      schema: {
        description: 'Aprobar tarjeta',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, cardId } = request.params;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || (request.headers['x-forwarded-for'] as string);

        await cardService.approveCard(microfinancieraId, cardId, user.uid, ipAddress);

        return reply.send({ success: true, message: 'Tarjeta aprobada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Rechazar tarjeta (trabajador)
  fastify.post<{
    Params: {
      microfinancieraId: string;
      cardId: string;
    };
    Body: {
      reason: string;
      evidence?: string;
    };
  }>(
    '/:microfinancieraId/:cardId/reject',
    {
      preHandler: authenticate,
      schema: {
        description: 'Rechazar tarjeta',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string' },
            evidence: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, cardId } = request.params;
        const { reason, evidence } = request.body;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || (request.headers['x-forwarded-for'] as string);

        await cardService.rejectCard(
          microfinancieraId,
          cardId,
          user.uid,
          reason,
          evidence,
          ipAddress
        );

        return reply.send({ success: true, message: 'Tarjeta rechazada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Suspender tarjeta (admin)
  fastify.put<{
    Params: {
      microfinancieraId: string;
      cardId: string;
    };
    Body: {
      reason: string;
      evidence?: string;
    };
  }>(
    '/:microfinancieraId/:cardId/suspend',
    {
      preHandler: authenticate,
      schema: {
        description: 'Suspender tarjeta por fraude',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string' },
            evidence: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, cardId } = request.params;
        const { reason, evidence } = request.body;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || (request.headers['x-forwarded-for'] as string);

        await cardService.suspendCard(
          microfinancieraId,
          cardId,
          user.uid,
          reason,
          evidence,
          ipAddress
        );

        return reply.send({ success: true, message: 'Tarjeta suspendida exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Reactivar tarjeta (admin)
  fastify.put<{
    Params: {
      microfinancieraId: string;
      cardId: string;
    };
  }>(
    '/:microfinancieraId/:cardId/reactivate',
    {
      preHandler: authenticate,
      schema: {
        description: 'Reactivar tarjeta suspendida',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, cardId } = request.params;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || (request.headers['x-forwarded-for'] as string);

        await cardService.reactivateCard(microfinancieraId, cardId, user.uid, ipAddress);

        return reply.send({ success: true, message: 'Tarjeta reactivada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Cerrar tarjeta (admin)
  fastify.put<{
    Params: {
      microfinancieraId: string;
      cardId: string;
    };
    Body: {
      reason: string;
      evidence?: string;
    };
  }>(
    '/:microfinancieraId/:cardId/close',
    {
      preHandler: authenticate,
      schema: {
        description: 'Cerrar tarjeta',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string' },
            evidence: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, cardId } = request.params;
        const { reason, evidence } = request.body;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || (request.headers['x-forwarded-for'] as string);

        await cardService.closeCard(
          microfinancieraId,
          cardId,
          user.uid,
          reason,
          evidence,
          ipAddress
        );

        return reply.send({ success: true, message: 'Tarjeta cerrada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Listar tarjetas activas con métricas
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
    };
  }>(
    '/active',
    {
      preHandler: authenticate,
      schema: {
        description: 'Listar tarjetas activas con métricas',
        tags: ['cards'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId } = request.query;

        const cards = await cardService.getCards(microfinancieraId, { status: 'active' });
        const metrics = await cardService.getActiveCardsMetrics(microfinancieraId);

        return reply.send({ cards, metrics });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}

