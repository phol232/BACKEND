import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { db } from '../config/firebase';

export async function workerRoutes(fastify: FastifyInstance) {
  // Buscar analistas por nombre
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      search?: string;
    };
  }>(
    '/analysts',
    {
      preHandler: authenticate,
      schema: {
        description: 'Buscar analistas por nombre',
        tags: ['workers'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
            search: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, search } = request.query;

      try {
        let query = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('workers')
          .where('roleIds', 'array-contains', 'analyst')
          .where('isActive', '==', true);

        const snapshot = await query.get();
        
        let analysts = snapshot.docs.map((doc) => ({
          id: doc.id,
          userId: doc.data().userId,
          displayName: doc.data().displayName || doc.data().email,
          email: doc.data().email,
          dni: doc.data().dni,
          phone: doc.data().phone,
        }));

        // Filtrar por búsqueda si se proporciona
        if (search && search.trim()) {
          const searchLower = search.toLowerCase().trim();
          analysts = analysts.filter((analyst) => {
            const displayName = (analyst.displayName || '').toLowerCase();
            const email = (analyst.email || '').toLowerCase();
            const dni = (analyst.dni || '').toLowerCase();
            return (
              displayName.includes(searchLower) ||
              email.includes(searchLower) ||
              dni.includes(searchLower)
            );
          });
        }

        return reply.send({ analysts });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Obtener todos los workers activos
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
    };
  }>(
    '/',
    {
      preHandler: authenticate,
      schema: {
        description: 'Obtener todos los trabajadores activos',
        tags: ['workers'],
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
      const { microfinancieraId } = request.query;

      try {
        const snapshot = await db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('workers')
          .where('isActive', '==', true)
          .get();

        const workers = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        return reply.send({ workers });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}

