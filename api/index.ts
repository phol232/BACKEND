import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../src/config';
import { initializeFirebase } from '../src/config/firebase';
import { applicationRoutes } from '../src/routes/applications';
import { scoringRoutes } from '../src/routes/scoring';
import { decisionRoutes } from '../src/routes/decisions';
import { disbursementRoutes } from '../src/routes/disbursements';
import { reportRoutes } from '../src/routes/reports';
import { trackingRoutes } from '../src/routes/tracking';
import { webhookRoutes } from '../src/routes/webhooks';

// Initialize Firebase once
initializeFirebase();

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
  },
});

// Setup
async function setup() {
  // CORS
  await fastify.register(cors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    credentials: true,
  });

  // Swagger Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Microfinance API',
        description: 'API para sistema de microfinanzas',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'https://tu-proyecto.vercel.app',
          description: 'Production server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes
  await fastify.register(applicationRoutes, { prefix: '/api/applications' });
  await fastify.register(scoringRoutes, { prefix: '/api/scoring' });
  await fastify.register(decisionRoutes, { prefix: '/api/decisions' });
  await fastify.register(disbursementRoutes, { prefix: '/api/disbursements' });
  await fastify.register(reportRoutes, { prefix: '/api/reports' });
  await fastify.register(trackingRoutes, { prefix: '/api/tracking' });
  await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });

  await fastify.ready();
}

setup();

// Export handler for Vercel
export default async (req: any, res: any) => {
  await fastify.ready();
  fastify.server.emit('request', req, res);
};
