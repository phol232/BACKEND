import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from './auth';

export function requireRole(roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as AuthenticatedRequest).user;

    if (!user) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!roles.includes(user.role || '')) {
      return reply.code(403).send({
        error: 'Insufficient permissions',
        message: `Required roles: ${roles.join(', ')}`,
      });
    }
  };
}

export function requireAdmin() {
  return requireRole(['admin']);
}

export function requireWorker() {
  return requireRole(['admin', 'worker', 'agent']);
}

export function requireAnalyst() {
  return requireRole(['admin', 'analyst']);
}

