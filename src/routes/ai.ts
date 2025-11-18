import { FastifyInstance } from 'fastify';
import { AIService, ChatHistoryItem } from '../services/aiService';

interface ChatRequestBody {
  userId: string;
  microfinancieraId: string;
  userName?: string;
  message: string;
  history?: ChatHistoryItem[];
}

export async function aiRoutes(fastify: FastifyInstance) {
  const aiService = new AIService();

  fastify.post('/api/ai/chat', async (request, reply) => {
    const body = request.body as ChatRequestBody;

    if (!body?.userId || !body?.microfinancieraId || !body?.message) {
      return reply.status(400).send({
        success: false,
        message: 'userId, microfinancieraId y message son obligatorios',
      });
    }

    try {
      const result = await aiService.processChat({
        userId: body.userId,
        microfinancieraId: body.microfinancieraId,
        userName: body.userName,
        message: body.message,
        history: body.history,
      });

      return {
        success: true,
        answer: result.answer,
        contextSummary: result.contextSummary,
      };
    } catch (error) {
      request.log.error({ err: error }, 'AI chat failed');
      return reply.status(500).send({
        success: false,
        message: 'No se pudo procesar la consulta del asistente.',
      });
    }
  });
}
