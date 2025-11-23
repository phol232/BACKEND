import axios from 'axios';
import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';

interface CreateChargeParams {
  tokenId: string;
  amount: number;
  currency_code: string;
  description: string;
  email: string;
  metadata?: Record<string, any>;
}

interface RecordTransactionParams {
  microfinancieraId: string;
  userId: string;
  chargeId: string;
  amount: number;
  currency: string;
  status: 'completed' | 'failed' | 'pending';
  description: string;
  loanId?: string;
  accountId?: string;
  stripeResponse: any;
}

interface GetTransactionHistoryParams {
  microfinancieraId: string;
  userId: string;
  loanId?: string;
  accountId?: string;
  limit?: number;
}

export class PaymentService {
  private stripeSecretKey: string;
  private stripeApiUrl = 'https://api.stripe.com/v1';

  constructor() {
    this.stripeSecretKey = process.env.API_STRIPE_PRIV || process.env.STRIPE_SECRET_KEY || '';
    
    if (!this.stripeSecretKey) {
      console.error('⚠️ API_STRIPE_PRIV no está configurada en las variables de entorno');
    }
  }

  /**
   * Crear un cargo en Stripe
   */
  async createCharge(params: CreateChargeParams) {
    try {
      console.log('💳 Creando cargo en Stripe:', {
        amount: params.amount,
        currency: params.currency_code,
        email: params.email,
      });

      const response = await axios.post(
        `${this.stripeApiUrl}/charges`,
        {
          amount: params.amount,
          currency: params.currency_code,
          description: params.description,
          receipt_email: params.email,
          source: params.tokenId,
          metadata: params.metadata || {},
        },
        {
          headers: {
            'Authorization': `Bearer ${this.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log('✅ Cargo creado exitosamente:', response.data.id);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error al crear cargo en Stripe:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Error al procesar el pago');
    }
  }

  /**
   * Obtener información de un cargo
   */
  async getCharge(chargeId: string) {
    try {
      const response = await axios.get(
        `${this.stripeApiUrl}/charges/${chargeId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.stripeSecretKey}`,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('❌ Error al obtener cargo:', error.response?.data || error.message);
      throw new Error('Error al verificar el estado del pago');
    }
  }

  /**
   * Registrar transacción en Firestore
   */
  async recordTransaction(params: RecordTransactionParams) {
    try {
      const transactionData = {
        mfId: params.microfinancieraId,
        type: 'PAYMENT',
        refType: params.loanId ? 'loan' : 'account',
        refId: params.loanId || params.accountId || '',
        debit: params.amount,
        credit: 0,
        currency: params.currency,
        branchId: 'default_branch',
        createdAt: Timestamp.now(),
        metadata: {
          userId: params.userId,
          chargeId: params.chargeId,
          status: params.status,
          description: params.description,
          loanId: params.loanId || null,
          accountId: params.accountId || null,
          paymentMethod: 'stripe',
          stripeResponse: params.stripeResponse,
        },
      };

      const transactionRef = await db()
        .collection('microfinancieras')
        .doc(params.microfinancieraId)
        .collection('transactions')
        .add(transactionData);

      console.log('✅ Transacción registrada:', transactionRef.id);

      // Si hay un préstamo asociado, actualizar el saldo
      if (params.loanId && params.status === 'completed') {
        await this.updateLoanBalance(params.microfinancieraId, params.loanId, params.amount);
      }

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
   * Actualizar saldo del préstamo después de un pago
   */
  private async updateLoanBalance(microfinancieraId: string, loanId: string, paymentAmount: number) {
    try {
      const loanRef = db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('loans')
        .doc(loanId);

      const loanDoc = await loanRef.get();
      
      if (!loanDoc.exists) {
        console.warn('⚠️ Préstamo no encontrado:', loanId);
        return;
      }

      const loanData = loanDoc.data();
      const currentBalance = loanData?.remainingBalance || loanData?.amount || 0;
      const newBalance = Math.max(0, currentBalance - paymentAmount);

      await loanRef.update({
        remainingBalance: newBalance,
        lastPaymentDate: Timestamp.now(),
        lastPaymentAmount: paymentAmount,
        updatedAt: Timestamp.now(),
        status: newBalance === 0 ? 'paid' : loanData?.status || 'active',
      });

      console.log('✅ Saldo del préstamo actualizado:', {
        loanId,
        previousBalance: currentBalance,
        newBalance,
        paymentAmount,
      });
    } catch (error: any) {
      console.error('❌ Error al actualizar saldo del préstamo:', error);
      // No lanzar error para no fallar la transacción principal
    }
  }

  /**
   * Obtener historial de transacciones
   */
  async getTransactionHistory(params: GetTransactionHistoryParams) {
    try {
      let query = db()
        .collection('microfinancieras')
        .doc(params.microfinancieraId)
        .collection('transactions')
        .where('userId', '==', params.userId);

      if (params.loanId) {
        query = query.where('loanId', '==', params.loanId) as any;
      }

      if (params.accountId) {
        query = query.where('accountId', '==', params.accountId) as any;
      }

      const snapshot = await query
        .orderBy('createdAt', 'desc')
        .limit(params.limit || 50)
        .get();

      const transactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return transactions;
    } catch (error: any) {
      console.error('❌ Error al obtener historial:', error);
      throw error;
    }
  }
}
