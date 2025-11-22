import { Timestamp } from 'firebase-admin/firestore';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  phoneNumber?: string;
  provider: 'google' | 'email';
  status: 'pending' | 'approved' | 'rejected';
  role: 'admin' | 'analyst' | 'employee';
  microfinancieraId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectionReason?: string;
}
