import { Timestamp } from 'firebase-admin/firestore';

export type CardStatus = 'pending' | 'active' | 'suspended' | 'closed' | 'rejected';

export type CardType = 'debit' | 'credit' | 'prepaid';

export interface Card {
  id: string;
  microfinancieraId: string;
  accountId: string; // ID de la cuenta asociada
  customerId: string;
  cardNumber?: string; // Últimos 4 dígitos
  maskedCardNumber?: string; // Número enmascarado
  cardType: CardType;
  cardBrand?: 'visa' | 'mastercard' | 'amex' | string; // Marca de la tarjeta
  status: CardStatus;
  // Información del titular
  name?: string;
  holderFirstName?: string;
  holderLastName?: string;
  holderDni?: string;
  documentNumber?: string;
  dni?: string;
  email?: string;
  phone?: string;
  // Documentos
  documentUrl?: string; // URL del documento de identidad
  selfieUrl?: string; // URL del selfie
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectionReason?: string;
  suspendedAt?: Timestamp;
  suspendedReason?: string;
  closedAt?: Timestamp;
  closedReason?: string;
  approvedBy?: string;
  rejectedBy?: string;
  suspendedBy?: string;
  closedBy?: string;
}

export interface CardTransition {
  from: CardStatus;
  to: CardStatus;
  timestamp: Timestamp;
  userId: string;
  reason?: string;
  evidence?: string; // URL o referencia a evidencia
  ipAddress?: string;
}

export interface CardMetrics {
  totalCards: number;
  activeCards: number;
  suspendedCards: number;
  closedCards: number;
  pendingCards: number;
  usageAttempts: number; // Intentos de uso
  successfulTransactions: number;
  failedTransactions: number;
}

