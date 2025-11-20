import { FastifyInstance } from 'fastify';
import { db } from '../config/firebase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

export async function microfinancieraRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      description: 'Obtener todas las microfinancieras activas',
      tags: ['microfinancieras'],
      response: {
        200: {
          type: 'object',
          properties: {
            microfinancieras: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  legalName: { type: 'string' },
                  address: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  website: { type: 'string' },
                  ruc: { type: 'string' },
                }
              }
            }
          }
        }
      }
    },
  }, async (request, reply) => {
    try {
      const snapshot = await db()
        .collection('microfinancieras')
        .where('isActive', '==', true)
        .get();

      const microfinancieras = snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || 'Sin nombre',
        legalName: doc.data().legalName || '',
        address: doc.data().address || '',
        phone: doc.data().phone || '',
        email: doc.data().email || '',
        website: doc.data().website || '',
        ruc: doc.data().ruc || '',
      }));

      return reply.send({ microfinancieras });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Obtener aplicaciones de una microfinanciera
  fastify.get<{
    Params: { id: string };
    Querystring: {
      status?: string;
      zone?: string;
      productId?: string;
      assignedUserId?: string;
      limit?: number;
    };
  }>('/:id/applications', {
    preHandler: authenticate,
    schema: {
      description: 'Obtener aplicaciones de una microfinanciera',
      tags: ['microfinancieras'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          zone: { type: 'string' },
          productId: { type: 'string' },
          assignedUserId: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, zone, productId, assignedUserId, limit } = request.query;
    const authRequest = request as AuthenticatedRequest;
    const user = authRequest.user;

    try {
      let query: any = db()
        .collection('microfinancieras')
        .doc(id)
        .collection('loanApplications');

      // Si el usuario es analista, solo mostrar solicitudes asignadas a él
      if (user?.role === 'analyst') {
        query = query.where('assignedUserId', '==', user.uid);
      } else if (assignedUserId) {
        query = query.where('assignedUserId', '==', assignedUserId);
      }

      if (status) {
        query = query.where('status', '==', status);
      }
      if (zone) {
        query = query.where('zone', '==', zone);
      }
      if (productId) {
        query = query.where('productId', '==', productId);
      }

      query = query.orderBy('createdAt', 'desc');
      
      if (limit) {
        query = query.limit(limit);
      }

      const snapshot = await query.get();
      const applications = snapshot.docs.map((doc: any) => {
        const data = doc.data();
        return {
          id: doc.id,
          clientName: data.personalInfo?.fullName || data.clientName || 'Sin nombre',
          amount: data.requestedAmount || data.amount || 0,
          status: data.status || 'pending',
          createdAt: data.createdAt,
          zone: data.zone,
          productId: data.productId,
          assignedUserId: data.assignedUserId,
          ...data,
        };
      });

      return reply.send({ 
        applications,
        total: applications.length 
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Obtener estadísticas de un analista
  fastify.get<{
    Params: { id: string; analystId: string };
  }>('/:id/analysts/:analystId/stats', {
    preHandler: authenticate,
    schema: {
      description: 'Obtener estadísticas de un analista',
      tags: ['microfinancieras'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          analystId: { type: 'string' }
        },
        required: ['id', 'analystId']
      }
    }
  }, async (request, reply) => {
    const { id, analystId } = request.params;

    try {
      const applicationsSnapshot = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('loanApplications')
        .where('assignedUserId', '==', analystId)
        .get();

      const total = applicationsSnapshot.size;
      const approved = applicationsSnapshot.docs.filter(doc => doc.data().status === 'approved').length;
      const pending = applicationsSnapshot.docs.filter(doc => doc.data().status === 'pending').length;
      const observed = applicationsSnapshot.docs.filter(doc => doc.data().status === 'observed').length;
      const rejected = applicationsSnapshot.docs.filter(doc => doc.data().status === 'rejected').length;

      const approvalRate = total > 0 ? (approved / total) * 100 : 0;

      return reply.send({
        total,
        approved,
        pending,
        observed,
        rejected,
        approvalRate: parseFloat(approvalRate.toFixed(2))
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}


