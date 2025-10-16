import { FastifyInstance } from 'fastify';
import { ValidationService } from '../services/validationService';
import { RoutingService } from '../services/routingService';
import { EmailService } from '../services/emailService';
import { TrackingService } from '../services/trackingService';
import { config } from '../config';
import { db } from '../config/firebase';

const validationService = new ValidationService();
const routingService = new RoutingService();
const emailService = new EmailService(config.brevo.apiKey);
const trackingService = new TrackingService(config.jwt.secret);

export async function webhookRoutes(fastify: FastifyInstance) {
  // Webhook for Firestore changes
  fastify.post<{
    Body: {
      event: 'created' | 'updated' | 'deleted';
      data?: any;
      before?: any;
      after?: any;
      params: {
        mfId: string;
        appId: string;
      };
    };
  }>(
    '/firestore',
    {
      schema: {
        description: 'Receive Firestore change events',
        tags: ['webhooks'],
        body: {
          type: 'object',
          required: ['event', 'params'],
          properties: {
            event: { type: 'string', enum: ['created', 'updated', 'deleted'] },
            data: { type: 'object' },
            before: { type: 'object' },
            after: { type: 'object' },
            params: {
              type: 'object',
              properties: {
                mfId: { type: 'string' },
                appId: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { event, data, before, after, params } = request.body;
      const { mfId, appId } = params;

      try {
        // Handle application created
        if (event === 'created' && data) {
          fastify.log.info(`New application created: ${appId}`);

          // Validate
          const validation = validationService.validate(data);

          // Update with validation results
          await db()
            .collection('microfinancieras')
            .doc(mfId)
            .collection('loanApplications')
            .doc(appId)
            .update({
              validations: validation,
              status: validation.isValid ? 'received' : 'pending',
              updatedAt: new Date(),
            });

          // Send confirmation email if valid
          if (validation.isValid) {
            await emailService.sendApplicationStatusEmail(
              appId,
              data.contactInfo.email,
              data.personalInfo.firstName,
              'received'
            );
          }
        }

        // Handle status change
        if (event === 'updated' && before && after) {
          const oldStatus = before.status;
          const newStatus = after.status;

          if (oldStatus !== newStatus) {
            fastify.log.info(`Status changed: ${oldStatus} → ${newStatus} (${appId})`);

            // Auto-route when status = received
            if (newStatus === 'received' && !after.routing) {
              const routing = await routingService.routeApplication(
                mfId,
                after.contactInfo.district
              );

              await db()
                .collection('microfinancieras')
                .doc(mfId)
                .collection('loanApplications')
                .doc(appId)
                .update({
                  routing,
                  status: 'routed',
                  updatedAt: new Date(),
                });

              fastify.log.info(`Application routed: ${appId} → Branch: ${routing.branchId}`);
            }

            // Send email notification
            const trackingToken = trackingService.generateTrackingToken(appId, mfId);
            await emailService.sendApplicationStatusEmail(
              appId,
              after.contactInfo.email,
              after.personalInfo.firstName,
              newStatus,
              trackingToken
            );
          }
        }

        return reply.send({ success: true, processed: true });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Manual trigger for processing pending applications
  fastify.post('/process-pending', async (request, reply) => {
    try {
      // Find pending applications
      const snapshot = await db()
        .collectionGroup('loanApplications')
        .where('status', '==', 'pending')
        .where('validations.isValid', '==', true)
        .limit(10)
        .get();

      let processed = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const mfId = doc.ref.parent.parent?.id;

        if (!mfId) continue;

        // Update to received
        await doc.ref.update({
          status: 'received',
          updatedAt: new Date(),
        });

        processed++;
      }

      return reply.send({
        success: true,
        processed,
        message: `Processed ${processed} pending applications`,
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
