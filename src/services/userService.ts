import { db } from '../config/firebase';
import { User } from '../types/user';
import { EmailService } from './emailService';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import * as admin from 'firebase-admin';

const emailService = new EmailService();

export class UserService {
  public async getUser(uid: string): Promise<User | null> {
    const userDoc = await db().collection('users').doc(uid).get();
    return userDoc.exists ? (userDoc.data() as User) : null;
  }

  async createPendingUser(uid: string, email: string, displayName?: string, provider: 'google' | 'email' = 'email') {
    const existingUser = await this.getUser(uid);
    if (existingUser) {
      if (existingUser.status !== 'pending') {
        return existingUser;
      }
      // If already pending, resend email?
      await this.sendApprovalEmail(uid, email, displayName);
      return existingUser;
    }

    const newUser: User = {
      uid,
      email,
      displayName,
      provider,
      status: 'pending',
      role: 'user',
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    };

    await db().collection('users').doc(uid).set(newUser);
    await this.sendApprovalEmail(uid, email, displayName);
    return newUser;
  }

  private generateApprovalToken(uid: string, action: 'approve' | 'reject'): string {
    return jwt.sign({ uid, action }, config.jwt.secret, { expiresIn: '7d' });
  }

  async sendApprovalEmail(uid: string, email: string, displayName?: string) {
    const name = displayName || email.split('@')[0];
    const approveToken = this.generateApprovalToken(uid, 'approve');
    const rejectToken = this.generateApprovalToken(uid, 'reject');

    const baseUrl = process.env.SERVER_URL || `http://localhost:${config.port}`;
    const approveLink = `${baseUrl}/api/users/approve?token=${approveToken}`;
    const rejectLink = `${baseUrl}/api/users/reject?token=${rejectToken}`;

    const htmlContent = `
      <h1>Nuevo Usuario Pendiente</h1>
      <p>El usuario ${name} (${email}) solicita acceso a la microfinanciera.</p>
      <a href="${approveLink}">Aprobar</a>
      <a href="${rejectLink}">Rechazar</a>
    `;

    await emailService.sendEmail({
      to: 'ph2309.t@gmail.com',
      toName: 'Admin',
      subject: 'Nuevo Usuario Pendiente de Aprobación',
      htmlContent,
      textContent: `Nuevo usuario: ${name} (${email}). Aprobar: ${approveLink}, Rechazar: ${rejectLink}`,
    });
  }

  async approveUser(uid: string) {
    const user = await this.getUser(uid);
    if (!user || user.status !== 'pending') {
      throw new Error('User not found or not pending');
    }

    await db().collection('users').doc(uid).update({
      status: 'approved',
      approvedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });
  }

  async rejectUser(uid: string, reason?: string) {
    const user = await this.getUser(uid);
    if (!user || user.status !== 'pending') {
      throw new Error('User not found or not pending');
    }

    await db().collection('users').doc(uid).update({
      status: 'rejected',
      rejectedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      rejectionReason: reason,
    });
  }

  async handleApprovalToken(token: string): Promise<{ success: boolean; message: string }> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as { uid: string; action: 'approve' | 'reject' };
      if (decoded.action === 'approve') {
        await this.approveUser(decoded.uid);
        return { success: true, message: 'Usuario aprobado exitosamente.' };
      } else if (decoded.action === 'reject') {
        await this.rejectUser(decoded.uid);
        return { success: true, message: 'Usuario rechazado exitosamente.' };
      }
      throw new Error('Acción inválida');
    } catch (error) {
      return { success: false, message: 'Token inválido o expirado.' };
    }
  }
}