import { Timestamp } from "firebase-admin/firestore";

export interface LoanApplicationDocument {
  id: string;
  name: string;
  url: string;
  type: "dni_front" | "dni_back" | "income_proof" | "address_proof" | "other";
  uploadedAt: Timestamp;
  size: number;
}

export interface RoutingInfo {
  branchId: string;
  agentId: string | null;
  assignedAt: Timestamp | null;
  district: string;
}

export interface ScoringResult {
  score: number;
  band: "A" | "B" | "C" | "D";
  reasonCodes: string[];
  modelVersion: string;
  calculatedAt: Timestamp;
  details: {
    incomeScore: number;
    debtToIncomeScore: number;
    employmentScore: number;
    employmentTypeScore: number;
    creditHistoryScore: number;
  };
}

export interface DecisionInfo {
  result: "approved" | "rejected" | "observed" | "pending";
  decidedBy: string | null;
  decidedAt: Timestamp | null;
  comments: string;
  isAutomatic: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StateTransition {
  from: ApplicationStatus;
  to: ApplicationStatus;
  timestamp: Timestamp;
  userId: string;
  reason?: string;
}

export type ApplicationStatus =
  | "pending"
  | "received"
  | "routed"
  | "in_review"
  | "decision"
  | "approved"
  | "rejected"
  | "observed"
  | "disbursed";

export interface LoanApplication {
  id: string;
  userId: string;
  microfinancieraId: string;

  // Información Personal
  personalInfo: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
    birthDate: string;
    nationality: string;
    maritalStatus: string;
    dependents?: number;
  };

  // Información de Contacto
  contactInfo: {
    address: string;
    district: string;
    province: string;
    department: string;
    mobilePhone: string;
    email: string;
    homeReference?: string;
  };

  // Información Laboral
  employmentInfo: {
    employmentType: string;
    employerName?: string;
    position?: string;
    yearsEmployed?: number;
    monthsEmployed?: number;
    contractType?: string;
    workPhone?: string;
  };

  // Información Financiera
  financialInfo: {
    monthlyIncome: number;
    otherIncome?: number;
    otherIncomeSource?: string;
    monthlyExpenses?: number;
    currentDebts?: number;
    currentDebtsEntity?: string;
    loanAmount: number;
    loanTermMonths: number;
    loanPurpose: string;
  };

  // Información Adicional
  additionalInfo: {
    hasCreditHistory: boolean;
    hasBankAccount: boolean;
    bankName?: string;
    hasGuarantee: boolean;
    guaranteeDescription?: string;
    additionalComments?: string;
  };

  // Consentimientos
  consents: {
    acceptTerms: boolean;
    authorizeCreditCheck: boolean;
    confirmTruthfulness: boolean;
  };

  // Geolocalización
  location?: {
    latitude: number;
    longitude: number;
    timestamp: Timestamp;
  };

  // Estado y Workflow
  status: ApplicationStatus;
  routing?: RoutingInfo;
  scoring?: ScoringResult;
  decision?: DecisionInfo;
  validations?: ValidationResult;
  documents?: LoanApplicationDocument[];

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

