import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/auth';
import { UserService } from '../services/userService';
import { EmailService } from '../services/emailService';

const userService = new UserService();
const emailService = new EmailService();

export async function userRoutes(fastify: FastifyInstance) {
  // Register new user (called after Firebase Auth)
  fastify.post('/register', {
    preHandler: authenticate,
    schema: {
      description: 'Register new user after authentication',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest<{ Body: { displayName?: string; provider: 'google' | 'email' } }>, reply) => {
    try {
      const user = (request as any).user; // Temporary cast, improve if possible
      const { uid, email } = user;
      const { displayName, provider } = request.body;

      const newUser = await userService.createPendingUser(uid, email || '', displayName, provider);
      return reply.send({ success: true, user: newUser });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Get user status
  fastify.get('/status', {
    preHandler: authenticate,
    schema: {
      description: 'Get current user status',
      tags: ['users'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply) => {
    try {
      const user = (request as any).user;
      const userData = await userService.getUser(user.uid);
      if (!userData) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return reply.send({ status: userData.status });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Approve user (public, token-based)
  fastify.get('/approve', {
    schema: {
      description: 'Approve user via token',
      tags: ['users'],
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
        required: ['token'],
      },
    },
  }, async (request, reply) => {
    const { token } = request.query as { token: string };
    try {
      const result = await userService.handleApprovalToken(token);
      
      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Resultado de Aprobación</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .success { color: #4CAF50; }
            .error { color: #f44336; }
            .icon { font-size: 48px; margin-bottom: 20px; }
            h1 { margin-bottom: 20px; }
            p { font-size: 16px; line-height: 1.6; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            ${result.success ? 
              `<div class="success">
                <div class="icon">✅</div>
                <h1>Usuario Aprobado</h1>
                <p>${result.message}</p>
                <p>El usuario ahora puede acceder a la aplicación.</p>
              </div>` :
              `<div class="error">
                <div class="icon">❌</div>
                <h1>Error</h1>
                <p>${result.message}</p>
                <p>Por favor, verifica que el enlace sea válido y no haya expirado.</p>
              </div>`
            }
          </div>
        </body>
        </html>
      `;
      
      return reply.type('text/html').send(htmlResponse);
    } catch (error: any) {
      fastify.log.error(error);
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .error { color: #f44336; }
            .icon { font-size: 48px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error">
              <div class="icon">❌</div>
              <h1>Error</h1>
              <p>Ocurrió un error al procesar la solicitud.</p>
            </div>
          </div>
        </body>
        </html>
      `;
      return reply.code(400).type('text/html').send(errorHtml);
    }
  });

  // Reject user (public, token-based)
  fastify.get('/reject', {
    schema: {
      description: 'Reject user via token',
      tags: ['users'],
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
        required: ['token'],
      },
    },
  }, async (request, reply) => {
    const { token } = request.query as { token: string };
    try {
      const result = await userService.handleApprovalToken(token);
      
      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Resultado de Rechazo</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .success { color: #4CAF50; }
            .error { color: #f44336; }
            .icon { font-size: 48px; margin-bottom: 20px; }
            h1 { margin-bottom: 20px; }
            p { font-size: 16px; line-height: 1.6; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            ${result.success ? 
              `<div class="success">
                <div class="icon">🚫</div>
                <h1>Usuario Rechazado</h1>
                <p>${result.message}</p>
                <p>El usuario ha sido notificado de la decisión.</p>
              </div>` :
              `<div class="error">
                <div class="icon">❌</div>
                <h1>Error</h1>
                <p>${result.message}</p>
                <p>Por favor, verifica que el enlace sea válido y no haya expirado.</p>
              </div>`
            }
          </div>
        </body>
        </html>
      `;
      
      return reply.type('text/html').send(htmlResponse);
    } catch (error: any) {
      fastify.log.error(error);
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .error { color: #f44336; }
            .icon { font-size: 48px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error">
              <div class="icon">❌</div>
              <h1>Error</h1>
              <p>Ocurrió un error al procesar la solicitud.</p>
            </div>
          </div>
        </body>
        </html>
      `;
      return reply.code(400).type('text/html').send(errorHtml);
    }
  });

  // Notify new user registration
  fastify.post('/notify-registration', {
    schema: {
      description: 'Send notification email for new user registration',
      tags: ['users'],
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          displayName: { type: 'string' },
          provider: { type: 'string', enum: ['google', 'email'] },
          uid: { type: 'string' }
        },
        required: ['email', 'provider', 'uid']
      }
    },
  }, async (request: FastifyRequest<{ 
    Body: { 
      email: string; 
      displayName?: string; 
      provider: 'google' | 'email';
      uid: string;
    } 
  }>, reply) => {
    try {
      const { email, displayName, provider, uid } = request.body;
      
      console.log('📧 Notificación de registro recibida:', { uid, email, displayName, provider });
      
      // Verificar si el usuario ya existe
      const existingUser = await userService.getUser(uid);
      if (existingUser) {
        console.log('✅ Usuario ya existe, enviando email de notificación');
        await userService.sendApprovalEmail(uid, email, displayName);
        return reply.send({ 
          success: true, 
          message: 'Approval email sent successfully',
          user: existingUser
        });
      }
      
      // Si no existe, crear el usuario (para casos edge)
      console.log('⚠️ Usuario no encontrado, creando en colección global como fallback');
      const newUser = await userService.createPendingUser(uid, email, displayName, provider);
      console.log('✅ Usuario creado en base de datos:', { uid, status: newUser.status });
      
      return reply.send({ 
        success: true, 
        message: 'User created and approval email sent successfully',
        user: newUser
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}