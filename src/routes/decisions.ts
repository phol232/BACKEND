import { FastifyInstance } from 'fastify';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth';
import { DecisionService } from '../services/decisionService';

const decisionService = new DecisionService();

export async function decisionRoutes(fastify: FastifyInstance) {
  // Make manual decision
  fastify.post<{
    Body: {
      microfinancieraId: string;
      applicationId: string;
      result: 'approved' | 'rejected' | 'observed';
      comments?: string;
    };
  }>(
    '/manual',
    {
      preHandler: authenticate,
      // onRequest: requireRole(['analyst', 'admin']), // Deshabilitado temporalmente para testing
      schema: {
        description: 'Make manual decision on application',
        tags: ['decisions'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'applicationId', 'result'],
          properties: {
            microfinancieraId: { type: 'string' },
            applicationId: { type: 'string' },
            result: { type: 'string', enum: ['approved', 'rejected', 'observed'] },
            comments: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId, result, comments } = request.body;
      const user = (request as AuthenticatedRequest).user;

      try {
        let finalComments = comments?.trim() || '';

        if (result === 'approved' && finalComments.length === 0) {
          finalComments = 'Aprobado automáticamente';
        }

        if (
          (result === 'rejected' || result === 'observed') &&
          finalComments.length < 5
        ) {
          return reply.code(400).send({
            error: 'Los comentarios deben tener al menos 5 caracteres para rechazar o condicionar una solicitud.',
          });
        }

        const decision = await decisionService.makeManualDecision(
          microfinancieraId,
          applicationId,
          result,
          finalComments,
          user.uid
        );

        return reply.send({
          success: true,
          decision,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get decision statistics
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      startDate: string;
      endDate: string;
    };
  }>(
    '/stats',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get decision statistics',
        tags: ['decisions'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, startDate, endDate } = request.query;

      try {
        const stats = await decisionService.getDecisionStatistics(
          microfinancieraId,
          new Date(startDate),
          new Date(endDate)
        );

        return reply.send({ stats });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
