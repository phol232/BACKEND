import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || process.env.client_email!,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || process.env.private_key)?.replace(/\\n/g, '\n')!,
  },
  
  brevo: {
    apiKey: process.env.BREVO_API_KEY!,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
  },

  llm: {
    endpoint: process.env.API_LLM_URL || '',
    apiKey: process.env.API_LLM_KEY || '',
    agentId: process.env.API_LLM_ID || '',
  },
  
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
};

// Validate required env vars (solo en producción)
if (process.env.NODE_ENV === 'production') {
  const requiredEnvVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
} else {
  // En desarrollo, solo advertir
  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.warn('⚠️  Firebase Admin credentials not configured');
    console.warn('⚠️  Some features will not work until you add them to .env');
    console.warn('⚠️  See: OBTENER_CREDENCIALES_FIREBASE.md');
  }
}
