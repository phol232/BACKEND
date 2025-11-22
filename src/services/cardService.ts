import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { Card, CardStatus, CardTransition, CardMetrics } from '../types/card';
import { AuditService } from './auditService';
import { EmailService } from './emailService';

export class CardService {
  private auditService = new AuditService();
  private emailService = new EmailService();

  private validTransitions: Record<CardStatus, CardStatus[]> = {
    pending: ['active', 'rejected'],
    requested: ['active', 'rejected'],
    active: ['suspended', 'closed'],
    suspended: ['active', 'closed'],
    closed: [],
    rejected: ['active', 'closed'],
  };

  isValidTransition(from: CardStatus, to: CardStatus): boolean {
    return this.validTransitions[from]?.includes(to) || false;
  }

  async getCards(
    microfinancieraId: string,
    filters?: {
      status?: CardStatus;
      cardType?: 'debit' | 'credit' | 'prepaid';
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<Card[]> {
    let query = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards');

    if (filters?.status) {
      query = query.where('status', '==', filters.status) as any;
    }
    if (filters?.cardType) {
      query = query.where('cardType', '==', filters.cardType) as any;
    }
    if (filters?.startDate) {
      query = query.where('createdAt', '>=', Timestamp.fromDate(filters.startDate)) as any;
    }
    if (filters?.endDate) {
      query = query.where('createdAt', '<=', Timestamp.fromDate(filters.endDate)) as any;
    }

    const snapshot = await query.get();
    let cards = snapshot.docs.map((doc) => {
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
    }) as Card[];

    // Enriquecer con información de la cuenta asociada
    const enrichedCards = await Promise.all(
      cards.map(async (card) => {
        try {
          if (card.accountId) {
            // Obtener la cuenta asociada
            const accountDoc = await db()
              .collection('microfinancieras')
              .doc(microfinancieraId)
              .collection('accounts')
              .doc(card.accountId)
              .get();

            if (accountDoc.exists) {
              const accountData = accountDoc.data();
              return {
                ...card,
                name: card.name || accountData?.displayName || 
                      (accountData?.holderFirstName && accountData?.holderLastName 
                        ? `${accountData.holderFirstName} ${accountData.holderLastName}`.trim()
                        : accountData?.holderFirstName || accountData?.holderLastName),
                holderFirstName: card.holderFirstName || accountData?.holderFirstName,
                holderLastName: card.holderLastName || accountData?.holderLastName,
                holderDni: card.holderDni || accountData?.holderDni || accountData?.docNumber || accountData?.dni,
                email: card.email || accountData?.email || accountData?.holderEmail,
                phone: card.phone || accountData?.phone || accountData?.holderPhone,
                displayName: card.displayName || accountData?.displayName,
              };
            }
          }
        } catch (error) {
          console.error(`Error enriqueciendo tarjeta ${card.id}:`, error);
        }
        return card;
      })
    );

    // Ordenar en memoria por createdAt si existe
    enrichedCards.sort((a, b) => {
      const aDate = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
      const bDate = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
      return bDate - aDate; // Descendente
    });

    return enrichedCards;
  }

  async getCard(microfinancieraId: string, cardId: string): Promise<Card | null> {
    const doc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId)
      .get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as Card;
  }

  async getCardHistory(microfinancieraId: string, cardId: string): Promise<CardTransition[]> {
    const snapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId)
      .collection('transitions')
      .orderBy('timestamp', 'desc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as CardTransition);
  }

  async approveCard(
    microfinancieraId: string,
    cardId: string,
    userId: string,
    ipAddress?: string
  ): Promise<void> {
    const cardRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId);

    const cardDoc = await cardRef.get();
    if (!cardDoc.exists) {
      throw new Error('Tarjeta no encontrada');
    }

    const card = cardDoc.data() as Card;
    if (!this.isValidTransition(card.status as CardStatus, 'active')) {
      throw new Error(`No se puede aprobar una tarjeta con estado: ${card.status}`);
    }

    const transition: CardTransition = {
      from: card.status as CardStatus,
      to: 'active',
      timestamp: Timestamp.now(),
      userId,
      ipAddress,
    };

    await cardRef.update({
      status: 'active',
      isActive: true,
      approvedAt: Timestamp.now(),
      approvedBy: userId,
      updatedAt: Timestamp.now(),
    });

    await cardRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'CARD_APPROVED',
      'card',
      cardId,
      { status: card.status },
      { status: 'active' },
      cardId,
      { ipAddress }
    );

    // Obtener información del cliente para el email
    const accountDoc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(card.accountId)
      .get();

    if (accountDoc.exists) {
      const account = accountDoc.data();
      try {
        await this.emailService.sendEmail({
          to: account?.email || '',
          toName: account?.displayName || account?.email || '',
          subject: '✅ Tu tarjeta ha sido aprobada - Microfinanciera',
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
                  <h1>✅ Tarjeta Aprobada</h1>
                </div>
                <div class="content">
                  <p>Estimado/a <strong>${account?.displayName || account?.email || ''}</strong>,</p>
                  <p>Tu tarjeta ha sido aprobada exitosamente. Ya puedes utilizarla para realizar transacciones.</p>
                  <p><strong>Tipo de tarjeta:</strong> ${card.cardType}</p>
                </div>
              </div>
            </body>
            </html>
          `,
          textContent: `Tu tarjeta ha sido aprobada exitosamente. Ya puedes utilizarla para realizar transacciones.`,
        });
      } catch (error) {
        console.error('Error enviando email de aprobación:', error);
      }
    }
  }

  async rejectCard(
    microfinancieraId: string,
    cardId: string,
    userId: string,
    reason: string,
    evidence?: string,
    ipAddress?: string
  ): Promise<void> {
    const cardRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId);

    const cardDoc = await cardRef.get();
    if (!cardDoc.exists) {
      throw new Error('Tarjeta no encontrada');
    }

    const card = cardDoc.data() as Card;
    if (card.status !== 'pending') {
      throw new Error(`No se puede rechazar una tarjeta con estado: ${card.status}`);
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('El motivo del rechazo es obligatorio');
    }

    const transition: CardTransition = {
      from: card.status,
      to: 'rejected',
      timestamp: Timestamp.now(),
      userId,
      reason,
      evidence,
      ipAddress,
    };

    await cardRef.update({
      status: 'rejected',
      rejectedAt: Timestamp.now(),
      rejectedBy: userId,
      rejectionReason: reason,
      updatedAt: Timestamp.now(),
    });

    await cardRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'CARD_REJECTED',
      'card',
      cardId,
      { status: card.status },
      { status: 'rejected', reason, evidence },
      cardId,
      { ipAddress }
    );

    // Enviar email de notificación
    const accountDoc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(card.accountId)
      .get();

    if (accountDoc.exists) {
      const account = accountDoc.data();
      try {
        await this.emailService.sendEmail({
          to: account?.email || '',
          toName: account?.displayName || account?.email || '',
          subject: 'Tarjeta rechazada - Microfinanciera',
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
                  <h1>Tarjeta Rechazada</h1>
                </div>
                <div class="content">
                  <p>Estimado/a <strong>${account?.displayName || account?.email || ''}</strong>,</p>
                  <p>Lamentamos informarte que tu solicitud de tarjeta ha sido rechazada.</p>
                  <p><strong>Motivo:</strong> ${reason}</p>
                </div>
              </div>
            </body>
            </html>
          `,
          textContent: `Tu solicitud de tarjeta ha sido rechazada. Motivo: ${reason}`,
        });
      } catch (error) {
        console.error('Error enviando email de rechazo:', error);
      }
    }
  }

  async suspendCard(
    microfinancieraId: string,
    cardId: string,
    userId: string,
    reason: string,
    evidence?: string,
    ipAddress?: string
  ): Promise<void> {
    const cardRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId);

    const cardDoc = await cardRef.get();
    if (!cardDoc.exists) {
      throw new Error('Tarjeta no encontrada');
    }

    const card = cardDoc.data() as Card;
    if (card.status !== 'active') {
      throw new Error(`Solo se pueden suspender tarjetas activas. Estado actual: ${card.status}`);
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('El motivo de la suspensión es obligatorio');
    }

    const transition: CardTransition = {
      from: card.status,
      to: 'suspended',
      timestamp: Timestamp.now(),
      userId,
      reason,
      evidence,
      ipAddress,
    };

    await cardRef.update({
      status: 'suspended',
      isActive: false,
      suspendedAt: Timestamp.now(),
      suspendedReason: reason,
      suspendedBy: userId,
      updatedAt: Timestamp.now(),
    });

    await cardRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'CARD_SUSPENDED',
      'card',
      cardId,
      { status: card.status },
      { status: 'suspended', reason, evidence },
      cardId,
      { ipAddress }
    );

    // Enviar email de notificación
    const accountDoc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(card.accountId)
      .get();

    if (accountDoc.exists) {
      const account = accountDoc.data();
      try {
        await this.emailService.sendEmail({
          to: account?.email || '',
          toName: account?.displayName || account?.email || '',
          subject: '⚠️ Tu tarjeta ha sido suspendida - Microfinanciera',
          htmlContent: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>⚠️ Tarjeta Suspendida</h1>
                </div>
                <div class="content">
                  <p>Estimado/a <strong>${account?.displayName || account?.email || ''}</strong>,</p>
                  <p>Tu tarjeta ha sido suspendida temporalmente.</p>
                  <p><strong>Motivo:</strong> ${reason}</p>
                  <p>Por favor, contacta con nosotros para más información.</p>
                </div>
              </div>
            </body>
            </html>
          `,
          textContent: `Tu tarjeta ha sido suspendida. Motivo: ${reason}`,
        });
      } catch (error) {
        console.error('Error enviando email de suspensión:', error);
      }
    }
  }

  async reactivateCard(
    microfinancieraId: string,
    cardId: string,
    userId: string,
    ipAddress?: string
  ): Promise<void> {
    const cardRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId);

    const cardDoc = await cardRef.get();
    if (!cardDoc.exists) {
      throw new Error('Tarjeta no encontrada');
    }

    const card = cardDoc.data() as Card;
    if (card.status !== 'suspended') {
      throw new Error(`Solo se pueden reactivar tarjetas suspendidas. Estado actual: ${card.status}`);
    }

    const transition: CardTransition = {
      from: card.status,
      to: 'active',
      timestamp: Timestamp.now(),
      userId,
      ipAddress,
    };

    await cardRef.update({
      status: 'active',
      isActive: true,
      suspendedAt: null,
      suspendedReason: null,
      suspendedBy: null,
      updatedAt: Timestamp.now(),
    });

    await cardRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'CARD_REACTIVATED',
      'card',
      cardId,
      { status: card.status },
      { status: 'active' },
      cardId,
      { ipAddress }
    );

    // Enviar email de notificación
    const accountDoc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(card.accountId)
      .get();

    if (accountDoc.exists) {
      const account = accountDoc.data();
      try {
        await this.emailService.sendEmail({
          to: account?.email || '',
          toName: account?.displayName || account?.email || '',
          subject: '✅ Tu tarjeta ha sido reactivada - Microfinanciera',
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
                  <h1>✅ Tarjeta Reactivada</h1>
                </div>
                <div class="content">
                  <p>Estimado/a <strong>${account?.displayName || account?.email || ''}</strong>,</p>
                  <p>Tu tarjeta ha sido reactivada exitosamente. Ya puedes utilizarla nuevamente.</p>
                </div>
              </div>
            </body>
            </html>
          `,
          textContent: `Tu tarjeta ha sido reactivada exitosamente. Ya puedes utilizarla nuevamente.`,
        });
      } catch (error) {
        console.error('Error enviando email de reactivación:', error);
      }
    }
  }

  async closeCard(
    microfinancieraId: string,
    cardId: string,
    userId: string,
    reason: string,
    evidence?: string,
    ipAddress?: string
  ): Promise<void> {
    const cardRef = db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .doc(cardId);

    const cardDoc = await cardRef.get();
    if (!cardDoc.exists) {
      throw new Error('Tarjeta no encontrada');
    }

    const card = cardDoc.data() as Card;
    if (card.status === 'closed') {
      throw new Error('La tarjeta ya está cerrada');
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('El motivo del cierre es obligatorio');
    }

    const transition: CardTransition = {
      from: card.status,
      to: 'closed',
      timestamp: Timestamp.now(),
      userId,
      reason,
      evidence,
      ipAddress,
    };

    await cardRef.update({
      status: 'closed',
      closedAt: Timestamp.now(),
      closedReason: reason,
      closedBy: userId,
      updatedAt: Timestamp.now(),
    });

    await cardRef.collection('transitions').add(transition);

    await this.auditService.log(
      userId,
      'CARD_CLOSED',
      'card',
      cardId,
      { status: card.status },
      { status: 'closed', reason, evidence },
      cardId,
      { ipAddress }
    );

    // Enviar email de notificación
    const accountDoc = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .doc(card.accountId)
      .get();

    if (accountDoc.exists) {
      const account = accountDoc.data();
      try {
        await this.emailService.sendEmail({
          to: account?.email || '',
          toName: account?.displayName || account?.email || '',
          subject: 'Tarjeta cerrada - Microfinanciera',
          htmlContent: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Tarjeta Cerrada</h1>
                </div>
                <div class="content">
                  <p>Estimado/a <strong>${account?.displayName || account?.email || ''}</strong>,</p>
                  <p>Tu tarjeta ha sido cerrada.</p>
                  <p><strong>Motivo:</strong> ${reason}</p>
                </div>
              </div>
            </body>
            </html>
          `,
          textContent: `Tu tarjeta ha sido cerrada. Motivo: ${reason}`,
        });
      } catch (error) {
        console.error('Error enviando email de cierre:', error);
      }
    }
  }

  async getActiveCardsMetrics(microfinancieraId: string): Promise<CardMetrics> {
    const cardsSnapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('cards')
      .get();

    const cards = cardsSnapshot.docs.map((doc) => doc.data() as Card);

    return {
      totalCards: cards.length,
      activeCards: cards.filter((c) => c.status === 'active').length,
      suspendedCards: cards.filter((c) => c.status === 'suspended').length,
      closedCards: cards.filter((c) => c.status === 'closed').length,
      pendingCards: cards.filter((c) => c.status === 'pending').length,
      usageAttempts: 0, // TODO: Implementar cuando haya sistema de transacciones
      successfulTransactions: 0, // TODO: Implementar cuando haya sistema de transacciones
      failedTransactions: 0, // TODO: Implementar cuando haya sistema de transacciones
    };
  }
}
