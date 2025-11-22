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
import { userRoutes } from '../src/routes/users';
import { accountRoutes } from '../src/routes/accounts';
import { cardRoutes } from '../src/routes/cards';
import { workerRoutes } from '../src/routes/workers';
import { microfinancieraRoutes } from '../src/routes/microfinancieras';
import { aiRoutes } from '../src/routes/ai';
import { productRoutes } from '../src/routes/products';
import { paymentRoutes } from '../src/routes/payments';

// Initialize Firebase once
initializeFirebase();

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
  },
});

// Setup
async function setup() {
  // Environment detection for Swagger UI
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
  const isProduction = config.nodeEnv === 'production';
  const shouldEnableSwagger = !isVercel && !isProduction && config.nodeEnv === 'development';

  // CORS
  await fastify.register(cors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    credentials: true,
  });

  // Swagger Documentation - Only in local development
  // Disable completely in Vercel or production environments
  if (shouldEnableSwagger) {
    try {
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
      
      console.log('✅ Swagger UI enabled for local development');
    } catch (error) {
      console.warn('⚠️ Failed to register Swagger UI:', error);
    }
  } else {
    console.log('ℹ️ Swagger UI disabled (production/Vercel environment)');
  }

  // Root route - API info
  fastify.get('/', async (request, reply) => {
    reply.type('text/html');
    const docsLink = shouldEnableSwagger ? `
    <a href="/docs" class="link">
      <span class="link-title">📚 API Documentation</span>
      <span class="link-desc">Swagger UI - Explora todos los endpoints</span>
    </a>` : '';
    
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
      text-align: center;
    }
    .logo { font-size: 3rem; margin-bottom: 20px; }
    h1 { color: #333; margin-bottom: 10px; font-size: 2.5rem; }
    .subtitle { color: #666; margin-bottom: 30px; font-size: 1.1rem; }
    .status { 
      background: #e8f5e8; 
      color: #2d5a2d; 
      padding: 15px; 
      border-radius: 10px; 
      margin-bottom: 30px;
      font-weight: 600;
    }
    .links { display: flex; flex-direction: column; gap: 15px; }
    .link {
      display: block;
      background: #f8f9fa;
      padding: 20px;
      border-radius: 10px;
      text-decoration: none;
      color: #333;
      transition: all 0.3s ease;
      border: 2px solid transparent;
    }
    .link:hover {
      background: #667eea;
      color: white;
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
    }
    .link-title { display: block; font-weight: 600; margin-bottom: 5px; }
    .link-desc { display: block; font-size: 0.9rem; opacity: 0.8; }
    .env-tag {
      position: absolute;
      top: 20px;
      right: 20px;
      background: ${config.nodeEnv === 'production' ? '#dc3545' : '#28a745'};
      color: white;
      padding: 5px 10px;
      border-radius: 15px;
      font-size: 0.8rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="env-tag">${config.nodeEnv.toUpperCase()}</div>
  <div class="container">
    <div class="logo">💰</div>
    <h1>CreditoExpress API</h1>
    <p class="subtitle">Sistema de Microfinanzas - API Backend</p>
    
    <div class="status">
      ✅ API funcionando correctamente
    </div>
    
    <div class="links">
      <a href="/health" class="link">
        <span class="link-title">🏥 Health Check</span>
        <span class="link-desc">Verificar estado del servidor</span>
      </a>
      ${docsLink}
      <a href="/api/users" class="link">
        <span class="link-title">👥 Users API</span>
        <span class="link-desc">Gestión de usuarios y autenticación</span>
      </a>
      <a href="/api/applications" class="link">
        <span class="link-title">📋 Applications API</span>
        <span class="link-desc">Solicitudes de crédito</span>
      </a>
    </div>
  </div>
</body>
</html>`;
  });

  // Favicon routes to prevent 404 errors
  fastify.get('/favicon.ico', async (request, reply) => {
    reply.code(204);
    return;
  });

  fastify.get('/favicon.png', async (request, reply) => {
    reply.code(204);
    return;
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
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(accountRoutes, { prefix: '/api/accounts' });
  await fastify.register(cardRoutes, { prefix: '/api/cards' });
  await fastify.register(workerRoutes, { prefix: '/api/workers' });
  await fastify.register(microfinancieraRoutes, { prefix: '/api/microfinancieras' });
  await fastify.register(productRoutes, { prefix: '/api/products' });
  await fastify.register(paymentRoutes, { prefix: '/api/payments' });
  await fastify.register(aiRoutes);

  await fastify.ready();
}

setup();

// Export handler for Vercel
export default async (req: any, res: any) => {
  await fastify.ready();
  fastify.server.emit('request', req, res);
};
