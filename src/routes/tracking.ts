import { FastifyInstance } from 'fastify';
import { TrackingService } from '../services/trackingService';
import { config } from '../config';

const trackingService = new TrackingService(config.jwt.secret);

export async function trackingRoutes(fastify: FastifyInstance) {
  // Get application status by token (public endpoint)
  fastify.get<{
    Params: {
      token: string;
    };
  }>(
    '/:token',
    {
      schema: {
        description: 'Get application status using tracking token (public)',
        tags: ['tracking'],
        params: {
          type: 'object',
          properties: {
            token: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params;

      try {
        const payload = trackingService.verifyTrackingToken(token);
        const info = await trackingService.getApplicationTrackingInfo(
          payload.microfinancieraId,
          payload.applicationId
        );

        return reply.send({
          success: true,
          data: info,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  // Generate tracking token (internal use)
  fastify.post<{
    Body: {
      applicationId: string;
      microfinancieraId: string;
      validityHours?: number;
    };
  }>(
    '/generate-token',
    {
      schema: {
        description: 'Generate tracking token (internal)',
        tags: ['tracking'],
        body: {
          type: 'object',
          required: ['applicationId', 'microfinancieraId'],
          properties: {
            applicationId: { type: 'string' },
            microfinancieraId: { type: 'string' },
            validityHours: { type: 'number', default: 24 },
          },
        },
      },
    },
    async (request, reply) => {
      const { applicationId, microfinancieraId, validityHours } = request.body;

      try {
        const token = trackingService.generateTrackingToken(
          applicationId,
          microfinancieraId,
          validityHours || 24
        );

        return reply.send({
          success: true,
          token,
          expiresIn: `${validityHours || 24} hours`,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
