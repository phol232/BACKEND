import { FastifyInstance } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { RoutingService } from '../services/routingService';
import { ValidationService } from '../services/validationService';
import { AuditService } from '../services/auditService';
import { db } from '../config/firebase';

const routingService = new RoutingService();
const validationService = new ValidationService();
const auditService = new AuditService();

export async function applicationRoutes(fastify: FastifyInstance) {
  // Listar todas las aplicaciones con filtros
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      status?: string;
      zone?: string;
      productId?: string;
      startDate?: string;
      endDate?: string;
      assignedUserId?: string;
    };
  }>(
    '/',
    {
      preHandler: authenticate,
      schema: {
        description: 'Listar solicitudes con filtros (estado, zona, producto, fecha)',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
            status: { type: 'string' },
            zone: { type: 'string' },
            productId: { type: 'string' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            assignedUserId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, status, zone, productId, startDate, endDate, assignedUserId } =
        request.query;

      try {
        let query = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .orderBy('createdAt', 'desc');

        if (status) {
          query = query.where('status', '==', status) as any;
        }
        if (zone) {
          query = query.where('zone', '==', zone) as any;
        }
        if (productId) {
          query = query.where('productId', '==', productId) as any;
        }
        if (assignedUserId) {
          query = query.where('routing.agentId', '==', assignedUserId) as any;
        }
        if (startDate) {
          query = query.where('createdAt', '>=', new Date(startDate)) as any;
        }
        if (endDate) {
          query = query.where('createdAt', '<=', new Date(endDate)) as any;
        }

        const snapshot = await query.get();
        const applications = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        return reply.send({ applications });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get applications assigned to agent
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      agentId: string;
      status?: string;
    };
  }>(
    '/assigned',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get applications assigned to an agent',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId', 'agentId'],
          properties: {
            microfinancieraId: { type: 'string' },
            agentId: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, agentId, status } = request.query;

      try {
        let query = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .where('routing.agentId', '==', agentId);

        if (status) {
          query = query.where('status', '==', status);
        }

        const snapshot = await query.orderBy('createdAt', 'desc').get();
        const applications = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        return reply.send({ applications });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get application by ID
  fastify.get<{
    Params: {
      microfinancieraId: string;
      applicationId: string;
    };
  }>(
    '/:microfinancieraId/:applicationId',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get application details',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId } = request.params;

      try {
        const doc = await db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .doc(applicationId)
          .get();

        if (!doc.exists) {
          return reply.code(404).send({ error: 'Application not found' });
        }

        return reply.send({
          id: doc.id,
          ...doc.data(),
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Asignar aplicación a analista
  fastify.post<{
    Body: {
      microfinancieraId: string;
      applicationId: string;
      analystId: string;
    };
  }>(
    '/assign',
    {
      preHandler: authenticate,
      schema: {
        description: 'Asignar aplicación a analista',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'applicationId', 'analystId'],
          properties: {
            microfinancieraId: { type: 'string' },
            applicationId: { type: 'string' },
            analystId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId, analystId } = request.body;
      const user = (request as AuthenticatedRequest).user;

      try {
        const appRef = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .doc(applicationId);

        const appDoc = await appRef.get();
        if (!appDoc.exists) {
          return reply.code(404).send({ error: 'Application not found' });
        }

        const currentStatus = appDoc.data()?.status;
        if (currentStatus === 'disbursed') {
          return reply.code(400).send({
            error: 'No se puede asignar una aplicación ya desembolsada',
          });
        }

        // Actualizar asignación
        await appRef.update({
          'routing.agentId': analystId,
          'routing.assignedAt': new Date(),
          assignedUserId: analystId,
          updatedAt: new Date(),
        });

        // Si está en pending, cambiar a in_evaluation
        if (currentStatus === 'pending' || currentStatus === 'received') {
          await appRef.update({
            status: 'in_evaluation',
          });
        }

        // Audit log
        await auditService.log(
          user.uid,
          'APPLICATION_ASSIGNED',
          'loanApplication',
          applicationId,
          { assignedUserId: appDoc.data()?.assignedUserId },
          { assignedUserId: analystId },
          applicationId
        );

        return reply.send({ success: true, message: 'Aplicación asignada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Take ownership of application
  fastify.post<{
    Body: {
      microfinancieraId: string;
      applicationId: string;
      agentId: string;
    };
  }>(
    '/take-ownership',
    {
      preHandler: authenticate,
      schema: {
        description: 'Take ownership of an application',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'applicationId', 'agentId'],
          properties: {
            microfinancieraId: { type: 'string' },
            applicationId: { type: 'string' },
            agentId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId, agentId } = request.body;
      const user = (request as AuthenticatedRequest).user;

      try {
        const appRef = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .doc(applicationId);

        const appDoc = await appRef.get();
        if (!appDoc.exists) {
          return reply.code(404).send({ error: 'Application not found' });
        }

        // Update routing
        await appRef.update({
          'routing.agentId': agentId,
          'routing.assignedAt': new Date(),
          status: 'in_review',
          updatedAt: new Date(),
        });

        // Audit log
        await auditService.log(
          user.uid,
          'TAKE_OWNERSHIP',
          'loanApplication',
          applicationId,
          {},
          { agentId },
          applicationId
        );

        return reply.send({ success: true });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Update application status
  fastify.patch<{
    Params: {
      microfinancieraId: string;
      applicationId: string;
    };
    Body: {
      status: string;
      reason?: string;
    };
  }>(
    '/:microfinancieraId/:applicationId/status',
    {
      preHandler: authenticate,
      schema: {
        description: 'Update application status',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId } = request.params;
      const { status, reason } = request.body;
      const user = (request as AuthenticatedRequest).user;

      try {
        const appRef = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .doc(applicationId);

        const appDoc = await appRef.get();
        if (!appDoc.exists) {
          return reply.code(404).send({ error: 'Application not found' });
        }

        const currentStatus = appDoc.data()?.status;

        // VALIDACIÓN CRÍTICA: No permitir cambiar estado de préstamos desembolsados
        if (currentStatus === 'disbursed') {
          return reply.code(400).send({
            error: 'No se puede cambiar el estado de un préstamo ya desembolsado',
          });
        }

        await appRef.update({
          status,
          updatedAt: new Date(),
        });

        // Log transition
        await appRef.collection('transitions').add({
          from: currentStatus,
          to: status,
          timestamp: new Date(),
          userId: user.uid,
          reason,
        });

        return reply.send({ success: true });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get application stats
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      agentId?: string;
    };
  }>(
    '/stats',
    {
      preHandler: authenticate,
      schema: {
        description: 'Get application statistics',
        tags: ['applications'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, agentId } = request.query;

      try {
        let query = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications');

        if (agentId) {
          query = query.where('routing.agentId', '==', agentId) as any;
        }

        const snapshot = await query.get();

        const stats: Record<string, number> = {};
        snapshot.docs.forEach((doc) => {
          const status = doc.data().status;
          stats[status] = (stats[status] || 0) + 1;
        });

        return reply.send({ stats });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
