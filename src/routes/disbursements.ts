import { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth';
import { DisbursementService } from '../services/disbursementService';

const disbursementService = new DisbursementService();

export async function disbursementRoutes(fastify: FastifyInstance) {
  // Disburse loan
  fastify.post<{
    Body: {
      microfinancieraId: string;
      applicationId: string;
      requestId: string;
    };
  }>(
    '/disburse',
    {
      preHandler: authenticate,
      // onRequest: requireRole(['admin']), // Deshabilitado temporalmente para testing
      schema: {
        description: 'Disburse approved loan',
        tags: ['disbursements'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'applicationId', 'requestId'],
          properties: {
            microfinancieraId: { type: 'string' },
            applicationId: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId, requestId } = request.body;

      fastify.log.info({
        msg: 'Disbursing loan',
        microfinancieraId,
        applicationId,
        requestId,
      });

      try {
        await disbursementService.disburseLoan(
          microfinancieraId,
          applicationId,
          requestId
        );

        return reply.send({
          success: true,
          message: 'Loan disbursed successfully',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get repayment schedule
  fastify.get<{
    Params: {
      microfinancieraId: string;
      applicationId: string;
    };
  }>(
    '/schedule/:microfinancieraId/:applicationId',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get repayment schedule',
        tags: ['disbursements'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId } = request.params;

      try {
        const schedule = await disbursementService.getRepaymentSchedule(
          microfinancieraId,
          applicationId
        );

        return reply.send({ schedule });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get accounting entries
  fastify.get<{
    Params: {
      microfinancieraId: string;
      applicationId: string;
    };
  }>(
    '/accounting/:microfinancieraId/:applicationId',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get accounting entries',
        tags: ['disbursements'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId } = request.params;

      try {
        const entries = await disbursementService.getAccountingEntries(
          microfinancieraId,
          applicationId
        );

        return reply.send({ entries });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
