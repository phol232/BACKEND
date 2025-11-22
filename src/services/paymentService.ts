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
  culqiResponse: any;
}

interface GetTransactionHistoryParams {
  microfinancieraId: string;
  userId: string;
  loanId?: string;
  accountId?: string;
  limit?: number;
}

export class PaymentService {
  private culqiSecretKey: string;
  private culqiApiUrl = 'https://api.culqi.com/v2';

  constructor() {
    this.culqiSecretKey = process.env.API_CULQUI_PRIV || '';
    
    if (!this.culqiSecretKey) {
      console.error('⚠️ API_CULQUI_PRIV no está configurada en las variables de entorno');
    }
  }

  /**
   * Crear un cargo en Culqi
   */
  async createCharge(params: CreateChargeParams) {
    try {
      console.log('💳 Creando cargo en Culqi:', {
        amount: params.amount,
        currency: params.currency_code,
        email: params.email,
      });

      const response = await axios.post(
        `${this.culqiApiUrl}/charges`,
        {
          amount: params.amount,
          currency_code: params.currency_code,
          description: params.description,
          email: params.email,
          source_id: params.tokenId,
          metadata: params.metadata || {},
        },
        {
          headers: {
            'Authorization': `Bearer ${this.culqiSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('✅ Cargo creado exitosamente:', response.data.id);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error al crear cargo en Culqi:', error.response?.data || error.message);
      throw new Error(error.response?.data?.user_message || 'Error al procesar el pago');
    }
  }

  /**
   * Obtener información de un cargo
   */
  async getCharge(chargeId: string) {
    try {
      const response = await axios.get(
        `${this.culqiApiUrl}/charges/${chargeId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.culqiSecretKey}`,
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
        userId: params.userId,
        chargeId: params.chargeId,
        amount: params.amount,
        currency: params.currency,
        status: params.status,
        description: params.description,
        loanId: params.loanId || null,
        accountId: params.accountId || null,
        culqiResponse: params.culqiResponse,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
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
