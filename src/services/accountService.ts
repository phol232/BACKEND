import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { Account, AccountStatus, AccountTransition, AccountKPI } from '../types/account';
import { AuditService } from './auditService';
import { EmailService } from './emailService';

export class AccountService {
  private auditService = new AuditService();
  private emailService = new EmailService();

  private validTransitions: Record<AccountStatus, AccountStatus[]> = {
    pending: ['active', 'rejected'],
    active: ['blocked', 'closed'],
    blocked: ['active', 'closed'],
    closed: [],
    rejected: [],
  };

  isValidTransition(from: AccountStatus, to: AccountStatus): boolean {
    return this.validTransitions[from]?.includes(to) || false;
  }

  async getAccounts(
    microfinancieraId: string,
    filters?: {
      status?: AccountStatus;
      zone?: string;
      accountType?: 'personal' | 'business';
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      page?: number;
      userId?: string;
    }
  ): Promise<Account[]> {
    let query = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts');

    if (filters?.status) {
      query = query.where('status', '==', filters.status) as any;
    }
    if (filters?.zone) {
      query = query.where('zone', '==', filters.zone) as any;
    }
    if (filters?.accountType) {
      query = query.where('accountType', '==', filters.accountType) as any;
    }
    if (filters?.userId) {
      query = query.where('userId', '==', filters.userId) as any;
    }
    if (filters?.startDate) {
      query = query.where('createdAt', '>=', Timestamp.fromDate(filters.startDate)) as any;
    }
    if (filters?.endDate) {
      query = query.where('createdAt', '<=', Timestamp.fromDate(filters.endDate)) as any;
    }

    // Aplicar límite (default 100, máximo 500)
    const limit = Math.min(filters?.limit || 100, 500);
    query = query.limit(limit) as any;

    // Aplicar paginación si se especifica
    if (filters?.page && filters.page > 1) {
      const offset = (filters.page - 1) * limit;
      query = query.offset(offset) as any;
    }

    const snapshot = await query.get();
    let accounts = snapshot.docs.map((doc) => {
      const data = doc.data();
      // Mapear isActive a status si no existe status
      if (!data.status && data.isActive !== undefined) {
        data.status = data.isActive ? 'active' : 'pending';
      }
      // Si no tiene status, asignar 'pending' por defecto
      if (!data.status) {
        data.status = 'pending';
      }
      return {
        id: doc.id,
        ...data,
      };
    }) as Account[];

    // Enriquecer con información del usuario desde la colección users o customers
    const enrichedAccounts = await Promise.all(
      accounts.map(async (account) => {
        try {
          // Intentar obtener información del usuario desde la colección users
          if (account.userId) {
            const userDoc = await db()
              .collection('microfinancieras')
              .doc(microfinancieraId)
              .collection('users')
              .doc(account.userId)
              .get();

            if (userDoc.exists) {
              const userData = userDoc.data();
              return {
                ...account,
                displayName: account.displayName || userData?.displayName || userData?.fullName || account.email,
                firstName: account.firstName || userData?.firstName,
                lastName: account.lastName || userData?.lastName,
                phone: account.phone || userData?.phone,
                docType: account.docType || userData?.docType,
                docNumber: account.docNumber || userData?.docNumber || userData?.dni,
              };
            }

            // Si no está en users, intentar obtener desde customers
            const customerQuery = await db()
              .collection('microfinancieras')
              .doc(microfinancieraId)
              .collection('customers')
              .where('userId', '==', account.userId)
              .limit(1)
              .get();

            if (!customerQuery.empty) {
              const customerData = customerQuery.docs[0].data();
              return {
                ...account,
                displayName: account.displayName || customerData?.fullName || customerData?.displayName || account.email,
                firstName: account.firstName || customerData?.firstName,
                lastName: account.lastName || customerData?.lastName,
                phone: account.phone || customerData?.phone,
                docType: account.docType || customerData?.docType,
                docNumber: account.docNumber || customerData?.docNumber || customerData?.dni,
              };
            }
          }
        } catch (error) {
          console.error(`Error enriqueciendo cuenta ${account.id}:`, error);
        }
        return account;
      })
    );

    // Ordenar en memoria por createdAt si existe
    enrichedAccounts.sort((a, b) => {
      const aDate = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
      const bDate = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
      return bDate - aDate; // Descendente
    });

    return enrichedAccounts;
  }

  async getAccount(microfinancieraId: string, accountId: string): Promise<Account | null> {
    const doc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(accountId)
      .get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as Account;
  }

  async getAccountHistory(
    microfinancieraId: string,
    accountId: string
  ): Promise<AccountTransition[]> {
    const snapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(accountId)
      .collection('transitions')
      .orderBy('timestamp', 'desc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as AccountTransition);
  }

  async approveAccount(
    microfinancieraId: string,
    accountId: string,
    userId: string,
    ipAddress?: string
  ): Promise<void> {
    const accountRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(accountId);

    const accountDoc = await accountRef.get();
    if (!accountDoc.exists) {
      throw new Error('Cuenta no encontrada');
    }

    const account = accountDoc.data() as Account;
    if (account.status !== 'pending') {
      throw new Error(`No se puede aprobar una cuenta con estado: ${account.status}`);
    }

    const transition: AccountTransition = {
      from: account.status,
      to: 'active',
      timestamp: Timestamp.now(),
      userId,
      ipAddress,
    };

    await accountRef.update({
      status: 'active',
      approvedAt: Timestamp.now(),
      approvedBy: userId,
      updatedAt: Timestamp.now(),
    });

    await accountRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'ACCOUNT_APPROVED',
      'account',
      accountId,
      { status: account.status },
      { status: 'active' },
      accountId,
      { ipAddress }
    );

    // Enviar email de notificación
    try {
      await this.emailService.sendEmail({
        to: account.email,
        toName: account.displayName || account.email,
        subject: '✅ Tu cuenta ha sido aprobada - Microfinanciera',
        htmlContent: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>✅ Cuenta Aprobada</h1>
              </div>
              <div class="content">
                <p>Estimado/a <strong>${account.displayName || account.email}</strong>,</p>
                <p>Tu cuenta ha sido aprobada exitosamente. Ya puedes acceder a todos los servicios de la plataforma.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        textContent: `Tu cuenta ha sido aprobada exitosamente. Ya puedes acceder a todos los servicios de la plataforma.`,
      });
    } catch (error) {
      console.error('Error enviando email de aprobación:', error);
    }
  }

  async rejectAccount(
    microfinancieraId: string,
    accountId: string,
    userId: string,
    reason: string,
    ipAddress?: string
  ): Promise<void> {
    const accountRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(accountId);

    const accountDoc = await accountRef.get();
    if (!accountDoc.exists) {
      throw new Error('Cuenta no encontrada');
    }

    const account = accountDoc.data() as Account;
    if (account.status !== 'pending') {
      throw new Error(`No se puede rechazar una cuenta con estado: ${account.status}`);
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('El motivo del rechazo es obligatorio');
    }

    const transition: AccountTransition = {
      from: account.status,
      to: 'rejected',
      timestamp: Timestamp.now(),
      userId,
      reason,
      ipAddress,
    };

    await accountRef.update({
      status: 'rejected',
      rejectedAt: Timestamp.now(),
      rejectedBy: userId,
      rejectionReason: reason,
      updatedAt: Timestamp.now(),
    });

    await accountRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'ACCOUNT_REJECTED',
      'account',
      accountId,
      { status: account.status },
      { status: 'rejected', reason },
      accountId,
      { ipAddress }
    );

    // Enviar email de notificación
    try {
      await this.emailService.sendEmail({
        to: account.email,
        toName: account.displayName || account.email,
        subject: 'Cuenta rechazada - Microfinanciera',
        htmlContent: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Cuenta Rechazada</h1>
              </div>
              <div class="content">
                <p>Estimado/a <strong>${account.displayName || account.email}</strong>,</p>
                <p>Lamentamos informarte que tu cuenta ha sido rechazada.</p>
                <p><strong>Motivo:</strong> ${reason}</p>
              </div>
            </div>
          </body>
          </html>
        `,
        textContent: `Tu cuenta ha sido rechazada. Motivo: ${reason}`,
      });
    } catch (error) {
      console.error('Error enviando email de rechazo:', error);
    }
  }

  async changeAccountStatus(
    microfinancieraId: string,
    accountId: string,
    newStatus: AccountStatus,
    userId: string,
    reason?: string,
    ipAddress?: string
  ): Promise<void> {
    const accountRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(accountId);

    const accountDoc = await accountRef.get();
    if (!accountDoc.exists) {
      throw new Error('Cuenta no encontrada');
    }

    const account = accountDoc.data() as Account;
    const currentStatus = account.status as AccountStatus;

    if (!this.isValidTransition(currentStatus, newStatus)) {
      throw new Error(`Transición inválida de ${currentStatus} a ${newStatus}`);
    }

    // Validaciones específicas por estado
    if (newStatus === 'blocked' || newStatus === 'closed') {
      if (!reason || reason.trim().length === 0) {
        throw new Error('El motivo es obligatorio para bloquear o cerrar una cuenta');
      }
    }

    const transition: AccountTransition = {
      from: currentStatus,
      to: newStatus,
      timestamp: Timestamp.now(),
      userId,
      reason,
      ipAddress,
    };

    const updateData: any = {
      status: newStatus,
      updatedAt: Timestamp.now(),
    };

    if (newStatus === 'blocked') {
      updateData.blockedAt = Timestamp.now();
      updateData.blockedReason = reason;
      updateData.blockedBy = userId;
    } else if (newStatus === 'closed') {
      updateData.closedAt = Timestamp.now();
      updateData.closedReason = reason;
      updateData.closedBy = userId;
    } else if (newStatus === 'active' && currentStatus === 'blocked') {
      // Reactivación
      updateData.blockedAt = null;
      updateData.blockedReason = null;
      updateData.blockedBy = null;
    }

    await accountRef.update(updateData);
    await accountRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'ACCOUNT_STATUS_CHANGED',
      'account',
      accountId,
      { status: currentStatus },
      { status: newStatus, reason },
      accountId,
      { ipAddress }
    );

    // Enviar email de notificación
    try {
      const statusMessages: Record<AccountStatus, { subject: string; message: string }> = {
        active: {
          subject: '✅ Tu cuenta ha sido activada',
          message: 'Tu cuenta ha sido activada exitosamente.',
        },
        blocked: {
          subject: '⚠️ Tu cuenta ha sido bloqueada',
          message: `Tu cuenta ha sido bloqueada. Motivo: ${reason}`,
        },
        closed: {
          subject: 'Cuenta cerrada',
          message: `Tu cuenta ha sido cerrada. Motivo: ${reason}`,
        },
        pending: {
          subject: 'Cuenta en revisión',
          message: 'Tu cuenta está en proceso de revisión.',
        },
        rejected: {
          subject: 'Cuenta rechazada',
          message: `Tu cuenta ha sido rechazada. Motivo: ${reason}`,
        },
      };

      const message = statusMessages[newStatus];
      if (message) {
        await this.emailService.sendEmail({
          to: account.email,
          toName: account.displayName || account.email,
          subject: message.subject,
          htmlContent: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 10px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="content">
                  <p>Estimado/a <strong>${account.displayName || account.email}</strong>,</p>
                  <p>${message.message}</p>
                </div>
              </div>
            </body>
            </html>
          `,
          textContent: message.message,
        });
      }
    } catch (error) {
      console.error('Error enviando email de cambio de estado:', error);
    }
  }

  async getActiveAccountsKPIs(microfinancieraId: string): Promise<AccountKPI> {
    const accountsSnapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .get();

    const accounts = accountsSnapshot.docs.map((doc) => doc.data() as Account);

    const activeAccounts = accounts.filter((a) => a.status === 'active');
    const activeAccountIds = activeAccounts.map((a) => a.id);

    // Obtener solicitudes de crédito de cuentas activas
    const applicationsSnapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('loanApplications')
      .where('customerId', 'in', activeAccountIds.length > 0 ? activeAccountIds : [''])
      .get();

    const totalApplications = applicationsSnapshot.size;
    const approvedApplications = applicationsSnapshot.docs.filter(
      (doc) => doc.data().status === 'approved' || doc.data().status === 'disbursed'
    ).length;

    return {
      totalAccounts: accounts.length,
      activeAccounts: activeAccounts.length,
      blockedAccounts: accounts.filter((a) => a.status === 'blocked').length,
      closedAccounts: accounts.filter((a) => a.status === 'closed').length,
      pendingAccounts: accounts.filter((a) => a.status === 'pending').length,
      totalApplications,
      totalCredits: approvedApplications,
      totalPayments: 0, // TODO: Implementar cuando haya sistema de pagos
      incidents: 0, // TODO: Implementar cuando haya sistema de incidencias
    };
  }
}
