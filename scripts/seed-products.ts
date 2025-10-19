import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
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

const defaultProducts = [
  {
    mfId: 'mf_demo_001',
    code: 'CRED_IND',
    name: 'Crédito individual',
    interestType: 'flat',
    rateNominal: 18.0,
    termMin: 3,
    termMax: 24,
    amountMin: 500.0,
    amountMax: 3000.0,
    fees: { apertura: 10.0, mantenimiento: 5.0 },
    penalties: { moraDiaria: 0.05 },
  },
  {
    mfId: 'mf_demo_001',
    code: 'CRED_GRUP',
    name: 'Crédito grupal o solidario',
    interestType: 'flat',
    rateNominal: 16.0,
    termMin: 6,
    termMax: 18,
    amountMin: 1000.0,
    amountMax: 10000.0,
    fees: { apertura: 20.0, seguros: 10.0 },
    penalties: { moraDiaria: 0.04 },
  },
  {
    mfId: 'mf_demo_001',
    code: 'MIC_PROD',
    name: 'Microcrédito productivo',
    interestType: 'efectivo',
    rateNominal: 14.5,
    termMin: 6,
    termMax: 36,
    amountMin: 500.0,
    amountMax: 5000.0,
    fees: { apertura: 15.0, evaluacion: 8.0 },
    penalties: { moraDiaria: 0.03 },
  },
  {
    mfId: 'mf_demo_001',
    code: 'CRED_RESP',
    name: 'Crédito de consumo responsable',
    interestType: 'flat',
    rateNominal: 12.0,
    termMin: 3,
    termMax: 12,
    amountMin: 500.0,
    amountMax: 2500.0,
    fees: { apertura: 8.0 },
    penalties: { moraDiaria: 0.05 },
  },
  {
    mfId: 'mf_demo_001',
    code: 'MICROEMP',
    name: 'Crédito para microempresas',
    interestType: 'efectivo',
    rateNominal: 15.0,
    termMin: 6,
    termMax: 24,
    amountMin: 1000.0,
    amountMax: 8000.0,
    fees: { evaluacion: 10.0, seguros: 15.0 },
    penalties: { moraDiaria: 0.04 },
  },
  {
    mfId: 'mf_demo_001',
    code: 'CRED_VERDE',
    name: 'Crédito verde o sostenible',
    interestType: 'efectivo',
    rateNominal: 10.5,
    termMin: 6,
    termMax: 24,
    amountMin: 800.0,
    amountMax: 3000.0,
    fees: { evaluacion: 12.0 },
    penalties: { moraDiaria: 0.02 },
  },
];

async function seedProducts() {
  console.log('🌱 Seeding products...\n');

  const microfinancieraId = 'mf_demo_001';

  try {
    let createdCount = 0;
    let skippedCount = 0;

    for (const product of defaultProducts) {
      const productRef = db
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('products')
        .doc();

      // Check if product with same code already exists
      const existingProducts = await db
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('products')
        .where('code', '==', product.code)
        .get();

      if (!existingProducts.empty) {
        console.log(`⏭️  Skipped: ${product.name} (${product.code}) - already exists`);
        skippedCount++;
        continue;
      }

      const productData = {
        ...product,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      await productRef.set(productData);

      console.log(`✅ Created: ${product.name} (${product.code})`);
      console.log(`   ID: ${productRef.id}`);
      console.log(`   Tasa: ${product.rateNominal}% ${product.interestType}`);
      console.log(`   Monto: S/${product.amountMin} - S/${product.amountMax}`);
      console.log(`   Plazo: ${product.termMin} - ${product.termMax} meses`);
      console.log('');

      createdCount++;
    }

    console.log('\n🎉 Products seeded successfully!');
    console.log(`   Created: ${createdCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Total: ${defaultProducts.length}`);
    console.log(`\n   Microfinanciera ID: ${microfinancieraId}`);
  } catch (error) {
    console.error('❌ Error seeding products:', error);
    process.exit(1);
  }

  process.exit(0);
}

seedProducts();
