import { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../config/firebase';
import { UserService } from '../services/userService';

const userService = new UserService();

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    uid: string;
    email?: string;
    role?: 'admin' | 'analyst' | 'employee';
  };
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      request.log.warn('Authentication failed: No token provided or invalid format');
      return reply.code(401).send({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    request.log.debug(`Token received, length: ${token.length}`);
    
    const decodedToken = await auth().verifyIdToken(token);
    request.log.debug(`Token verified for user: ${decodedToken.uid}`);
    
    // Obtener el rol del usuario desde la base de datos
    const userData = await userService.getUser(decodedToken.uid);
    
    // Attach user to request
    (request as AuthenticatedRequest).user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: userData?.role || 'employee', // Default to employee if no role found
    };
    
    request.log.debug(`User role: ${(request as AuthenticatedRequest).user.role}`);
  } catch (error: any) {
    request.log.error(`Token verification failed: ${error.message}`);
    return reply.code(401).send({ 
      error: 'Invalid token',
      message: error.message 
    });
  }
}

export function requireRole(roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as AuthenticatedRequest).user;
    
    if (!user) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!roles.includes(user.role || '')) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }
  };
}
