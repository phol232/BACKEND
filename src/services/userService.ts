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
    console.log('🔧 Generando token para:', { uid, action });
    console.log('🔑 Usando JWT Secret:', config.jwt.secret ? 'SÍ' : 'NO');
    
    const token = jwt.sign({ uid, action }, config.jwt.secret, { expiresIn: '7d' });
    console.log('✅ Token generado:', token.substring(0, 20) + '...');
    
    return token;
  }

  async sendApprovalEmail(uid: string, email: string, displayName?: string) {
    const name = displayName || email.split('@')[0];
    const approveToken = this.generateApprovalToken(uid, 'approve');
    const rejectToken = this.generateApprovalToken(uid, 'reject');

    const baseUrl = process.env.SERVER_URL || 'https://backend-eight-zeta-41.vercel.app';
    const approveLink = `${baseUrl}/api/users/approve?token=${approveToken}`;
    const rejectLink = `${baseUrl}/api/users/reject?token=${rejectToken}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nuevo Usuario Registrado</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ff7b7b 0%, #667eea 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .user-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff7b7b; }
          .provider-badge { display: inline-block; background: #667eea; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; text-transform: uppercase; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          .action-buttons { text-align: center; margin: 30px 0; }
          .btn { display: inline-block; padding: 15px 30px; margin: 0 10px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: all 0.3s ease; }
          .btn-approve { background: #4CAF50; color: white; }
          .btn-approve:hover { background: #45a049; }
          .btn-reject { background: #f44336; color: white; }
          .btn-reject:hover { background: #da190b; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔔 Nuevo Usuario Registrado</h1>
          </div>
          <div class="content">
            <p>Se ha registrado un nuevo usuario en la plataforma y requiere tu aprobación para acceder al sistema.</p>
            
            <div class="user-info">
              <h3>👤 Información del Usuario:</h3>
              <p><strong>📧 Email:</strong> ${email}</p>
              <p><strong>👤 Nombre:</strong> ${name}</p>
              <p><strong>📅 Fecha de registro:</strong> ${new Date().toLocaleDateString('es-PE', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}</p>
            </div>

            <div class="warning">
              <p><strong>⚠️ Acción requerida:</strong> El usuario está en estado "pendiente" y no puede acceder a la aplicación hasta que apruebes su registro.</p>
            </div>

            <div class="action-buttons">
              <a href="${approveLink}" class="btn btn-approve">✅ Aprobar Usuario</a>
              <a href="${rejectLink}" class="btn btn-reject">❌ Rechazar Usuario</a>
            </div>

            <div class="footer">
              <p>Este es un email automático del sistema de CREDITO-EXPRESS.</p>
              <p style="font-size: 12px; color: #999;">Los enlaces de aprobación/rechazo expiran en 7 días.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Nuevo Usuario Registrado - Requiere Aprobación

Se ha registrado un nuevo usuario en la plataforma:

Información del Usuario:
- Email: ${email}
- Nombre: ${name}
- Fecha: ${new Date().toLocaleDateString('es-PE')}

El usuario está en estado "pendiente" y requiere tu aprobación para acceder.

ACCIONES DISPONIBLES:
- Aprobar: ${approveLink}
- Rechazar: ${rejectLink}

Los enlaces expiran en 7 días.

Sistema CREDITO-EXPRESS
    `;

    const adminEmail = process.env.ADMIN_EMAIL || 'ph2309.t@gmail.com';
    await emailService.sendEmail({
      to: adminEmail,
      toName: 'Administrador',
      subject: '🔔 Nuevo usuario registrado - Requiere aprobación',
      htmlContent,
      textContent,
    });
  }

  async approveUser(uid: string) {
    console.log('🔍 Buscando usuario para aprobar:', uid);
    const user = await this.getUser(uid);
    console.log('👤 Usuario encontrado:', user ? { uid: user.uid, email: user.email, status: user.status } : 'NO ENCONTRADO');
    
    if (!user) {
      throw new Error(`Usuario no encontrado: ${uid}`);
    }
    
    // Si el usuario no tiene status definido, lo consideramos como pending (usuarios legacy)
    if (user.status === undefined || user.status === null) {
      console.log('⚠️ Usuario sin status definido, estableciendo como pending (usuario legacy)');
      await db().collection('users').doc(uid).update({
        status: 'pending',
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
      user.status = 'pending'; // Actualizamos el objeto local
    }
    
    if (user.status !== 'pending') {
      throw new Error(`Usuario no está pendiente. Estado actual: ${user.status}`);
    }

    console.log('✅ Aprobando usuario:', uid);
    await db().collection('users').doc(uid).update({
      status: 'approved',
      approvedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });
    console.log('✅ Usuario aprobado exitosamente:', uid);
  }

  async rejectUser(uid: string, reason?: string) {
    console.log('🔍 Buscando usuario para rechazar:', uid);
    const user = await this.getUser(uid);
    console.log('👤 Usuario encontrado:', user ? { uid: user.uid, email: user.email, status: user.status } : 'NO ENCONTRADO');
    
    if (!user) {
      throw new Error(`Usuario no encontrado: ${uid}`);
    }
    
    // Si el usuario no tiene status definido, lo consideramos como pending (usuarios legacy)
    if (user.status === undefined || user.status === null) {
      console.log('⚠️ Usuario sin status definido, estableciendo como pending (usuario legacy)');
      await db().collection('users').doc(uid).update({
        status: 'pending',
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
      user.status = 'pending'; // Actualizamos el objeto local
    }
    
    if (user.status !== 'pending') {
      throw new Error(`Usuario no está pendiente. Estado actual: ${user.status}`);
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
      console.log('🔍 Procesando token:', token.substring(0, 20) + '...');
      console.log('🔑 JWT Secret configurado:', config.jwt.secret ? 'SÍ' : 'NO');
      console.log('🔑 JWT Secret length:', config.jwt.secret?.length || 0);
      
      const decoded = jwt.verify(token, config.jwt.secret) as { uid: string; action: 'approve' | 'reject' };
      console.log('✅ Token decodificado exitosamente:', { uid: decoded.uid, action: decoded.action });
      
      if (decoded.action === 'approve') {
        await this.approveUser(decoded.uid);
        return { success: true, message: 'Usuario aprobado exitosamente.' };
      } else if (decoded.action === 'reject') {
        await this.rejectUser(decoded.uid);
        return { success: true, message: 'Usuario rechazado exitosamente.' };
      }
      throw new Error('Acción inválida');
    } catch (error: any) {
      console.error('❌ Error procesando token:', error.message);
      console.error('❌ Error completo:', error);
      return { success: false, message: `Token inválido o expirado: ${error.message}` };
    }
  }
}