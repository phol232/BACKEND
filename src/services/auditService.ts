import { getFirestore, Timestamp } from "firebase-admin/firestore";

export interface AuditLog {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: any;
  after: any;
  timestamp: Timestamp;
  correlationId: string;
  metadata?: Record<string, any>;
}

export class AuditService {
  private get db() {
    return getFirestore();
  }

  async log(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: any,
    after: any,
    correlationId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const auditLog: AuditLog = {
      userId,
      action,
      entityType,
      entityId,
      before,
      after,
      timestamp: Timestamp.now(),
      correlationId,
      metadata,
    };

    await this.db.collection("auditLogs").add(auditLog);
  }

  async getLogsByEntity(entityType: string, entityId: string, limit = 50): Promise<AuditLog[]> {
    const snapshot = await this.db
      .collection("auditLogs")
      .where("entityType", "==", entityType)
      .where("entityId", "==", entityId)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as AuditLog);
  }

  async getLogsByUser(userId: string, limit = 50): Promise<AuditLog[]> {
    const snapshot = await this.db
      .collection("auditLogs")
      .where("userId", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as AuditLog);
  }

  async getLogsByDateRange(
    startDate: Date,
    endDate: Date,
    limit = 100
  ): Promise<AuditLog[]> {
    const snapshot = await this.db
      .collection("auditLogs")
      .where("timestamp", ">=", Timestamp.fromDate(startDate))
      .where("timestamp", "<=", Timestamp.fromDate(endDate))
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as AuditLog);
  }
}

