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
        
        // Construir el nombre completo del cliente
        let clientName = 'Sin nombre';
        if (data.personalInfo) {
          const firstName = data.personalInfo.firstName || '';
          const lastName = data.personalInfo.lastName || '';
          clientName = `${firstName} ${lastName}`.trim() || 'Sin nombre';
        } else if (data.clientName) {
          clientName = data.clientName;
        }
        
        // Obtener el monto de la solicitud
        let amount = 0;
        if (data.financialInfo && data.financialInfo.loanAmount) {
          amount = data.financialInfo.loanAmount;
        } else if (data.requestedAmount) {
          amount = data.requestedAmount;
        } else if (data.amount) {
          amount = data.amount;
        }
        
        return {
          id: doc.id,
          clientName,
          amount,
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

  // Métricas generales
  fastify.get<{
    Params: { id: string };
  }>('/:id/metrics', {
    preHandler: authenticate,
    schema: {
      description: 'Métricas generales de la microfinanciera',
      tags: ['microfinancieras'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const applicationsSnap = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('loanApplications')
        .get();

      const accountsSnap = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('accounts')
        .where('status', '==', 'active')
        .get();

      const cardsSnap = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('cards')
        .where('status', '==', 'active')
        .get();

      const metrics: Record<string, number> = {};
      let totalDisbursed = 0;

      applicationsSnap.docs.forEach((doc) => {
        const data = doc.data();
        const status = (data.status as string) || 'pending';
        metrics[status] = (metrics[status] || 0) + 1;

        if (status === 'disbursed') {
          const amount =
            data.disbursementAmount ||
            data.approvedAmount ||
            data.amount ||
            data.requestedAmount ||
            data.financialInfo?.loanAmount ||
            0;
          totalDisbursed += Number(amount) || 0;
        }
      });

      return reply.send({
        activeAccounts: accountsSnap.size,
        activeCards: cardsSnap.size,
        applicationsInProcess:
          (metrics['pending'] || 0) +
          (metrics['requested'] || 0) +
          (metrics['observed'] || 0) +
          (metrics['in_review'] || 0),
        totalDisbursed,
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Tendencias de solicitudes por mes
  fastify.get<{
    Params: { id: string };
    Querystring: { period?: string };
  }>('/:id/trends', {
    preHandler: authenticate,
    schema: {
      description: 'Tendencia de solicitudes por mes',
      tags: ['microfinancieras'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const period = request.query.period || 'last_6_months';
    const months = period === 'last_12_months' ? 12 : 6;

    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

      const snapshot = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('loanApplications')
        .where('createdAt', '>=', start)
        .get();

      const buckets: Record<string, { approved: number; rejected: number }> = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const createdAt: any = data.createdAt;
        const dateObj = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt);
        const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

        if (!buckets[key]) {
          buckets[key] = { approved: 0, rejected: 0 };
        }
        if (data.status === 'approved' || data.status === 'disbursed') {
          buckets[key].approved += 1;
        } else if (data.status === 'rejected') {
          buckets[key].rejected += 1;
        }
      });

      // Asegurar meses faltantes con ceros
      const dataPoints: { month: string; approved: number; rejected: number }[] = [];
      for (let i = 0; i < months; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        dataPoints.push({
          month: key,
          approved: buckets[key]?.approved || 0,
          rejected: buckets[key]?.rejected || 0,
        });
      }

      return reply.send({ data: dataPoints });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Top analistas por solicitudes asignadas
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: number };
  }>('/:id/analysts/top', {
    preHandler: authenticate,
    schema: {
      description: 'Top analistas por solicitudes asignadas',
      tags: ['microfinancieras'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const limit = request.query.limit || 5;

    try {
      const snapshot = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('loanApplications')
        .where('assignedUserId', '!=', null)
        .get();

      const counts: Record<string, number> = {};
      snapshot.docs.forEach((doc) => {
        const analystId = doc.data().assignedUserId;
        if (analystId) {
          counts[analystId] = (counts[analystId] || 0) + 1;
        }
      });

      // Enriquecer con nombres y tasas de aprobación
      const userDocs = await Promise.all(
        Object.keys(counts).map((uid) =>
          db()
            .collection('microfinancieras')
            .doc(id)
            .collection('users')
            .doc(uid)
            .get()
        )
      );

      const approvalCounts: Record<string, { approved: number; total: number }> = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const analystId = data.assignedUserId;
        if (!analystId) return;
        if (!approvalCounts[analystId]) {
          approvalCounts[analystId] = { approved: 0, total: 0 };
        }
        approvalCounts[analystId].total += 1;
        if (data.status === 'approved' || data.status === 'disbursed') {
          approvalCounts[analystId].approved += 1;
        }
      });

      const validAnalysts = Object.entries(counts)
        .map(([analystId, total]) => {
          const userDoc = userDocs.find((d) => d.id === analystId);
          if (!userDoc || !userDoc.exists) return null; // omitir usuarios inexistentes
          const userData = userDoc.data();
          const approvalRate =
            approvalCounts[analystId] && approvalCounts[analystId].total > 0
              ? (approvalCounts[analystId].approved / approvalCounts[analystId].total) * 100
              : 0;
          return {
            id: analystId,
            name: userData?.displayName || userData?.email || analystId,
            applicationsReviewed: total,
            approvalRate,
          };
        })
        .filter((a): a is { id: string; name: string; applicationsReviewed: number; approvalRate: number } => a !== null)
        .sort((a, b) => b.applicationsReviewed - a.applicationsReviewed)
        .slice(0, limit);

      return reply.send({ analysts: validAnalysts });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Distribución de estados de solicitudes
  fastify.get<{
    Params: { id: string };
  }>('/:id/applications/status-distribution', {
    preHandler: authenticate,
    schema: {
      description: 'Distribución de estados de solicitudes',
      tags: ['microfinancieras'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const snapshot = await db()
        .collection('microfinancieras')
        .doc(id)
        .collection('loanApplications')
        .get();

      const distribution: Record<string, number> = {};
      snapshot.docs.forEach((doc) => {
        const status = (doc.data().status as string) || 'pending';
        distribution[status] = (distribution[status] || 0) + 1;
      });

      const total = snapshot.size;
      const items = Object.entries(distribution).map(([status, count]) => ({
        status,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      }));

      return reply.send({ distribution: items, total });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
