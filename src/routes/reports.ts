import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { ReportService } from '../services/reportService';
import { db } from '../config/firebase';

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

      fastify.log.info({
        msg: 'Getting metrics',
        microfinancieraId,
        dateFrom,
        dateTo,
      });

      try {
        const metrics = await reportService.getConversionMetrics(microfinancieraId, {
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
        });

        fastify.log.info({
          msg: 'Metrics calculated',
          metrics,
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

  // Debug endpoint - Get all applications count
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
    };
  }>(
    '/debug/count',
    {
      preHandler: authenticate,
      schema: {
        description: 'Debug: Get total applications count by status',
        tags: ['reports'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId } = request.query;

      try {
        const snapshot = await db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .get();

        const statusCount: Record<string, number> = {};
        const applications: any[] = [];

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          const status = data.status || 'unknown';
          statusCount[status] = (statusCount[status] || 0) + 1;
          
          applications.push({
            id: doc.id,
            status: data.status,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || 'N/A',
            customerName: `${data.personalInfo?.firstName || ''} ${data.personalInfo?.lastName || ''}`.trim(),
          });
        });

        return reply.send({
          total: snapshot.size,
          byStatus: statusCount,
          applications: applications.slice(0, 10), // Solo primeras 10 para no saturar
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
