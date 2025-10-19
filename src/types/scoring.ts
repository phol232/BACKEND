export interface ScoringWeights {
  monthlyIncome: number;
  debtToIncome: number;
  employmentYears: number;
  employmentType: number;
  creditHistory: number;
}

export interface ScoringBands {
  A: { min: number; max: number; autoApprove: boolean };
  B: { min: number; max: number; autoApprove: boolean };
  C: { min: number; max: number; autoApprove: boolean };
  D: { min: number; max: number; autoApprove: boolean };
}

export interface ScoringConfig {
  version: string;
  weights: ScoringWeights;
  bands: ScoringBands;
  minLoanAmount: number;
  maxLoanAmount: number;
  minTermMonths: number;
  maxTermMonths: number;
  minAge: number;
  maxDebtToIncomeRatio: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: "1.0",
  weights: {
    monthlyIncome: 0.30,
    debtToIncome: 0.25,
    employmentYears: 0.20,
    employmentType: 0.15,
    creditHistory: 0.10,
  },
  bands: {
    A: { min: 800, max: 1000, autoApprove: true },
    B: { min: 600, max: 799, autoApprove: true },
    C: { min: 400, max: 599, autoApprove: false },
    D: { min: 0, max: 399, autoApprove: false },
  },
  minLoanAmount: 1000,
  maxLoanAmount: 50000,
  minTermMonths: 6,
  maxTermMonths: 36,
  minAge: 18,
  maxDebtToIncomeRatio: 0.50, 
};

