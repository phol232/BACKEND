import { LoanApplication, ValidationResult } from "../types/loanApplication";
import { DEFAULT_SCORING_CONFIG } from "../types/scoring";

export class ValidationService {
  validate(application: LoanApplication): ValidationResult {
    const errors: string[] = []; // Solo errores críticos (campos requeridos)
    const warnings: string[] = []; // Advertencias que no bloquean el scoring

    const { loanAmount, loanTermMonths, monthlyIncome } = application.financialInfo;

    // Validar relación cuota/ingreso (WARNING, no error)
    const monthlyPayment = this.calculateMonthlyPayment(loanAmount, loanTermMonths);
    const paymentToIncomeRatio = monthlyPayment / monthlyIncome;

    if (paymentToIncomeRatio > DEFAULT_SCORING_CONFIG.maxDebtToIncomeRatio) {
      warnings.push(
        `⚠️ ALTO RIESGO: La cuota mensual ($${monthlyPayment.toFixed(2)}) excede el ` +
        `${(DEFAULT_SCORING_CONFIG.maxDebtToIncomeRatio * 100).toFixed(0)}% ` +
        `del ingreso mensual ($${monthlyIncome.toFixed(2)})`
      );
    } else if (paymentToIncomeRatio > 0.35) {
      warnings.push("La cuota mensual representa más del 35% del ingreso");
    }

    // Validar deudas actuales (WARNING)
    const currentDebts = application.financialInfo.currentDebts || 0;
    const totalDebtRatio = (currentDebts + monthlyPayment) / monthlyIncome;
    if (totalDebtRatio > 0.50) {
      warnings.push("⚠️ La deuda total (actual + nueva) excede el 50% del ingreso");
    }

    // Validar edad (WARNING)
    const age = this.calculateAge(application.personalInfo.birthDate);
    if (age < DEFAULT_SCORING_CONFIG.minAge) {
      warnings.push(`El cliente (${age} años) es menor a la edad mínima (${DEFAULT_SCORING_CONFIG.minAge})`);
    }

    // Validar campos requeridos (ERRORS - estos sí bloquean)
    if (!application.personalInfo.documentNumber) {
      errors.push("Número de documento es requerido");
    }
    if (!application.contactInfo.email) {
      errors.push("Email es requerido");
    }
    if (!application.contactInfo.mobilePhone) {
      errors.push("Teléfono móvil es requerido");
    }
    if (!application.employmentInfo.employmentType) {
      errors.push("Tipo de empleo es requerido");
    }

    // Validar consentimientos (ERRORS)
    if (!application.consents.acceptTerms) {
      errors.push("Debe aceptar los términos y condiciones");
    }
    if (!application.consents.authorizeCreditCheck) {
      errors.push("Debe autorizar la consulta en centrales de riesgo");
    }
    if (!application.consents.confirmTruthfulness) {
      errors.push("Debe confirmar la veracidad de la información");
    }

    return {
      isValid: errors.length === 0, // Solo falla si faltan campos requeridos
      errors,
      warnings,
    };
  }

  private calculateAge(birthDate: string): number {
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  private calculateMonthlyPayment(amount: number, termMonths: number): number {
    const monthlyRate = 0.02; // 24% anual = 2% mensual
    const payment =
      (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1);
    return payment;
  }

  async isDniUnique(
    microfinancieraId: string,
    dni: string,
    excludeApplicationId?: string
  ): Promise<boolean> {
    const { getFirestore } = await import("firebase-admin/firestore");
    const db = getFirestore();

    let query = db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .where("personalInfo.documentNumber", "==", dni);

    const snapshot = await query.get();

    if (excludeApplicationId) {
      return snapshot.docs.every((doc) => doc.id === excludeApplicationId);
    }

    return snapshot.empty;
  }
}
