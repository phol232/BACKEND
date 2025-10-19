import { db } from '../config/firebase';
import { User } from '../types/user';
import { EmailService } from './emailService';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import * as admin from 'firebase-admin';

const emailService = new EmailService();

export class UserService {
  public async getUser(uid: string): Promise<User | null> {
    console.log('🔍 Buscando usuario:', uid);
    
    // Primero intentar en la colección global (para compatibilidad)
    const globalUserDoc = await db().collection('users').doc(uid).get();
    if (globalUserDoc.exists) {
      console.log('✅ Usuario encontrado en colección global');
      return globalUserDoc.data() as User;
    }

    // Si no está en la colección global, buscar en todas las microfinancieras
    console.log('🔍 Buscando en microfinancieras...');
    const microfinancierasSnapshot = await db().collection('microfinancieras').get();
    
    for (const mfDoc of microfinancierasSnapshot.docs) {
      const userDoc = await db()
        .collection('microfinancieras')
        .doc(mfDoc.id)
        .collection('users')
        .doc(uid)
        .get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        console.log('✅ Usuario encontrado en microfinanciera:', mfDoc.id);
        
        // Convertir el formato de microfinanciera al formato esperado por el backend
        const user: User = {
          uid: userData?.userId || uid,
          email: userData?.email || '',
          displayName: userData?.displayName,
          photoURL: userData?.photoUrl,
          phoneNumber: userData?.phone,
          provider: userData?.linkedProviders?.includes('google') ? 'google' : 'email',
          status: userData?.status || 'pending',
          role: userData?.roles?.includes('admin') ? 'admin' : 
                userData?.roles?.includes('agent') ? 'agent' : 'user',
          createdAt: userData?.createdAt || admin.firestore.Timestamp.fromDate(new Date()),
          updatedAt: userData?.updatedAt || admin.firestore.Timestamp.fromDate(new Date()),
          approvedAt: userData?.approvedAt,
          rejectedAt: userData?.rejectedAt,
          rejectionReason: userData?.rejectionReason,
        };
        
        return user;
      }
    }
    
    console.log('❌ Usuario no encontrado en ninguna microfinanciera');
    return null;
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

  private async updateUserInMicrofinanciera(uid: string, updates: any): Promise<void> {
    // Buscar en todas las microfinancieras para encontrar y actualizar el usuario
    const microfinancierasSnapshot = await db().collection('microfinancieras').get();
    
    for (const mfDoc of microfinancierasSnapshot.docs) {
      const userDoc = await db()
        .collection('microfinancieras')
        .doc(mfDoc.id)
        .collection('users')
        .doc(uid)
        .get();
      
      if (userDoc.exists) {
        console.log('📝 Actualizando usuario en microfinanciera:', mfDoc.id);
        await db()
          .collection('microfinancieras')
          .doc(mfDoc.id)
          .collection('users')
          .doc(uid)
          .update(updates);
        return;
      }
    }
    
    // Si no se encuentra en microfinancieras, intentar en la colección global
    const globalUserDoc = await db().collection('users').doc(uid).get();
    if (globalUserDoc.exists) {
      console.log('📝 Actualizando usuario en colección global');
      await db().collection('users').doc(uid).update(updates);
    } else {
      throw new Error(`No se pudo encontrar el usuario ${uid} para actualizar`);
    }
  }

  async sendApprovalConfirmationEmail(uid: string, email: string, displayName?: string) {
    try {
      const userName = displayName || email.split('@')[0];
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Cuenta Aprobada - Microfinanciera</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .success-icon { font-size: 48px; margin-bottom: 20px; }
            .button { display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="success-icon">✅</div>
              <h1>¡Cuenta Aprobada!</h1>
            </div>
            <div class="content">
              <h2>¡Hola ${userName}!</h2>
              <p>¡Excelentes noticias! Tu cuenta ha sido <strong>aprobada exitosamente</strong> por nuestro equipo de administración.</p>
              
              <p>Ya puedes acceder a todas las funcionalidades de la aplicación:</p>
              <ul>
                <li>✅ Ver préstamos</li>
                <li>✅ Ver historial solicitudes</li>
                <li>✅ Reportes</li>
                <li>✅ Configuracion</li>
              </ul>
              
              <p>Para comenzar, simplemente inicia sesión en la aplicación móvil con tu cuenta:</p>
              <p><strong>Email:</strong> ${email}</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <p>¡Bienvenido a nuestra plataforma de microfinanzas!</p>
              </div>
              
              <p>Si tienes alguna pregunta o necesitas ayuda, no dudes en contactarnos.</p>
              
              <p>Saludos cordiales,<br>
              <strong>Equipo de Microfinanciera</strong></p>
            </div>
            <div class="footer">
              <p>Este es un email automático, por favor no respondas a este mensaje.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
¡Cuenta Aprobada!

¡Hola ${userName}!

¡Excelentes noticias! Tu cuenta ha sido aprobada exitosamente por nuestro equipo de administración.

Ya puedes acceder a todas las funcionalidades de la aplicación:
- Solicitar préstamos
- Ver tu historial crediticio
- Gestionar tus pagos
- Acceder a reportes personalizados

Para comenzar, simplemente inicia sesión en la aplicación móvil con tu cuenta:
Email: ${email}

¡Bienvenido a nuestra plataforma de microfinanzas!

Si tienes alguna pregunta o necesitas ayuda, no dudes en contactarnos.

Saludos cordiales,
Equipo de Microfinanciera

---
Este es un email automático, por favor no respondas a este mensaje.
      `;

      await emailService.sendEmail({
        to: email,
        subject: '✅ ¡Tu cuenta ha sido aprobada! - Microfinanciera',
        htmlContent,
        textContent,
      });

      console.log('✅ Email de confirmación de aprobación enviado a:', email);
    } catch (error) {
      console.error('❌ Error enviando email de confirmación de aprobación:', error);
      // No lanzamos el error para que no falle la aprobación si hay problemas con el email
    }
  }

  async approveUser(uid: string) {
    console.log('🔍 Buscando usuario para aprobar:', uid);
    const user = await this.getUser(uid);
    console.log('👤 Usuario encontrado:', user ? { uid: user.uid, email: user.email, status: user.status } : 'NO ENCONTRADO');
    
    if (!user) {
      throw new Error(`Usuario no encontrado: ${uid}`);
    }
    
    // Manejar usuarios legacy sin status definido
    if (user.status === undefined || user.status === null) {
      console.log('🔧 Usuario legacy sin status, estableciendo como pending primero');
      await this.updateUserInMicrofinanciera(uid, {
        status: 'pending',
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
    } else if (user.status !== 'pending') {
      throw new Error(`Usuario no está pendiente. Estado actual: ${user.status}`);
    }

    console.log('✅ Aprobando usuario:', uid);
    await this.updateUserInMicrofinanciera(uid, {
      status: 'approved',
      approvedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });
    
    // Enviar email de confirmación de aprobación
    console.log('📧 Enviando email de confirmación de aprobación...');
    await this.sendApprovalConfirmationEmail(uid, user.email, user.displayName);
    
    console.log('✅ Usuario aprobado exitosamente:', uid);
  }

  async rejectUser(uid: string, reason?: string) {
    console.log('🔍 Buscando usuario para rechazar:', uid);
    const user = await this.getUser(uid);
    console.log('👤 Usuario encontrado:', user ? { uid: user.uid, email: user.email, status: user.status } : 'NO ENCONTRADO');
    
    if (!user) {
      throw new Error(`Usuario no encontrado: ${uid}`);
    }
    
    // Manejar usuarios legacy sin status definido
    if (user.status === undefined || user.status === null) {
      console.log('🔧 Usuario legacy sin status, estableciendo como pending primero');
      await this.updateUserInMicrofinanciera(uid, {
        status: 'pending',
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      });
    } else if (user.status !== 'pending') {
      throw new Error(`Usuario no está pendiente. Estado actual: ${user.status}`);
    }

    console.log('❌ Rechazando usuario:', uid);
    await this.updateUserInMicrofinanciera(uid, {
      status: 'rejected',
      rejectedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      rejectionReason: reason,
    });
    console.log('❌ Usuario rechazado exitosamente:', uid);
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