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
}
