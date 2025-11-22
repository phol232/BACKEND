import { FastifyInstance } from 'fastify';
import * as admin from 'firebase-admin';
import { db } from '../config/firebase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roleAuth';

interface ProductPayload {
  microfinancieraId: string;
  code: string;
  name: string;
  description?: string;
  interestType?: string;
  rateNominal?: number;
  termMin?: number;
  termMax?: number;
  amountMin?: number;
  amountMax?: number;
  fees?: Record<string, number>;
  penalties?: Record<string, number>;
  status?: string;
}

export async function productRoutes(fastify: FastifyInstance) {
  // List products for a microfinanciera
  fastify.get<{
    Querystring: { microfinancieraId: string };
  }>('/', {
    preHandler: authenticate,
    schema: {
      description: 'Listar productos de crédito para una microfinanciera',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['microfinancieraId'],
        properties: {
          microfinancieraId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { microfinancieraId } = request.query;

    if (!microfinancieraId) {
      return reply.code(400).send({ error: 'microfinancieraId is required' });
    }

    try {
      const snapshot = await db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('products')
        .orderBy('createdAt', 'desc')
        .get();

      const products = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return reply.send({ products });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Create product (admin only)
  fastify.post<{
    Body: ProductPayload;
  }>('/', {
    preHandler: [authenticate, requireRole(['admin'])],
    schema: {
      description: 'Crear nuevo producto de crédito (solo admin)',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['microfinancieraId', 'code', 'name'],
        properties: {
          microfinancieraId: { type: 'string' },
          code: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          interestType: { type: 'string' },
          rateNominal: { type: 'number' },
          termMin: { type: 'number' },
          termMax: { type: 'number' },
          amountMin: { type: 'number' },
          amountMax: { type: 'number' },
          fees: { type: 'object' },
          penalties: { type: 'object' },
          status: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const payload = request.body;

    if (!payload.microfinancieraId) {
      return reply.code(400).send({ error: 'microfinancieraId is required' });
    }

    if (!payload.code?.trim() || !payload.name?.trim()) {
      return reply.code(400).send({ error: 'code and name are required' });
    }

    const microfinancieraId = payload.microfinancieraId;
    const code = payload.code.trim().toUpperCase();

    try {
      const productsRef = db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('products');

      // Prevent duplicated codes
      const existing = await productsRef.where('code', '==', code).limit(1).get();
      if (!existing.empty) {
        return reply.code(409).send({ error: 'Ya existe un producto con ese código' });
      }

      const now = admin.firestore.Timestamp.now();
      const productData = {
        code,
        name: payload.name.trim(),
        description: payload.description || '',
        interestType: payload.interestType || 'flat',
        rateNominal: payload.rateNominal ?? 0,
        termMin: payload.termMin ?? 0,
        termMax: payload.termMax ?? 0,
        amountMin: payload.amountMin ?? 0,
        amountMax: payload.amountMax ?? 0,
        fees: payload.fees || {},
        penalties: payload.penalties || {},
        status: payload.status || 'active',
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await productsRef.add(productData);

      return reply.code(201).send({
        product: {
          id: docRef.id,
          ...productData,
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Update product (admin only)
  fastify.put<{
    Params: { microfinancieraId: string; productId: string };
    Body: Partial<ProductPayload>;
  }>('/:microfinancieraId/:productId', {
    preHandler: [authenticate, requireRole(['admin'])],
    schema: {
      description: 'Actualizar producto de crédito (solo admin)',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['microfinancieraId', 'productId'],
        properties: {
          microfinancieraId: { type: 'string' },
          productId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          interestType: { type: 'string' },
          rateNominal: { type: 'number' },
          termMin: { type: 'number' },
          termMax: { type: 'number' },
          amountMin: { type: 'number' },
          amountMax: { type: 'number' },
          fees: { type: 'object' },
          penalties: { type: 'object' },
          status: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { microfinancieraId, productId } = request.params;
    const payload = request.body;

    if (!microfinancieraId || !productId) {
      return reply.code(400).send({ error: 'microfinancieraId y productId son requeridos' });
    }

    try {
      const productRef = db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('products')
        .doc(productId);

      const existing = await productRef.get();
      if (!existing.exists) {
        return reply.code(404).send({ error: 'Producto no encontrado' });
      }

      const updateData: Record<string, any> = {};

      if (payload.code !== undefined) updateData.code = payload.code.trim().toUpperCase();
      if (payload.name !== undefined) updateData.name = payload.name.trim();
      if (payload.description !== undefined) updateData.description = payload.description;
      if (payload.interestType !== undefined) updateData.interestType = payload.interestType;
      if (payload.rateNominal !== undefined) updateData.rateNominal = payload.rateNominal;
      if (payload.termMin !== undefined) updateData.termMin = payload.termMin;
      if (payload.termMax !== undefined) updateData.termMax = payload.termMax;
      if (payload.amountMin !== undefined) updateData.amountMin = payload.amountMin;
      if (payload.amountMax !== undefined) updateData.amountMax = payload.amountMax;
      if (payload.fees !== undefined) updateData.fees = payload.fees;
      if (payload.penalties !== undefined) updateData.penalties = payload.penalties;
      if (payload.status !== undefined) updateData.status = payload.status;

      updateData.updatedAt = admin.firestore.Timestamp.now();

      await productRef.update(updateData);

      const updatedDoc = await productRef.get();

      return reply.send({
        product: {
          id: updatedDoc.id,
          ...updatedDoc.data(),
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
