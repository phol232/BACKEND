import * as admin from 'firebase-admin';

// Inicializar Firebase Admin con credenciales por defecto
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function createTestNotifications() {
  const userId = 'BxJTiyvjMhhx3ZjxvEAXPivhNdm2';
  
  try {
    console.log('🔍 Verificando notificaciones existentes...');
    
    // Verificar notificaciones existentes
    const notificationsSnapshot = await db
      .collection('notifications')
      .where('userId', '==', userId)
      .limit(5)
      .get();
    
    console.log(`📊 Notificaciones encontradas: ${notificationsSnapshot.size}`);
    
    // Crear notificaciones de prueba
    console.log('📝 Creando notificaciones de prueba...');
    
    const testNotifications = [
      {
        title: 'Bienvenido a la aplicación',
        message: 'Tu cuenta ha sido activada correctamente',
        type: 'accountActivated',
        priority: 'normal',
        createdAt: admin.firestore.Timestamp.now(),
        isRead: false,
        userId: userId,
        data: { source: 'test' }
      },
      {
        title: 'Tarjeta activada',
        message: 'Tu tarjeta de débito está lista para usar',
        type: 'cardActivated',
        priority: 'high',
        createdAt: admin.firestore.Timestamp.now(),
        isRead: false,
        userId: userId,
        data: { source: 'test' }
      },
      {
        title: 'Recordatorio de pago',
        message: 'Tienes un pago pendiente que vence mañana',
        type: 'paymentReminder',
        priority: 'urgent',
        createdAt: admin.firestore.Timestamp.now(),
        isRead: false,
        userId: userId,
        data: { source: 'test' }
      }
    ];
    
    // Crear las notificaciones una por una
    for (let i = 0; i < testNotifications.length; i++) {
      const notification = testNotifications[i];
      const docId = `test_${Date.now()}_${i + 1}`;
      
      await db.collection('notifications').doc(docId).set(notification);
      console.log(`✅ Notificación ${i + 1} creada: ${notification.title}`);
    }
    
    // Verificar que se crearon
    const newSnapshot = await db
      .collection('notifications')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    
    console.log(`📊 Total de notificaciones después de crear: ${newSnapshot.size}`);
    
    console.log('📋 Últimas notificaciones:');
    newSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${data.title}: ${data.message}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createTestNotifications().then(() => {
  console.log('🏁 Proceso completado');
  process.exit(0);
}).catch(error => {
  console.error('💥 Error fatal:', error);
  process.exit(1);
});