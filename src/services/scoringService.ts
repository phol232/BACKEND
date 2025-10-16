import { LoanApplication, ScoringResult } from "../types/loanApplication";
import { DEFAULT_SCORING_CONFIG, ScoringConfig } from "../types/scoring";
import { Timestamp } from "firebase-admin/firestore";
import { ReasonCode } from "../constants/reasonCodes";

export class ScoringService {
  private config: ScoringConfig;

  constructor(config: ScoringConfig = DEFAULT_SCORING_CONFIG) {
    this.config = config;
  }

  async calculateScore(application: LoanApplication): Promise<ScoringResult> {
    const startTime = Date.now();

    // Calcular scores individuales
    const incomeScore = this.calculateIncomeScore(application);
    const debtToIncomeScore = this.calculateDebtToIncomeScore(application);
    const employmentScore = this.calculateEmploymentScore(application);
    const employmentTypeScore = this.calculateEmploymentTypeScore(application);
    const creditHistoryScore = this.calculateCreditHistoryScore(application);

    // Calcular score ponderado
    const totalScore =
      incomeScore * this.config.weights.monthlyIncome +
      debtToIncomeScore * this.config.weights.debtToIncome +
      employmentScore * this.config.weights.employmentYears +
      employmentTypeScore * this.config.weights.employmentType +
      creditHistoryScore * this.config.weights.creditHistory;

    // Determinar banda
    const band = this.determineBand(totalScore);

    // Generar reason codes
    const reasonCodes = this.generateReasonCodes(
      application,
      { incomeScore, debtToIncomeScore, employmentScore, employmentTypeScore, creditHistoryScore }
    );

    const elapsedTime = Date.now() - startTime;
    console.log(`Scoring calculado en ${elapsedTime}ms`);

    const result = {
      score: Math.round(totalScore),
      band,
      reasonCodes,
      modelVersion: this.config.version,
      calculatedAt: Timestamp.now(),
      details: {
        incomeScore,
        debtToIncomeScore,
        employmentScore,
        employmentTypeScore,
        creditHistoryScore,
      },
    };

    console.log('Scoring calculated:', result);
    return result;
  }

  private calculateIncomeScore(application: LoanApplication): number {
    const { monthlyIncome, loanAmount } = application.financialInfo;
    const incomeToLoanRatio = monthlyIncome / loanAmount;

    if (incomeToLoanRatio >= 0.5) return 1000; // Ingreso muy alto
    if (incomeToLoanRatio >= 0.3) return 800; // Ingreso alto
    if (incomeToLoanRatio >= 0.2) return 600; // Ingreso adecuado
    if (incomeToLoanRatio >= 0.15) return 400; // Ingreso justo
    return 200; // Ingreso insuficiente
  }

  private calculateDebtToIncomeScore(application: LoanApplication): number {
    const { monthlyIncome, currentDebts } = application.financialInfo;
    const monthlyPayment = this.calculateMonthlyPayment(
      application.financialInfo.loanAmount,
      application.financialInfo.loanTermMonths
    );
    const totalDebt = (currentDebts || 0) + monthlyPayment;
    const debtRatio = totalDebt / monthlyIncome;

    if (debtRatio <= 0.20) return 1000; // Deuda muy baja
    if (debtRatio <= 0.30) return 800; // Deuda baja
    if (debtRatio <= 0.40) return 600; // Deuda moderada
    if (debtRatio <= 0.50) return 400; // Deuda alta
    return 200; // Deuda muy alta
  }

  private calculateEmploymentScore(application: LoanApplication): number {
    const { yearsEmployed, monthsEmployed } = application.employmentInfo;
    const totalMonths = (yearsEmployed || 0) * 12 + (monthsEmployed || 0);

    if (totalMonths >= 60) return 1000; // 5+ años
    if (totalMonths >= 36) return 800; // 3-5 años
    if (totalMonths >= 24) return 600; // 2-3 años
    if (totalMonths >= 12) return 400; // 1-2 años
    return 200; // Menos de 1 año
  }

  private calculateEmploymentTypeScore(application: LoanApplication): number {
    const { employmentType, contractType } = application.employmentInfo;

    if (employmentType === "empleado" && contractType === "indefinido") {
      return 1000; // Empleo formal indefinido
    }
    if (employmentType === "empleado") {
      return 800; // Empleo formal temporal
    }
    if (employmentType === "empresario") {
      return 700; // Empresario
    }
    if (employmentType === "independiente") {
      return 500; // Independiente
    }
    if (employmentType === "jubilado") {
      return 600; // Jubilado (ingreso estable)
    }
    return 300; // Otros
  }

  private calculateCreditHistoryScore(application: LoanApplication): number {
    const { hasCreditHistory, hasBankAccount } = application.additionalInfo;

    if (hasCreditHistory && hasBankAccount) {
      return 1000; // Historial positivo y bancarizado
    }
    if (hasCreditHistory) {
      return 700; // Historial positivo
    }
    if (hasBankAccount) {
      return 500; // Bancarizado sin historial
    }
    return 300; // Sin historial ni bancarización
  }

  private determineBand(score: number): "A" | "B" | "C" | "D" {
    if (score >= this.config.bands.A.min) return "A";
    if (score >= this.config.bands.B.min) return "B";
    if (score >= this.config.bands.C.min) return "C";
    return "D";
  }

  private generateReasonCodes(
    application: LoanApplication,
    scores: {
      incomeScore: number;
      debtToIncomeScore: number;
      employmentScore: number;
      employmentTypeScore: number;
      creditHistoryScore: number;
    }
  ): ReasonCode[] {
    const codes: ReasonCode[] = [];

    // Códigos basados en ingreso
    if (scores.incomeScore >= 800) codes.push("RC01");
    else if (scores.incomeScore >= 600) codes.push("RC06");
    else codes.push("RC11");

    // Códigos basados en deuda
    if (scores.debtToIncomeScore >= 800) codes.push("RC02");
    else if (scores.debtToIncomeScore >= 600) codes.push("RC07");
    else codes.push("RC12");

    // Códigos basados en empleo
    if (scores.employmentScore >= 800) codes.push("RC03");
    else if (scores.employmentScore >= 600) codes.push("RC08");
    else codes.push("RC13");

    // Códigos basados en tipo de empleo
    if (scores.employmentTypeScore >= 800) codes.push("RC04");
    else if (scores.employmentTypeScore >= 600) codes.push("RC09");
    else codes.push("RC14");

    // Códigos basados en historial
    if (scores.creditHistoryScore >= 700) codes.push("RC05");
    else if (scores.creditHistoryScore >= 500) codes.push("RC10");
    else codes.push("RC15");

    // Retornar los 3 códigos más relevantes
    return codes.slice(0, 3);
  }

  private calculateMonthlyPayment(amount: number, termMonths: number): number {
    const monthlyRate = 0.02; // 24% anual = 2% mensual
    return (
      (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1)
    );
  }
}

