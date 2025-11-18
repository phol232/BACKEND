import { FastifyInstance } from 'fastify';
import { db } from '../config/firebase';

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
}

