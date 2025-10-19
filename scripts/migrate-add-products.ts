import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
  }),
});

const db = getFirestore();

interface ProductAssignment {
  id: string;
  code: string;
  name: string;
  rateNominal: number;
  interestType: string;
  termMin: number;
  termMax: number;
  amountMin: number;
  amountMax: number;
}

// Lógica para asignar producto basado en monto y plazo
function assignProduct(loanAmount: number, loanTermMonths: number): ProductAssignment {
  // CRED_IND: 500-3000, 3-24 meses
  if (loanAmount <= 3000 && loanTermMonths >= 3 && loanTermMonths <= 24) {
    return {
      id: 'auto-assigned',
      code: 'CRED_IND',
      name: 'Crédito individual',
      rateNominal: 18.0,
      interestType: 'flat',
      termMin: 3,
      termMax: 24,
      amountMin: 500,
      amountMax: 3000,
    };
  }

  // CRED_GRUP: 1000-10000, 6-18 meses
  if (loanAmount > 3000 && loanAmount <= 10000 && loanTermMonths >= 6 && loanTermMonths <= 18) {
    return {
      id: 'auto-assigned',
      code: 'CRED_GRUP',
      name: 'Crédito grupal o solidario',
      rateNominal: 16.0,
      interestType: 'flat',
      termMin: 6,
      termMax: 18,
      amountMin: 1000,
      amountMax: 10000,
    };
  }

  // MICROEMP: 1000-8000, 6-24 meses
  if (loanAmount > 10000 || (loanAmount >= 1000 && loanTermMonths >= 6 && loanTermMonths <= 24)) {
    return {
      id: 'auto-assigned',
      code: 'MICROEMP',
      name: 'Crédito para microempresas',
      rateNominal: 15.0,
      interestType: 'efectivo',
      termMin: 6,
      termMax: 24,
      amountMin: 1000,
      amountMax: 8000,
    };
  }

  // MIC_PROD: Default para otros casos
  return {
    id: 'auto-assigned',
    code: 'MIC_PROD',
    name: 'Microcrédito productivo',
    rateNominal: 14.5,
    interestType: 'efectivo',
    termMin: 6,
    termMax: 36,
    amountMin: 500,
    amountMax: 5000,
  };
}

async function migrateAddProducts() {
  console.log('🔄 Iniciando migración de productos...\n');

  const microfinancieraId = 'mf_demo_001';

  try {
    // Obtener todas las solicitudes
    const applicationsRef = db
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('loanApplications');

    const snapshot = await applicationsRef.get();

    console.log(`📊 Total de solicitudes encontradas: ${snapshot.size}\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();

        // Verificar si ya tiene producto
        if (data.product) {
          console.log(`⏭️  Skipped: ${doc.id} - Ya tiene producto (${data.product.code})`);
          skippedCount++;
          continue;
        }

        // Obtener información financiera
        const financialInfo = data.financialInfo;
        if (!financialInfo || !financialInfo.loanAmount || !financialInfo.loanTermMonths) {
          console.log(`⚠️  Warning: ${doc.id} - Sin información financiera completa`);
          errorCount++;
          continue;
        }

        const loanAmount = financialInfo.loanAmount;
        const loanTermMonths = financialInfo.loanTermMonths;

        // Asignar producto
        const product = assignProduct(loanAmount, loanTermMonths);

        // Actualizar documento
        await doc.ref.update({
          product: product,
          updatedAt: new Date(),
        });

        console.log(`✅ Updated: ${doc.id}`);
        console.log(`   Monto: S/${loanAmount}, Plazo: ${loanTermMonths}m`);
        console.log(`   Producto asignado: ${product.name} (${product.code})`);
        console.log('');

        updatedCount++;
      } catch (error) {
        console.error(`❌ Error updating ${doc.id}:`, error);
        errorCount++;
      }
    }

    console.log('\n🎉 Migración completada!');
    console.log(`   Actualizadas: ${updatedCount}`);
    console.log(`   Omitidas (ya tenían producto): ${skippedCount}`);
    console.log(`   Errores: ${errorCount}`);
    console.log(`   Total: ${snapshot.size}`);
  } catch (error) {
    console.error('❌ Error en la migración:', error);
    process.exit(1);
  }

  process.exit(0);
}

migrateAddProducts();
