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

async function seedTestData() {
  console.log('🌱 Seeding test data...\n');

  const microfinancieraId = 'mf001';
  const applicationId = 'test-app-001';

  try {
    // Create test application
    const testApplication = {
      // Basic Info
      applicationId,
      microfinancieraId,
      status: 'intake',
      createdAt: new Date(),
      updatedAt: new Date(),

      // Customer Info
      customerName: 'Juan Pérez García',
      dni: '12345678',
      email: 'juan.perez@example.com',
      phone: '+51987654321',
      dateOfBirth: new Date('1985-05-15'),
      address: 'Av. Principal 123, Lima',

      // Loan Info
      loanAmount: 5000,
      loanPurpose: 'Capital de trabajo',
      requestedTerm: 12, // months
      monthlyIncome: 3000,
      monthlyExpenses: 1500,

      // Employment Info
      employmentStatus: 'employed',
      employerName: 'Empresa ABC SAC',
      yearsAtJob: 3,
      occupation: 'Vendedor',

      // Credit History (simulado)
      hasActiveLoan: false,
      previousLoans: 2,
      paymentHistory: 'good', // good, fair, poor
      creditScore: 650,

      // Business Info (si aplica)
      hasOwnBusiness: true,
      businessName: 'Bodega Don Juan',
      businessAge: 5, // years
      monthlyBusinessIncome: 4000,

      // References
      references: [
        {
          name: 'María López',
          relationship: 'Hermana',
          phone: '+51987654322',
        },
        {
          name: 'Carlos Rodríguez',
          relationship: 'Amigo',
          phone: '+51987654323',
        },
      ],

      // Documents
      documents: {
        dni: true,
        proofOfIncome: true,
        proofOfAddress: true,
        businessLicense: true,
      },

      // Metadata
      source: 'mobile_app',
      agentId: 'agent-001',
      branchId: 'branch-001',
    };

    // Save to Firestore
    await db
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('loanApplications')
      .doc(applicationId)
      .set(testApplication);

    console.log('✅ Test application created:');
    console.log(`   Microfinanciera: ${microfinancieraId}`);
    console.log(`   Application ID: ${applicationId}`);
    console.log(`   Customer: ${testApplication.customerName}`);
    console.log(`   Loan Amount: S/ ${testApplication.loanAmount}`);
    console.log('\n');

    // Create a few more test applications
    const additionalApps = [
      {
        applicationId: 'test-app-002',
        customerName: 'María González',
        dni: '87654321',
        loanAmount: 3000,
        monthlyIncome: 2500,
        creditScore: 700,
      },
      {
        applicationId: 'test-app-003',
        customerName: 'Pedro Sánchez',
        dni: '11223344',
        loanAmount: 10000,
        monthlyIncome: 5000,
        creditScore: 600,
      },
    ];

    for (const app of additionalApps) {
      await db
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('loanApplications')
        .doc(app.applicationId)
        .set({
          ...testApplication,
          ...app,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      console.log(`✅ Created: ${app.customerName} (${app.applicationId})`);
    }

    console.log('\n🎉 Test data seeded successfully!');
    console.log('\nYou can now test with:');
    console.log(`   microfinancieraId: ${microfinancieraId}`);
    console.log(`   applicationId: ${applicationId} (or test-app-002, test-app-003)`);
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }

  process.exit(0);
}

seedTestData();
