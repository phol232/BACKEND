import { Timestamp } from 'firebase-admin/firestore';

export type AccountStatus = 'pending' | 'active' | 'blocked' | 'closed' | 'rejected';

export interface Account {
  id: string;
  microfinancieraId: string;
  userId: string; // Firebase Auth UID
  customerId?: string; // ID del cliente asociado
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  docType?: string;
  docNumber?: string;
  // Campos del titular (holder)
  holderFirstName?: string;
  holderLastName?: string;
  holderEmail?: string;
  holderPhone?: string;
  holderDni?: string;
  holderAddress?: string;
  holderDistrict?: string;
  holderProvince?: string;
  holderDepartment?: string;
  // Información de la cuenta
  status: AccountStatus;
  accountType?: 'personal' | 'business' | 'savings' | 'checking' | 'microCredit' | 'fixedDeposit';
  accountNumber?: string;
  cci?: string;
  balance?: number;
  currency?: string;
  interestRate?: number;
  initialDeposit?: number;
  zone?: string;
  // Información laboral
  employmentType?: string;
  employerName?: string;
  position?: string;
  monthlyIncome?: number;
  // Información bancaria
  hasBankAccount?: boolean;
  bankName?: string;
  hasCreditHistory?: boolean;
  additionalComments?: string;
  // Timestamps
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  lastUpdated?: Timestamp;
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectionReason?: string;
  blockedAt?: Timestamp;
  blockedReason?: string;
  closedAt?: Timestamp;
  closedReason?: string;
  approvedBy?: string; // User ID que aprobó
  rejectedBy?: string; // User ID que rechazó
  blockedBy?: string; // User ID que bloqueó
  closedBy?: string; // User ID que cerró
}

export interface AccountTransition {
  from: AccountStatus;
  to: AccountStatus;
  timestamp: Timestamp;
  userId: string;
  reason?: string;
  ipAddress?: string;
}

export interface AccountKPI {
  totalAccounts: number;
  activeAccounts: number;
  blockedAccounts: number;
  closedAccounts: number;
  pendingAccounts: number;
  totalApplications: number;
  totalCredits: number;
  totalPayments: number;
  incidents: number;
}

