import * as brevo from '@getbrevo/brevo';
import { config } from '../config';

const apiInstance = new brevo.TransactionalEmailsApi();

if (!config.brevo.apiKey) {
  console.warn('⚠️ BREVO_API_KEY no configurada - Los emails no se enviarán');
} else {
  apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey,
    config.brevo.apiKey
  );
  console.log('✅ Brevo Email Service configured');
}

interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export class EmailService {
  private fromEmail = process.env.BREVO_FROM_EMAIL || 'credito@yamycorp.com';
  private fromName = process.env.BREVO_FROM_NAME || 'CREDITO-EXPRESS';

  async sendEmail({ to, toName, subject, htmlContent, textContent }: SendEmailParams) {
    if (!config.brevo.apiKey) {
      console.log('📧 Email simulado (Brevo no configurado):', { to, subject });
      return { success: true, messageId: 'simulated' };
    }

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = {
      name: this.fromName,
      email: this.fromEmail,
    };
    sendSmtpEmail.to = [{ email: to, name: toName }];

    if (textContent) {
      sendSmtpEmail.textContent = textContent;
    }

    try {
      const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log('✅ Email sent to:', to);
      return { success: true, messageId: (response.body as any)?.messageId };
    } catch (error) {
      console.error('❌ Error sending email:', error);
      throw new Error('Failed to send email');
    }
  }

  async sendLoanApprovedEmail(
    email: string,
    customerName: string,
    loanAmount: number,
    monthlyPayment: number,
    termMonths: number
  ) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #27ae60 0%, #229954 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .highlight-box { background: white; border-left: 4px solid #27ae60; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .amount { font-size: 32px; font-weight: bold; color: #27ae60; }
          .button { display: inline-block; background: #27ae60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 ¡Felicitaciones!</h1>
            <h2>Tu Crédito ha sido Aprobado</h2>
          </div>
          <div class="content">
            <p>Estimado/a <strong>${customerName}</strong>,</p>
            <p>Nos complace informarte que tu solicitud de crédito ha sido <strong>APROBADA</strong>.</p>
            
            <div class="highlight-box">
              <h3>Detalles de tu Crédito:</h3>
              <p><strong>Monto Aprobado:</strong> <span class="amount">S/ ${loanAmount.toLocaleString()}</span></p>
              <p><strong>Cuota Mensual:</strong> S/ ${monthlyPayment.toFixed(2)}</p>
              <p><strong>Plazo:</strong> ${termMonths} meses</p>
            </div>
            
            <p>Puedes ver el cronograma completo de pagos y toda la información de tu crédito en:</p>
            
            <div style="text-align: center;">
              <a href="https://creditoexpress.com/my-loans" class="button">Ver Mis Préstamos</a>
            </div>
            
            <p><strong>Próximos pasos:</strong></p>
            <ol>
              <li>Ingresa a tu cuenta en CreditoExpress</li>
              <li>Ve a la sección "Mis Préstamos"</li>
              <li>Revisa el cronograma de pagos</li>
              <li>El desembolso se realizará en las próximas 24-48 horas</li>
            </ol>
            
            <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
            
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
              <p>CreditoExpress - Tu aliado financiero</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      ¡Felicitaciones ${customerName}!
      
      Tu Crédito ha sido Aprobado
      
      Detalles de tu Crédito:
      - Monto Aprobado: S/ ${loanAmount.toLocaleString()}
      - Cuota Mensual: S/ ${monthlyPayment.toFixed(2)}
      - Plazo: ${termMonths} meses
      
      Puedes ver el cronograma completo de pagos en la sección "Mis Préstamos" de tu cuenta.
      
      Próximos pasos:
      1. Ingresa a tu cuenta en CreditoExpress
      2. Ve a la sección "Mis Préstamos"
      3. Revisa el cronograma de pagos
      4. El desembolso se realizará en las próximas 24-48 horas
      
      Si tienes alguna pregunta, no dudes en contactarnos.
    `;

    return this.sendEmail({
      to: email,
      toName: customerName,
      subject: '🎉 ¡Tu Crédito ha sido Aprobado! - CreditoExpress',
      htmlContent,
      textContent,
    });
  }

  async sendLoanRejectedEmail(
    email: string,
    customerName: string,
    reason: string
  ) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .info-box { background: white; border-left: 4px solid #e74c3c; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .button { display: inline-block; background: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Resultado de tu Solicitud</h1>
          </div>
          <div class="content">
            <p>Estimado/a <strong>${customerName}</strong>,</p>
            <p>Lamentamos informarte que tu solicitud de crédito no ha sido aprobada en esta ocasión.</p>
            
            <div class="info-box">
              <h3>Motivo:</h3>
              <p>${reason}</p>
            </div>
            
            <p><strong>¿Qué puedes hacer?</strong></p>
            <ul>
              <li>Puedes volver a solicitar un crédito en 30 días</li>
              <li>Revisa tu historial crediticio</li>
              <li>Considera mejorar tu capacidad de pago</li>
              <li>Contacta con nosotros para más información</li>
            </ul>
            
            <p>Estamos aquí para ayudarte a mejorar tu perfil crediticio.</p>
            
            <div style="text-align: center;">
              <a href="https://creditoexpress.com/contact" class="button">Contáctanos</a>
            </div>
            
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
              <p>CreditoExpress - Tu aliado financiero</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      Estimado/a ${customerName},
      
      Lamentamos informarte que tu solicitud de crédito no ha sido aprobada en esta ocasión.
      
      Motivo: ${reason}
      
      ¿Qué puedes hacer?
      - Puedes volver a solicitar un crédito en 30 días
      - Revisa tu historial crediticio
      - Considera mejorar tu capacidad de pago
      - Contacta con nosotros para más información
      
      Estamos aquí para ayudarte a mejorar tu perfil crediticio.
    `;

    return this.sendEmail({
      to: email,
      toName: customerName,
      subject: 'Resultado de tu Solicitud de Crédito - CreditoExpress',
      htmlContent,
      textContent,
    });
  }

  async sendLoanObservedEmail(
    email: string,
    customerName: string,
    observations: string
  ) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .warning-box { background: white; border-left: 4px solid #f39c12; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .button { display: inline-block; background: #f39c12; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Tu Solicitud Requiere Atención</h1>
          </div>
          <div class="content">
            <p>Estimado/a <strong>${customerName}</strong>,</p>
            <p>Tu solicitud de crédito está en revisión y requiere información adicional.</p>
            
            <div class="warning-box">
              <h3>Observaciones:</h3>
              <p>${observations}</p>
            </div>
            
            <p><strong>Próximos pasos:</strong></p>
            <ol>
              <li>Revisa las observaciones mencionadas</li>
              <li>Prepara la documentación o información solicitada</li>
              <li>Contacta con nosotros para completar tu solicitud</li>
            </ol>
            
            <div style="text-align: center;">
              <a href="https://creditoexpress.com/contact" class="button">Contáctanos</a>
            </div>
            
            <p>Estamos aquí para ayudarte a completar tu solicitud.</p>
            
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
              <p>CreditoExpress - Tu aliado financiero</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      Estimado/a ${customerName},
      
      Tu solicitud de crédito está en revisión y requiere información adicional.
      
      Observaciones: ${observations}
      
      Próximos pasos:
      1. Revisa las observaciones mencionadas
      2. Prepara la documentación o información solicitada
      3. Contacta con nosotros para completar tu solicitud
      
      Estamos aquí para ayudarte a completar tu solicitud.
    `;

    return this.sendEmail({
      to: email,
      toName: customerName,
      subject: '⚠️ Tu Solicitud Requiere Atención - CreditoExpress',
      htmlContent,
      textContent,
    });
  }

  async sendLoanDisbursedEmail(
    email: string,
    customerName: string,
    loanAmount: number,
    loanTermMonths: number,
    monthlyPayment: number,
    firstPaymentDate: Date
  ) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .success-icon { font-size: 48px; margin-bottom: 10px; }
          .amount-box { background: white; border-left: 4px solid #667eea; padding: 20px; margin: 20px 0; border-radius: 8px; }
          .amount { font-size: 32px; font-weight: bold; color: #667eea; }
          .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .highlight-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 8px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="success-icon">💰</div>
            <h1>¡Crédito Desembolsado!</h1>
            <p>Tu dinero ya está disponible</p>
          </div>
          <div class="content">
            <p>Estimado/a <strong>${customerName}</strong>,</p>
            <p>¡Excelentes noticias! Tu crédito ha sido <strong>DESEMBOLSADO</strong> exitosamente.</p>
            
            <div class="amount-box">
              <p style="margin: 0; color: #666; font-size: 14px;">Monto desembolsado</p>
              <div class="amount">S/ ${loanAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            
            <h3>Detalles del Crédito:</h3>
            <div class="info-row">
              <span>Monto total:</span>
              <strong>S/ ${loanAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div class="info-row">
              <span>Plazo:</span>
              <strong>${loanTermMonths} meses</strong>
            </div>
            <div class="info-row">
              <span>Cuota mensual:</span>
              <strong>S/ ${monthlyPayment.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div class="info-row">
              <span>Primera cuota:</span>
              <strong>${firstPaymentDate.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
            </div>
            
            <div class="highlight-box">
              <strong>⚠️ Importante:</strong> Recuerda realizar tus pagos puntualmente para mantener un buen historial crediticio.
            </div>
            
            <h3>¿Qué sigue?</h3>
            <ul>
              <li>Puedes ver tu cronograma completo de pagos en tu portal</li>
              <li>Recibirás recordatorios antes de cada fecha de pago</li>
              <li>Puedes realizar pagos anticipados sin penalización</li>
            </ul>
            
            <div style="text-align: center;">
              <a href="${process.env.PORTAL_URL || 'https://creditoexpress.com'}/my-loans" class="button">Ver Mi Cronograma</a>
            </div>
            
            <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
            
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
              <p>&copy; ${new Date().getFullYear()} CreditoExpress. Todos los derechos reservados.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
      ¡Crédito Desembolsado!
      Tu dinero ya está disponible
      
      Estimado/a ${customerName},
      
      ¡Excelentes noticias! Tu crédito ha sido DESEMBOLSADO exitosamente.
      
      Detalles del Crédito:
      - Monto total: S/ ${loanAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      - Plazo: ${loanTermMonths} meses
      - Cuota mensual: S/ ${monthlyPayment.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      - Primera cuota: ${firstPaymentDate.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}
      
      ⚠️ Importante: Recuerda realizar tus pagos puntualmente para mantener un buen historial crediticio.
      
      ¿Qué sigue?
      - Puedes ver tu cronograma completo de pagos en tu portal
      - Recibirás recordatorios antes de cada fecha de pago
      - Puedes realizar pagos anticipados sin penalización
      
      Si tienes alguna pregunta, no dudes en contactarnos.
    `;

    return this.sendEmail({
      to: email,
      toName: customerName,
      subject: '💰 ¡Tu crédito ha sido desembolsado! - CreditoExpress',
      htmlContent,
      textContent,
    });
  }

  async sendNewUserNotificationEmail(
    userEmail: string,
    userName: string,
    provider: 'google' | 'email'
  ) {
    const adminEmail = process.env.ADMIN_EMAIL || 'ph2309.t@gmail.com';
    const subject = `🔔 Nuevo usuario registrado - Requiere aprobación`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nuevo Usuario Registrado</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ff7b7b 0%, #667eea 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .user-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff7b7b; }
          .provider-badge { display: inline-block; background: #667eea; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; text-transform: uppercase; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
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
              <p><strong>📧 Email:</strong> ${userEmail}</p>
              <p><strong>👤 Nombre:</strong> ${userName || 'No especificado'}</p>
              <p><strong>🔐 Método de registro:</strong> <span class="provider-badge">${provider === 'google' ? 'Google' : 'Email'}</span></p>
              <p><strong>📅 Fecha de registro:</strong> ${new Date().toLocaleDateString('es-PE', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}</p>
            </div>

            <p><strong>⚠️ Acción requerida:</strong> El usuario está en estado "pendiente" y no puede acceder a la aplicación hasta que apruebes su registro.</p>

            <p>Para aprobar o rechazar este usuario, accede al panel de administración de la plataforma.</p>

            <div class="footer">
              <p>Este es un email automático del sistema de CREDITO-EXPRESS.</p>
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
- Email: ${userEmail}
- Nombre: ${userName || 'No especificado'}
- Método de registro: ${provider === 'google' ? 'Google' : 'Email'}
- Fecha: ${new Date().toLocaleDateString('es-PE')}

El usuario está en estado "pendiente" y requiere tu aprobación para acceder.

Accede al panel de administración para aprobar o rechazar este registro.

Sistema CREDITO-EXPRESS
    `;

    return this.sendEmail({
      to: adminEmail,
      subject,
      htmlContent,
      textContent,
    });
  }
}
