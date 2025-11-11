import { FastifyInstance } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { ScoringService } from '../services/scoringService';
import { ValidationService } from '../services/validationService';
import { DecisionService } from '../services/decisionService';
import { db } from '../config/firebase';

const scoringService = new ScoringService();
const validationService = new ValidationService();
const decisionService = new DecisionService();

export async function scoringRoutes(fastify: FastifyInstance) {
  // Calculate scoring and make decision
  fastify.post<{
    Body: {
      microfinancieraId: string;
      applicationId: string;
    };
  }>(
    '/calculate',
    {
      preHandler: authenticate,
      schema: {
        description: 'Calculate scoring and make automatic decision',
        tags: ['scoring'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'applicationId'],
          properties: {
            microfinancieraId: { type: 'string' },
            applicationId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              scoring: { type: 'object' },
              decision: { type: 'object' },
              processingTime: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId } = request.body;

      try {
        const startTime = Date.now();

        // Get application
        const appRef = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .doc(applicationId);

        const appDoc = await appRef.get();
        if (!appDoc.exists) {
          return reply.code(404).send({ error: 'Application not found' });
        }

        const application = appDoc.data() as any;
        fastify.log.info({
          msg: 'Application data loaded',
          id: application.id || applicationId,
          status: application.status,
          hasFinancialInfo: !!application.financialInfo,
          hasEmploymentInfo: !!application.employmentInfo,
          hasAdditionalInfo: !!application.additionalInfo,
        });

        // VALIDACIÓN CRÍTICA: No permitir recalcular scoring de préstamos desembolsados
        if (application.status === 'disbursed') {
          return reply.code(400).send({ 
            error: 'No se puede recalcular el scoring de un préstamo ya desembolsado' 
          });
        }

        // Validate (pero no bloquear el cálculo)
        const validation = validationService.validate(application);
        if (!validation.isValid) {
          fastify.log.warn({
            msg: 'Validation warnings',
            errors: validation.errors,
          });
          // Continuar con el cálculo pero marcar como riesgoso
        }

        // Calculate scoring
        const scoring = await scoringService.calculateScore(application);

        // Save scoring
        await appRef.update({
          scoring,
          status: 'decision',
          updatedAt: new Date(),
        });

        // Make automatic decision
        const decision = await decisionService.makeAutomaticDecision(
          microfinancieraId,
          applicationId,
          scoring
        );

        // Update status based on decision
        // CAMBIO: No cambiar a 'approved' automáticamente, mantener en 'decision' para revisión
        let newStatus = 'decision';
        if (decision.result === 'rejected') newStatus = 'rejected';
        else if (decision.result === 'observed') newStatus = 'observed';
        // Si es 'approved' (por decisión manual), mantener en 'decision' hasta aprobación final

        await appRef.update({ status: newStatus, decision });

        const processingTime = Date.now() - startTime;

        // Serializar objetos para JSON (convertir Timestamps a strings)
        const scoringResponse = {
          score: scoring.score,
          band: scoring.band,
          reasonCodes: scoring.reasonCodes,
          modelVersion: scoring.modelVersion,
          calculatedAt: scoring.calculatedAt instanceof Date
            ? scoring.calculatedAt.toISOString()
            : new Date().toISOString(),
          details: scoring.details,
        };

        const decisionResponse = {
          result: decision.result,
          decidedBy: decision.decidedBy || null,
          decidedAt: decision.decidedAt instanceof Date
            ? decision.decidedAt.toISOString()
            : new Date().toISOString(),
          comments: decision.comments || '',
          isAutomatic: decision.isAutomatic,
        };

        fastify.log.info({
          msg: 'Sending response',
          scoringResponse,
          decisionResponse,
        });

        return reply.send({
          success: true,
          scoring: scoringResponse,
          decision: decisionResponse,
          processingTime,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get scoring details
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
        description: 'Get scoring details for an application',
        tags: ['scoring'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            microfinancieraId: { type: 'string' },
            applicationId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, applicationId } = request.params;

      try {
        const appDoc = await db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .doc(applicationId)
          .get();

        if (!appDoc.exists) {
          return reply.code(404).send({ error: 'Application not found' });
        }

        const data = appDoc.data();
        return reply.send({
          scoring: data?.scoring || null,
          decision: data?.decision || null,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Configurar umbrales y pesos del score (admin)
  fastify.post<{
    Body: {
      microfinancieraId: string;
      thresholds: {
        approve: number;
        reject: number;
        condition: number;
      };
      weights: Record<string, number>;
      version: string;
    };
  }>(
    '/config',
    {
      preHandler: authenticate,
      schema: {
        description: 'Configurar umbrales y pesos del score (admin)',
        tags: ['scoring'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['microfinancieraId', 'thresholds', 'weights', 'version'],
          properties: {
            microfinancieraId: { type: 'string' },
            thresholds: {
              type: 'object',
              required: ['approve', 'reject', 'condition'],
              properties: {
                approve: { type: 'number' },
                reject: { type: 'number' },
                condition: { type: 'number' },
              },
            },
            weights: { type: 'object' },
            version: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { microfinancieraId, thresholds, weights, version } = request.body;
      const user = (request as AuthenticatedRequest).user;

      try {
        const configRef = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('scoringConfig')
          .doc('current');

        await configRef.set({
          thresholds,
          weights,
          version,
          updatedAt: new Date(),
          updatedBy: user.uid,
        });

        // Guardar versión histórica
        await db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('scoringConfig')
          .doc(`version-${version}`)
          .set({
            thresholds,
            weights,
            version,
            createdAt: new Date(),
            createdBy: user.uid,
          });

        return reply.send({
          success: true,
          message: 'Configuración de score guardada exitosamente',
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Obtener configuración actual
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
    };
  }>(
    '/config',
    {
      preHandler: authenticate,
      schema: {
        description: 'Obtener configuración actual de score',
        tags: ['scoring'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId } = request.query;

      try {
        const configDoc = await db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('scoringConfig')
          .doc('current')
          .get();

        if (!configDoc.exists) {
          return reply.code(404).send({ error: 'Configuración no encontrada' });
        }

        return reply.send({ config: configDoc.data() });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Monitorear tasa de aprobación y métricas del modelo
  fastify.get<{
    Querystring: {
      microfinancieraId: string;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/metrics',
    {
      preHandler: authenticate,
      schema: {
        description: 'Monitorear tasa de aprobación y métricas del modelo',
        tags: ['scoring'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { microfinancieraId, startDate, endDate } = request.query;

      try {
        let query = db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('loanApplications')
          .where('scoring', '!=', null);

        if (startDate) {
          query = query.where('createdAt', '>=', new Date(startDate)) as any;
        }
        if (endDate) {
          query = query.where('createdAt', '<=', new Date(endDate)) as any;
        }

        const snapshot = await query.get();
        const applications = snapshot.docs.map((doc) => doc.data());

        const total = applications.length;
        const approved = applications.filter((a) => a.status === 'approved' || a.status === 'disbursed').length;
        const rejected = applications.filter((a) => a.status === 'rejected').length;
        const conditioned = applications.filter((a) => a.status === 'conditioned').length;

        const scores = applications
          .map((a) => a.scoring?.totalScore || a.scoring?.score || 0)
          .filter((s) => s > 0);

        const avgScore = scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;

        const metrics = {
          totalApplications: total,
          approved: approved,
          rejected: rejected,
          conditioned: conditioned,
          approvalRate: total > 0 ? (approved / total) * 100 : 0,
          rejectionRate: total > 0 ? (rejected / total) * 100 : 0,
          averageScore: avgScore,
          minScore: scores.length > 0 ? Math.min(...scores) : 0,
          maxScore: scores.length > 0 ? Math.max(...scores) : 0,
          period: {
            startDate: startDate || null,
            endDate: endDate || null,
          },
        };

        return reply.send({ metrics });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
