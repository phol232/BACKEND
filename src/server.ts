import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config';
import { initializeFirebase } from './config/firebase';

// Initialize Firebase BEFORE importing routes
initializeFirebase();

// Now import routes (they will use initialized Firebase)
import { applicationRoutes } from './routes/applications';
import { scoringRoutes } from './routes/scoring';
import { decisionRoutes } from './routes/decisions';
import { disbursementRoutes } from './routes/disbursements';
import { reportRoutes } from './routes/reports';
import { trackingRoutes } from './routes/tracking';
import { webhookRoutes } from './routes/webhooks';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
  },
});

async function start() {
  try {

    // CORS
    await fastify.register(cors, {
      origin: true, // Allow all origins in development
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
            url: `http://localhost:${config.port}`,
            description: 'Development server',
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

    // Auth test endpoint
    fastify.get('/api/auth/test', {
      preHandler: async (request, reply) => {
        const authHeader = request.headers.authorization;
        request.log.info({
          msg: 'Auth test - Headers',
          authorization: authHeader ? `Bearer ${authHeader.substring(7, 20)}...` : 'none',
          contentType: request.headers['content-type'],
        });
        
        // Import authenticate middleware
        const { authenticate } = await import('./middleware/auth');
        return authenticate(request, reply);
      }
    }, async (request) => {
      const { user } = request as any;
      return { 
        success: true, 
        message: 'Authentication successful',
        user: {
          uid: user.uid,
          email: user.email,
          role: user.role,
        }
      };
    });

    // Root route - API info
    fastify.get('/', async (request, reply) => {
      return {
        name: 'CreditoExpress API',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          docs: '/docs',
          health: '/health',
          api: {
            applications: '/api/applications',
            scoring: '/api/scoring',
            decisions: '/api/decisions',
            disbursements: '/api/disbursements',
            reports: '/api/reports',
            tracking: '/api/tracking',
            webhooks: '/api/webhooks'
          }
        }
      };
    });

    // Health check
    fastify.get('/health', async (request, reply) => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
    });

    // Register routes
    await fastify.register(applicationRoutes, { prefix: '/api/applications' });
    await fastify.register(scoringRoutes, { prefix: '/api/scoring' });
    await fastify.register(decisionRoutes, { prefix: '/api/decisions' });
    await fastify.register(disbursementRoutes, { prefix: '/api/disbursements' });
    await fastify.register(reportRoutes, { prefix: '/api/reports' });
    await fastify.register(trackingRoutes, { prefix: '/api/tracking' });
    await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });

    // Start server
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    
    console.log(`🚀 Server running at http://localhost:${config.port}`);
    console.log(`📚 Swagger docs at http://localhost:${config.port}/docs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
