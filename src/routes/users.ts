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
      return reply.send(result);
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(400).send({ error: error.message });
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
      return reply.send(result);
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(400).send({ error: error.message });
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
      
      // Usar sendApprovalEmail que incluye los botones de aprobación/rechazo
      await userService.sendApprovalEmail(uid, email, displayName);
      
      return reply.send({ 
        success: true, 
        message: 'Approval email sent successfully' 
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}