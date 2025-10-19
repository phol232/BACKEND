import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config';
import { initializeFirebase } from './config/firebase';
import { userRoutes } from './routes/users';

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
      reply.type('text/html');
      return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CreditoExpress API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #667eea;
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    .version {
      color: #888;
      font-size: 0.9em;
      margin-bottom: 30px;
    }
    .status {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.9em;
      margin-bottom: 30px;
    }
    .links {
      display: grid;
      gap: 15px;
      margin-top: 30px;
    }
    .link {
      display: block;
      padding: 15px 20px;
      background: #f3f4f6;
      border-radius: 10px;
      text-decoration: none;
      color: #374151;
      transition: all 0.3s;
      border-left: 4px solid #667eea;
    }
    .link:hover {
      background: #e5e7eb;
      transform: translateX(5px);
    }
    .link-title {
      font-weight: 600;
      display: block;
      margin-bottom: 5px;
    }
    .link-desc {
      font-size: 0.85em;
      color: #6b7280;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      color: #888;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 CreditoExpress API</h1>
    <div class="version">v1.0.0</div>
    <span class="status">✓ Running</span>
    
    <div class="links">
      <a href="/docs" class="link">
        <span class="link-title">📚 API Documentation</span>
        <span class="link-desc">Swagger UI - Explora todos los endpoints</span>
      </a>
      
      <a href="/health" class="link">
        <span class="link-title">💚 Health Check</span>
        <span class="link-desc">Estado del servidor y métricas</span>
      </a>
      
      <a href="/api/applications" class="link">
        <span class="link-title">📝 Applications</span>
        <span class="link-desc">Gestión de solicitudes de crédito</span>
      </a>
      
      <a href="/api/reports" class="link">
        <span class="link-title">📊 Reports</span>
        <span class="link-desc">Reportes y estadísticas</span>
      </a>
    </div>
    
    <div class="footer">
      ${new Date().toISOString()}
    </div>
  </div>
</body>
</html>
      `;
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
    await fastify.register(userRoutes, { prefix: '/api/users' });

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
