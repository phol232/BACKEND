import { db } from '../config/firebase';
import { User } from '../types/user';
import { EmailService } from './emailService';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import * as admin from 'firebase-admin';
import NodeCache from 'node-cache';

const emailService = new EmailService();
// Caché de usuarios: 5 minutos de TTL
const userCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

export class UserService {
  public async getUserInMicrofinanciera(microfinancieraId: string, uid: string): Promise<User | null> {
    console.log('🔍 Buscando usuario en microfinanciera:', { microfinancieraId, uid });
    
    const userDoc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('users')
      .doc(uid)
      .get();
    
    if (!userDoc.exists) {
      console.log('❌ Usuario no encontrado en microfinanciera');
      return null;
    }
    
    const userData = userDoc.data();
    console.log('✅ Usuario encontrado en microfinanciera');
    
    // Priorizar primaryRoleId sobre roles array
    let userRole: 'admin' | 'analyst' | 'employee' = 'employee';
    if (userData?.primaryRoleId) {
      userRole = userData.primaryRoleId as 'admin' | 'analyst' | 'employee';
      console.log('📋 Rol desde primaryRoleId:', userRole);
    } else if (userData?.roleIds && Array.isArray(userData.roleIds) && userData.roleIds.length > 0) {
      if (userData.roleIds.includes('admin')) userRole = 'admin';
      else if (userData.roleIds.includes('analyst')) userRole = 'analyst';
      else if (userData.roleIds.includes('employee')) userRole = 'employee';
      else if (userData.roleIds.includes('agent')) userRole = 'employee';
      console.log('📋 Rol desde roleIds:', userRole);
    } else if (userData?.roles && Array.isArray(userData.roles) && userData.roles.length > 0) {
      // Fallback a roles array si no hay primaryRoleId ni roleIds
      if (userData.roles.includes('admin')) userRole = 'admin';
      else if (userData.roles.includes('analyst')) userRole = 'analyst';
      else if (userData.roles.includes('employee')) userRole = 'employee';
      else if (userData.roles.includes('agent')) userRole = 'employee'; // Legacy
      console.log('📋 Rol desde roles array:', userRole);
    }
    
    const user: User = {
      uid: userData?.userId || uid,
      email: userData?.email || '',
      displayName: userData?.displayName,
      photoURL: userData?.photoUrl,
      phoneNumber: userData?.phone,
      provider: userData?.providerIds?.includes('google.com') ? 'google' : 
                userData?.linkedProviders?.includes('google') ? 'google' : 'email',
      status: userData?.status || 'pending',
      role: userRole,
      microfinancieraId,
      createdAt: userData?.createdAt || admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: userData?.updatedAt || admin.firestore.Timestamp.fromDate(new Date()),
      approvedAt: userData?.approvedAt,
      rejectedAt: userData?.rejectedAt,
      rejectionReason: userData?.rejectionReason,
    };
    
    console.log('✅ Usuario mapeado:', { uid: user.uid, email: user.email, role: user.role, status: user.status });
    
    return user;
  }

  public async getUser(uid: string): Promise<User | null> {
    // Verificar caché primero
    const cacheKey = `user_${uid}`;
    const cachedUser = userCache.get<User>(cacheKey);
    if (cachedUser) {
      console.log('✅ Usuario encontrado en caché:', uid);
      return cachedUser;
    }

    console.log('🔍 Buscando usuario en BD:', uid);
    
    try {
      // Intentar usar collectionGroup (requiere índice)
      const userQuery = await db()
        .collectionGroup('users')
        .where('userId', '==', uid)
        .limit(1)
        .get();
      
      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const microfinancieraId = userDoc.ref.parent.parent?.id;
        console.log('✅ Usuario encontrado via collectionGroup');
        
        const user = this.mapUserData(userData, uid, microfinancieraId);
        userCache.set(cacheKey, user);
        console.log('💾 Usuario guardado en caché');
        
        return user;
      }
    } catch (error: any) {
      // Si falla por índice faltante, usar fallback
      if (error.message?.includes('FAILED_PRECONDITION') || error.message?.includes('index')) {
        console.log('⚠️ Índice no disponible, usando búsqueda directa');
        
        // Buscar en microfinanciera conocida (mf_demo_001)
        const knownMfIds = ['mf_demo_001', 'S1']; // IDs conocidos
        
        for (const mfId of knownMfIds) {
          try {
            const userDoc = await db()
              .collection('microfinancieras')
              .doc(mfId)
              .collection('users')
              .doc(uid)
              .get();
            
            if (userDoc.exists) {
              console.log('✅ Usuario encontrado en microfinanciera:', mfId);
              const userData = userDoc.data();
              const user = this.mapUserData(userData, uid, mfId);
              userCache.set(cacheKey, user);
              return user;
            }
          } catch (err) {
            console.log('❌ Error buscando en', mfId, err);
          }
        }
      } else {
        throw error;
      }
    }
    
    // Fallback a colección global
    console.log('🔍 Buscando en colección global...');
    const globalUserDoc = await db().collection('users').doc(uid).get();
    if (globalUserDoc.exists) {
      console.log('⚠️ Usuario encontrado en colección global (legacy)');
      const userData = globalUserDoc.data();
      
      let userRole: 'admin' | 'analyst' | 'employee' = 'employee';
      if (userData?.primaryRoles && Array.isArray(userData.primaryRoles) && userData.primaryRoles.length > 0) {
        const primaryRole = userData.primaryRoles[0];
        if (['admin', 'analyst', 'employee'].includes(primaryRole)) {
          userRole = primaryRole as 'admin' | 'analyst' | 'employee';
        }
      }
      
      const user = {
        ...userData,
        uid,
        role: userRole,
      } as User;
      
      userCache.set(cacheKey, user);
      return user;
    }
    
    console.log('❌ Usuario no encontrado');
    return null;
  }

  public async listUsers(
    microfinancieraId: string,
    status?: 'pending' | 'approved' | 'rejected',
    limit = 200
  ): Promise<User[]> {
    if (!microfinancieraId) {
      throw new Error('microfinancieraId es obligatorio');
    }

    let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('users')
      .orderBy('createdAt', 'desc');

    if (status) {
      query = query.where('status', '==', status);
    }

    if (limit) {
      query = query.limit(limit);
    }

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => this.mapUserData(doc.data(), doc.id));
  }

  private mapUserData(userData: any, uid: string, microfinancieraId?: string): User {
    // Priorizar primaryRoleId sobre roles array
    let userRole: 'admin' | 'analyst' | 'employee' = 'employee';
    if (userData?.primaryRoleId) {
      userRole = userData.primaryRoleId as 'admin' | 'analyst' | 'employee';
    } else if (userData?.roleIds && Array.isArray(userData.roleIds) && userData.roleIds.length > 0) {
      if (userData.roleIds.includes('admin')) userRole = 'admin';
      else if (userData.roleIds.includes('analyst')) userRole = 'analyst';
      else if (userData.roleIds.includes('employee')) userRole = 'employee';
      else if (userData.roleIds.includes('agent')) userRole = 'employee';
    } else if (userData?.roles && Array.isArray(userData.roles) && userData.roles.length > 0) {
      if (userData.roles.includes('admin')) userRole = 'admin';
      else if (userData.roles.includes('analyst')) userRole = 'analyst';
      else if (userData.roles.includes('employee')) userRole = 'employee';
      else if (userData.roles.includes('agent')) userRole = 'employee';
    }
    
    return {
      uid: userData?.userId || uid,
      email: userData?.email || '',
      displayName: userData?.displayName,
      photoURL: userData?.photoUrl,
      phoneNumber: userData?.phone,
      provider: userData?.providerIds?.includes('google.com') ? 'google' : 
                userData?.linkedProviders?.includes('google') ? 'google' : 'email',
      status: userData?.status || 'pending',
      role: userRole,
      microfinancieraId,
      createdAt: userData?.createdAt || admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: userData?.updatedAt || admin.firestore.Timestamp.fromDate(new Date()),
      approvedAt: userData?.approvedAt,
      rejectedAt: userData?.rejectedAt,
      rejectionReason: userData?.rejectionReason,
    };
  }

  async createPendingUserInMicrofinanciera(
    microfinancieraId: string,
    uid: string,
    email: string,
    displayName?: string,
    provider: 'google' | 'email' = 'email',
    role?: 'admin' | 'analyst' | 'employee'
  ) {
    console.log('🆕 Creando usuario en microfinanciera:', { microfinancieraId, uid, email, role });
    
    // Mapear el rol seleccionado al roleId de Firestore
    const roleIds = role ? [role] : ['employee'];
    const primaryRole = role || 'employee';
    
    const newUserData = {
      userId: uid,
      email,
      displayName: displayName || email.split('@')[0],
      phone: '',
      photoUrl: provider === 'google' ? `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || email.split('@')[0])}` : null,
      linkedProviders: [provider],
      roles: [], // Vacío por ahora, se llenará al aprobar
      roleIds: roleIds, // El rol seleccionado
      primaryRoleId: primaryRole, // Establecer el rol principal desde el inicio
      mfId: microfinancieraId, // Agregar el ID de la microfinanciera
      status: 'pending',
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      isActive: false,
    };

    await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('users')
      .doc(uid)
      .set(newUserData);
    
    console.log('✅ Usuario creado en microfinanciera con rol:', primaryRole);
    
    // Enviar emails
    await this.sendApprovalEmail(uid, email, displayName);
    await this.sendPendingConfirmationEmail(email, displayName);
    
    return {
      uid,
      email,
      displayName,
      provider,
      status: 'pending' as const,
      role: primaryRole as 'admin' | 'analyst' | 'employee',
      createdAt: newUserData.createdAt,
      updatedAt: newUserData.updatedAt,
    };
  }

  async createPendingUser(uid: string, email: string, displayName?: string, provider: 'google' | 'email' = 'email') {
    const existingUser = await this.getUser(uid);
    if (existingUser) {
      if (existingUser.status !== 'pending') {
        return existingUser;
      }
      // If already pending, resend emails
      await this.sendApprovalEmail(uid, email, displayName);
      await this.sendPendingConfirmationEmail(email, displayName);
      return existingUser;
    }

    const newUser: User = {
      uid,
      email,
      displayName,
      provider,
      status: 'pending',
      role: 'employee', // Default role
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
    };

    const userWithRole: User = newUser;
    
    await db().collection('users').doc(uid).set(userWithRole);
    await this.sendApprovalEmail(uid, email, displayName);
    await this.sendPendingConfirmationEmail(email, displayName);
    return userWithRole;
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

  private async updateUserInMicrofinanciera(
    uid: string,
    updates: any,
    microfinancieraId?: string
  ): Promise<void> {
    const cacheKey = `user_${uid}`;
    const knownMfIds = microfinancieraId ? [microfinancieraId] : ['mf_demo_001', 'S1'];

    // 1) Intentar ruta directa si conocemos microfinanciera
    for (const mfId of knownMfIds) {
      try {
        const userRef = db()
          .collection('microfinancieras')
          .doc(mfId)
          .collection('users')
          .doc(uid);

        const existing = await userRef.get();
        if (existing.exists) {
          console.log('📝 Actualizando usuario en microfinanciera:', mfId);
          await userRef.update(updates);
          userCache.del(cacheKey);
          console.log('🗑️ Caché invalidado para usuario:', uid);
          return;
        }
      } catch (error) {
        console.log('⚠️ No se pudo actualizar en', mfId, error);
      }
    }

    // 2) Fallback usando collectionGroup (puede requerir índice)
    try {
      const userQuery = await db()
        .collectionGroup('users')
        .where('userId', '==', uid)
        .limit(1)
        .get();

      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        console.log('📝 Actualizando usuario via collectionGroup');
        await userDoc.ref.update(updates);
        userCache.del(cacheKey);
        console.log('🗑️ Caché invalidado para usuario:', uid);
        return;
      }
    } catch (error: any) {
      if (error.message?.includes('FAILED_PRECONDITION') || error.message?.includes('index')) {
        console.log('⚠️ Índice requerido para collectionGroup; ya se intentó ruta directa.');
      } else {
        throw error;
      }
    }

    // 3) Fallback a colección global
    const globalUserDoc = await db().collection('users').doc(uid).get();
    if (globalUserDoc.exists) {
      console.log('📝 Actualizando usuario en colección global');
      await db().collection('users').doc(uid).update(updates);
      userCache.del(cacheKey);
      console.log('🗑️ Caché invalidado para usuario:', uid);
    } else {
      throw new Error(`No se pudo encontrar el usuario ${uid} para actualizar`);
    }
  }

  async sendPendingConfirmationEmail(email: string, displayName?: string) {
    try {
      const userName = displayName || email.split('@')[0];
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ff9800 0%, #ff5722 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⏳ Cuenta Pendiente de Aprobación</h1>
            </div>
            <div class="content">
              <p>Hola <strong>${userName}</strong>,</p>
              
              <p>¡Gracias por registrarte en nuestra plataforma de microfinanzas!</p>
              
              <p>Tu cuenta ha sido creada exitosamente y está actualmente <strong>pendiente de aprobación</strong> por nuestro equipo de administración.</p>
              
              <h3>📋 ¿Qué sucede ahora?</h3>
              <ol>
                <li>Nuestro equipo revisará tu información de registro</li>
                <li>Verificaremos los datos proporcionados</li>
                <li>Te notificaremos por correo una vez que tu cuenta sea aprobada</li>
              </ol>
              
              <p><strong>⏱️ Tiempo estimado:</strong> Entre 24-48 horas hábiles</p>
              
              <p>Una vez aprobada tu cuenta, recibirás un correo de confirmación y podrás acceder a todas las funcionalidades de la plataforma.</p>
              
              <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
              
              <p>Saludos cordiales,<br>
              <strong>Equipo de CREDITO-EXPRESS</strong></p>
            </div>
            <div class="footer">
              <p>Este es un correo automático, por favor no respondas a este mensaje.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
Cuenta Pendiente de Aprobación

Hola ${userName},

¡Gracias por registrarte en nuestra plataforma de microfinanzas!

Tu cuenta ha sido creada exitosamente y está actualmente pendiente de aprobación por nuestro equipo de administración.

¿Qué sucede ahora?
1. Nuestro equipo revisará tu información de registro
2. Verificaremos los datos proporcionados
3. Te notificaremos por correo una vez que tu cuenta sea aprobada

Tiempo estimado: Entre 24-48 horas hábiles

Una vez aprobada tu cuenta, recibirás un correo de confirmación y podrás acceder a todas las funcionalidades de la plataforma.

Si tienes alguna pregunta, no dudes en contactarnos.

Saludos cordiales,
Equipo de CREDITO-EXPRESS
      `;

      await emailService.sendEmail({
        to: email,
        subject: '⏳ Tu cuenta está pendiente de aprobación - CREDITO-EXPRESS',
        htmlContent,
        textContent,
      });

      console.log('✅ Email de confirmación de registro pendiente enviado a:', email);
    } catch (error) {
      console.error('❌ Error enviando email de confirmación de registro pendiente:', error);
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
    console.log('👤 Usuario encontrado:', user ? { uid: user.uid, email: user.email, status: user.status, role: user.role } : 'NO ENCONTRADO');
    
    if (!user) {
      throw new Error(`Usuario no encontrado: ${uid}`);
    }
    
    // Manejar usuarios legacy sin status definido
    if (user.status === undefined || user.status === null) {
      console.log('🔧 Usuario legacy sin status, estableciendo como pending primero');
      await this.updateUserInMicrofinanciera(uid, {
        status: 'pending',
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      }, user.microfinancieraId);
    } else if (user.status !== 'pending') {
      throw new Error(`Usuario no está pendiente. Estado actual: ${user.status}`);
    }

    console.log('✅ Aprobando usuario:', uid, 'con rol:', user.role);
    
    // Establecer primaryRoleId basándose en el rol del usuario
    await this.updateUserInMicrofinanciera(uid, {
      status: 'approved',
      primaryRoleId: user.role, // Establecer el rol principal
      approvedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      isActive: true,
    }, user.microfinancieraId);
    
    // Enviar email de confirmación de aprobación
    console.log('📧 Enviando email de confirmación de aprobación...');
    await this.sendApprovalConfirmationEmail(uid, user.email, user.displayName);
    
    console.log('✅ Usuario aprobado exitosamente:', uid, 'con rol:', user.role);
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
      }, user.microfinancieraId);
    } else if (user.status !== 'pending') {
      throw new Error(`Usuario no está pendiente. Estado actual: ${user.status}`);
    }

    console.log('❌ Rechazando usuario:', uid);
    await this.updateUserInMicrofinanciera(uid, {
      status: 'rejected',
      rejectedAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      rejectionReason: reason,
    }, user.microfinancieraId);
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

  public clearUserCache(uid: string): void {
    const cacheKey = `user_${uid}`;
    userCache.del(cacheKey);
    console.log(`🗑️  Caché limpiado para usuario ${uid}`);
  }

  async migrateUserRoles(microfinancieraId: string): Promise<{ updated: number; skipped: number; errors: number }> {
    console.log('🔄 Iniciando migración de roles para:', microfinancieraId);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    try {
      const usersSnapshot = await db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('users')
        .get();
      
      console.log(`📊 Total de usuarios encontrados: ${usersSnapshot.size}`);
      
      for (const userDoc of usersSnapshot.docs) {
        try {
          const userData = userDoc.data();
          const uid = userDoc.id;
          
          // Si ya tiene primaryRoleId, saltar
          if (userData.primaryRoleId) {
            console.log(`⏭️  Usuario ${uid} ya tiene primaryRoleId:`, userData.primaryRoleId);
            skipped++;
            continue;
          }
          
          // Determinar el rol basándose en roleIds o roles
          let primaryRole: 'admin' | 'analyst' | 'employee' = 'employee';
          
          if (userData.roleIds && Array.isArray(userData.roleIds) && userData.roleIds.length > 0) {
            if (userData.roleIds.includes('admin')) primaryRole = 'admin';
            else if (userData.roleIds.includes('analyst')) primaryRole = 'analyst';
            else if (userData.roleIds.includes('employee')) primaryRole = 'employee';
            else if (userData.roleIds.includes('agent')) primaryRole = 'employee';
          } else if (userData.roles && Array.isArray(userData.roles) && userData.roles.length > 0) {
            if (userData.roles.includes('admin')) primaryRole = 'admin';
            else if (userData.roles.includes('analyst')) primaryRole = 'analyst';
            else if (userData.roles.includes('employee')) primaryRole = 'employee';
            else if (userData.roles.includes('agent')) primaryRole = 'employee';
          }
          
          // Actualizar el usuario con primaryRoleId y mfId
          await userDoc.ref.update({
            primaryRoleId: primaryRole,
            mfId: microfinancieraId,
            updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
          });
          
          // Limpiar caché del usuario
          const cacheKey = `user_${uid}`;
          userCache.del(cacheKey);
          console.log(`🗑️  Caché limpiado para usuario ${uid}`);
          
          console.log(`✅ Usuario ${uid} actualizado con primaryRoleId: ${primaryRole} y mfId: ${microfinancieraId}`);
          updated++;
        } catch (error: any) {
          console.error(`❌ Error actualizando usuario ${userDoc.id}:`, error.message);
          errors++;
        }
      }
      
      console.log(`✅ Migración completada: ${updated} actualizados, ${skipped} saltados, ${errors} errores`);
      
      return { updated, skipped, errors };
    } catch (error: any) {
      console.error('❌ Error en migración:', error.message);
      throw error;
    }
  }
}
