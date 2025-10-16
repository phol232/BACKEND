import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { ReportService } from '../services/reportService';

const reportService = new ReportService();

export async function reportRoutes(fastify: FastifyInstance) {
  // Generate report
  fastify.post<{
    Body: {
      microfinancieraId: string;
      dateFrom: string;
      dateTo: string;
      branchId?: string;
      agentId?: string;
      status?: string;
      format: 'json' | 'csv';
    };
  }>(
    '/generate',
    {
      preHandler: authenticate,
      schema: {
        description: 'Generate applications report',
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'dateFrom', 'dateTo', 'format'],
          properties: {
            microfinancieraId: { type: 'string' },
            dateFrom: { type: 'string', format: 'date-time' },
            dateTo: { type: 'string', format: 'date-time' },
            branchId: { type: 'string' },
            agentId: { type: 'string' },
            status: { type: 'string' },
            format: { type: 'string', enum: ['json', 'csv'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, dateFrom, dateTo, branchId, agentId, status, format } =
        request.body;

      try {
        const filters = {
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
          branchId,
          agentId,
          status: status as any,
        };

        const applications = await reportService.generateApplicationsReport(
          microfinancieraId,
          filters
        );

        if (format === 'csv') {
          const csv = reportService.generateCSV(applications);
          reply.header('Content-Type', 'text/csv');
          reply.header('Content-Disposition', 'attachment; filename=report.csv');
          return reply.send(csv);
        }

        return reply.send({
          success: true,
          format: 'json',
          data: applications,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get conversion metrics
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      dateFrom: string;
      dateTo: string;
    };
  }>(
    '/metrics',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get conversion metrics',
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, dateFrom, dateTo } = request.query;

      try {
        const metrics = await reportService.getConversionMetrics(microfinancieraId, {
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
        });

        return reply.send({ metrics });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get agent performance
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      agentId: string;
      dateFrom: string;
      dateTo: string;
    };
  }>(
    '/agent-performance',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get agent performance metrics',
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, agentId, dateFrom, dateTo } = request.query;

      try {
        const performance = await reportService.getAgentPerformance(
          microfinancieraId,
          agentId,
          {
            dateFrom: new Date(dateFrom),
            dateTo: new Date(dateTo),
          }
        );

        return reply.send({ performance });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
