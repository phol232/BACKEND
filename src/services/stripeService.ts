import Stripe from 'stripe';
import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';

interface ProcessStripePaymentParams {
  sessionId: string;
  microfinancieraId: string;
  accountId: string;
  installments: Array<{
    loanId: string;
    installmentId: string;
    amount: number;
  }>;
}

export class StripeService {
  private stripe: Stripe;

  constructor() {
    const stripeSecretKey = process.env.API_STRIPE_PRIV || '';
    
    if (!stripeSecretKey) {
      throw new Error('API_STRIPE_PRIV no está configurada');
    }

    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-11-20.acacia',
    });
  }

  /**
   * Verificar sesión de pago de Stripe
   */
  async verifyPaymentSession(sessionId: string) {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      return session;
    } catch (error: any) {
      console.error('❌ Error al verificar sesión de Stripe:', error);
      throw new Error('Error al verificar el pago');
    }
  }

  /**
   * Procesar pago completado de Stripe
   */
  async processCompletedPayment(params: ProcessStripePaymentParams) {
    try {
      console.log('💳 Procesando pago de Stripe:', params.sessionId);

      // Verificar la sesión
      const session = await this.verifyPaymentSession(params.sessionId);

      if (session.payment_status !== 'paid') {
        throw new Error('El pago no está completado');
      }

      const totalAmount = session.amount_total ? session.amount_total / 100 : 0;

      // Procesar cada cuota
      const transactions = [];
      for (const installment of params.installments) {
        // Marcar cuota como pagada
        await this.markInstallmentAsPaid(
          params.microfinancieraId,
          installment.loanId,
          installment.installmentId,
          installment.amount
        );

        // Registrar transacción
        const transaction = await this.recordTransaction({
          microfinancieraId: params.microfinancieraId,
          accountId: params.accountId,
          loanId: installment.loanId,
          installmentId: installment.installmentId,
          amount: installment.amount,
          stripeSessionId: params.sessionId,
          stripePaymentIntent: session.payment_intent as string,
          status: 'completed',
        });

        transactions.push(transaction);
      }

      console.log('✅ Pago procesado exitosamente:', transactions.length, 'cuotas');

      return {
        success: true,
        transactions,
        totalAmount,
      };
    } catch (error: any) {
      console.error('❌ Error al procesar pago:', error);
      throw error;
    }
  }

  /**
   * Marcar cuota como pagada
   */
  private async markInstallmentAsPaid(
    microfinancieraId: string,
    loanId: string,
    installmentId: string,
    amount: number
  ) {
    try {
      const installmentRef = db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('loanApplications')
        .doc(loanId)
        .collection('repaymentSchedule')
        .doc(installmentId);

      await installmentRef.update({
        status: 'paid',
        paidAmount: amount,
        paidAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      console.log('✅ Cuota marcada como pagada:', installmentId);
    } catch (error: any) {
      console.error('❌ Error al marcar cuota como pagada:', error);
      throw error;
    }
  }

  /**
   * Registrar transacción en Firestore
   */
  private async recordTransaction(params: {
    microfinancieraId: string;
    accountId: string;
    loanId: string;
    installmentId: string;
    amount: number;
    stripeSessionId: string;
    stripePaymentIntent: string;
    status: string;
  }) {
    try {
      const transactionData = {
        type: 'payment',
        accountId: params.accountId,
        loanId: params.loanId,
        installmentId: params.installmentId,
        amount: params.amount,
        paymentMethod: 'stripe',
        stripeSessionId: params.stripeSessionId,
        stripePaymentIntent: params.stripePaymentIntent,
        status: params.status,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      const transactionRef = await db()
        .collection('microfinancieras')
        .doc(params.microfinancieraId)
        .collection('transactions')
        .add(transactionData);

      console.log('✅ Transacción registrada:', transactionRef.id);

      return {
        id: transactionRef.id,
        ...transactionData,
      };
    } catch (error: any) {
      console.error('❌ Error al registrar transacción:', error);
      throw error;
    }
  }

  /**
   * Verificar firma del webhook de Stripe
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET no está configurado');
    }

    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error: any) {
      console.error('❌ Error al verificar firma del webhook:', error);
      throw new Error('Firma del webhook inválida');
    }
  }
}
