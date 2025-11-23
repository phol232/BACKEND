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
      apiVersion: '2025-02-24.acacia',
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
   * Obtener o crear cuenta especial de Stripe para un usuario
   */
  private async getOrCreateStripeAccount(
    microfinancieraId: string,
    userId: string
  ): Promise<string> {
    try {
      // Buscar si ya existe una cuenta de tipo Stripe para este usuario
      const accountsSnapshot = await db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('accounts')
        .where('userId', '==', userId)
        .where('accountType', '==', 'stripe')
        .limit(1)
        .get();

      if (!accountsSnapshot.empty) {
        const accountId = accountsSnapshot.docs[0].id;
        console.log('✅ Cuenta Stripe existente encontrada:', accountId);
        return accountId;
      }

      // Si no existe, crear una nueva cuenta de tipo Stripe
      const accountData = {
        userId,
        accountType: 'stripe',
        accountNumber: `STRIPE-${Date.now()}`,
        balance: 0,
        currency: 'PEN',
        status: 'active',
        description: 'Cuenta para pagos con Stripe',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      const accountRef = await db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('accounts')
        .add(accountData);

      console.log('✅ Nueva cuenta Stripe creada:', accountRef.id);
      return accountRef.id;
    } catch (error: any) {
      console.error('❌ Error al obtener/crear cuenta Stripe:', error);
      throw error;
    }
  }

  /**
   * Procesar pago completado de Stripe
   */
  async processCompletedPayment(params: ProcessStripePaymentParams) {
    try {
      console.log('💳 Procesando pago de Stripe:', params.sessionId);

      // Verificar si ya se procesó esta sesión (idempotencia)
      const existingTransaction = await db()
        .collection('microfinancieras')
        .doc(params.microfinancieraId)
        .collection('transactions')
        .where('stripeSessionId', '==', params.sessionId)
        .limit(1)
        .get();

      if (!existingTransaction.empty) {
        console.log('⚠️ Pago ya procesado anteriormente para sessionId:', params.sessionId);
        const transactions = existingTransaction.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Calcular el total desde las transacciones existentes
        const totalAmount = transactions.reduce((sum: number, tx: any) => {
          return sum + (tx.amount || 0);
        }, 0);
        
        return {
          success: true,
          alreadyProcessed: true,
          transactions,
          totalAmount,
        };
      }

      // Verificar la sesión
      const session = await this.verifyPaymentSession(params.sessionId);

      if (session.payment_status !== 'paid') {
        throw new Error('El pago no está completado');
      }

      const totalAmount = session.amount_total ? session.amount_total / 100 : 0;

      // Obtener el userId del primer installment para crear/obtener la cuenta Stripe
      const firstInstallment = params.installments[0];
      if (!firstInstallment) {
        throw new Error('No hay cuotas para procesar');
      }

      // Obtener el userId del préstamo
      const loanDoc = await db()
        .collection('microfinancieras')
        .doc(params.microfinancieraId)
        .collection('loanApplications')
        .doc(firstInstallment.loanId)
        .get();

      if (!loanDoc.exists) {
        throw new Error('Préstamo no encontrado');
      }

      const userId = loanDoc.data()?.userId;
      if (!userId) {
        throw new Error('Usuario no encontrado en el préstamo');
      }

      // Obtener o crear cuenta especial de Stripe
      const stripeAccountId = await this.getOrCreateStripeAccount(
        params.microfinancieraId,
        userId
      );

      console.log('💳 Usando cuenta Stripe:', stripeAccountId);

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

        // Registrar transacción usando la cuenta especial de Stripe
        const transaction = await this.recordTransaction({
          microfinancieraId: params.microfinancieraId,
          accountId: stripeAccountId, // Usar la cuenta especial de Stripe
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
        refType: 'account', // Para que la app pueda filtrar por cuenta
        refId: params.accountId, // ID de la cuenta Stripe
        loanId: params.loanId,
        installmentId: params.installmentId,
        amount: params.amount,
        debit: params.amount, // Débito (salida de dinero)
        credit: 0, // Sin crédito
        currency: 'PEN',
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
