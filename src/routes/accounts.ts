import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { AccountService } from '../services/accountService';
import { AccountStatus } from '../types/account';

const accountService = new AccountService();

export async function accountRoutes(fastify: FastifyInstance) {
  // Listar cuentas con filtros
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      status?: AccountStatus;
      zone?: string;
      accountType?: 'personal' | 'business';
      startDate?: string;
      endDate?: string;
      limit?: number;
      page?: number;
    };
  }>(
    '/',
    {
      preHandler: authenticate,
      schema: {
        description: 'Listar cuentas con filtros',
        tags: ['accounts'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'active', 'blocked', 'closed', 'rejected'],
            },
            zone: { type: 'string' },
            accountType: { type: 'string', enum: ['personal', 'business'] },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            limit: { type: 'number', default: 100 },
            page: { type: 'number', default: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, status, zone, accountType, startDate, endDate, limit = 100, page = 1 } =
          request.query;

        const filters: any = {};
        if (status) filters.status = status;
        if (zone) filters.zone = zone;
        if (accountType) filters.accountType = accountType;
        if (startDate) filters.startDate = new Date(startDate);
        if (endDate) filters.endDate = new Date(endDate);
        filters.limit = Math.min(limit, 500); // Máximo 500 registros
        filters.page = page;

        const accounts = await accountService.getAccounts(microfinancieraId, filters);
        return reply.send({ 
          accounts,
          pagination: {
            page,
            limit: filters.limit,
            total: accounts.length,
          }
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Obtener cuenta por ID
  fastify.get<{
    Params: {
      microfinancieraId: string;
      accountId: string;
    };
  }>(
    '/:microfinancieraId/:accountId',
    {
      preHandler: authenticate,
      schema: {
        description: 'Obtener ficha completa de cuenta',
        tags: ['accounts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, accountId } = request.params;
        const account = await accountService.getAccount(microfinancieraId, accountId);

        if (!account) {
          return reply.code(404).send({ error: 'Cuenta no encontrada' });
        }

        // Obtener historial de transiciones
        const history = await accountService.getAccountHistory(microfinancieraId, accountId);

        return reply.send({ account, history });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Aprobar cuenta (trabajador)
  fastify.post<{
    Params: {
      microfinancieraId: string;
      accountId: string;
    };
  }>(
    '/:microfinancieraId/:accountId/approve',
    {
      preHandler: authenticate,
      schema: {
        description: 'Aprobar cuenta',
        tags: ['accounts'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, accountId } = request.params;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || request.headers['x-forwarded-for'] as string;

        await accountService.approveAccount(microfinancieraId, accountId, user.uid, ipAddress);

        return reply.send({ success: true, message: 'Cuenta aprobada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Rechazar cuenta (trabajador)
  fastify.post<{
    Params: {
      microfinancieraId: string;
      accountId: string;
    };
    Body: {
      reason: string;
    };
  }>(
    '/:microfinancieraId/:accountId/reject',
    {
      preHandler: authenticate,
      schema: {
        description: 'Rechazar cuenta',
        tags: ['accounts'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, accountId } = request.params;
        const { reason } = request.body;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || request.headers['x-forwarded-for'] as string;

        await accountService.rejectAccount(
          microfinancieraId,
          accountId,
          user.uid,
          reason,
          ipAddress
        );

        return reply.send({ success: true, message: 'Cuenta rechazada exitosamente' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Cambiar estado de cuenta (admin: activar/bloquear/cerrar)
  fastify.put<{
    Params: {
      microfinancieraId: string;
      accountId: string;
    };
    Body: {
      status: AccountStatus;
      reason?: string;
    };
  }>(
    '/:microfinancieraId/:accountId/status',
    {
      preHandler: authenticate,
      schema: {
        description: 'Cambiar estado de cuenta (admin)',
        tags: ['accounts'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['active', 'blocked', 'closed'],
            },
            reason: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, accountId } = request.params;
        const { status, reason } = request.body;
        const user = (request as AuthenticatedRequest).user;
        const ipAddress = request.ip || request.headers['x-forwarded-for'] as string;

        await accountService.changeAccountStatus(
          microfinancieraId,
          accountId,
          status,
          user.uid,
          reason,
          ipAddress
        );

        return reply.send({ success: true, message: `Estado cambiado a ${status}` });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Listar solo cuentas activas con KPIs
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
    };
  }>(
    '/active',
    {
      preHandler: authenticate,
      schema: {
        description: 'Listar cuentas activas con KPIs',
        tags: ['accounts'],
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
      try {
        const { microfinancieraId } = request.query;

        const accounts = await accountService.getAccounts(microfinancieraId, {
          status: 'active',
        });
        const kpis = await accountService.getActiveAccountsKPIs(microfinancieraId);

        return reply.send({ accounts, kpis });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Exportar lista filtrada
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      status?: AccountStatus;
      zone?: string;
      accountType?: 'personal' | 'business';
      startDate?: string;
      endDate?: string;
      format?: 'csv' | 'excel';
    };
  }>(
    '/export',
    {
      preHandler: authenticate,
      schema: {
        description: 'Exportar lista de cuentas filtrada',
        tags: ['accounts'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['microfinancieraId'],
          properties: {
            microfinancieraId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'active', 'blocked', 'closed', 'rejected'],
            },
            zone: { type: 'string' },
            accountType: { type: 'string', enum: ['personal', 'business'] },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            format: { type: 'string', enum: ['csv', 'excel'], default: 'csv' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { microfinancieraId, format = 'csv', ...filters } = request.query;

        const accounts = await accountService.getAccounts(microfinancieraId, filters as any);

        // TODO: Implementar exportService para CSV/Excel
        // Por ahora retornamos JSON
        return reply.send({
          accounts,
          exportedAt: new Date().toISOString(),
          format,
          count: accounts.length,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}

