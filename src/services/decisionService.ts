import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ScoringResult, DecisionInfo } from "../types/loanApplication";
import { DEFAULT_SCORING_CONFIG } from "../types/scoring";
import { AuditService } from "./auditService";
import { EmailService } from "./emailService";

export class DecisionService {
  private get db() {
    return getFirestore();
  }
  private auditService = new AuditService();
  private emailService = new EmailService();

  async makeAutomaticDecision(
    microfinancieraId: string,
    applicationId: string,
    scoring: ScoringResult
  ): Promise<DecisionInfo> {
    const { band } = scoring;
    const config = DEFAULT_SCORING_CONFIG.bands;

    let result: "approved" | "rejected" | "observed" | "pending";
    let comments: string;

    // CAMBIO: Todas las aprobaciones automáticas requieren revisión manual
    if (band === "A" && config.A.autoApprove) {
      result = "observed"; // Cambio: pending_review se maneja como "observed"
      comments = "Pre-aprobado automáticamente - Banda A: Perfil crediticio excelente. Requiere aprobación final del analista.";
    } else if (band === "B" && config.B.autoApprove) {
      result = "observed"; // Cambio: pending_review se maneja como "observed"
      comments = "Pre-aprobado automáticamente - Banda B: Perfil crediticio bueno. Requiere aprobación final del analista.";
    } else if (band === "C") {
      result = "observed";
      comments = "Requiere revisión manual - Banda C: Perfil crediticio moderado";
    } else {
      result = "rejected";
      comments = "Rechazo automático - Banda D: Perfil crediticio insuficiente. Puede ser revisado manualmente.";
    }

    const decision: DecisionInfo = {
      result,
      decidedBy: "SYSTEM",
      decidedAt: Timestamp.now(),
      comments,
      isAutomatic: true,
    };

    // Actualizar aplicación
    await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .update({
        decision,
        updatedAt: Timestamp.now(),
      });

    // Registrar en auditoría
    await this.auditService.log(
      "SYSTEM",
      "AUTOMATIC_DECISION",
      "loanApplication",
      applicationId,
      {},
      { decision },
      applicationId,
      { band, score: scoring.score }
    );

    console.log(
      `Decisión automática: ${result} (App: ${applicationId}, Banda: ${band})`
    );

    return decision;
  }

  async makeManualDecision(
    microfinancieraId: string,
    applicationId: string,
    result: "approved" | "rejected" | "observed",
    comments: string,
    userId: string
  ): Promise<DecisionInfo> {
    if (!comments || comments.trim().length < 5) {
      throw new Error("Los comentarios son obligatorios (mínimo 5 caracteres)");
    }

    // Obtener datos de la aplicación para el email
    const appDoc = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .get();

    if (!appDoc.exists) {
      throw new Error("Application not found");
    }

    const appData = appDoc.data() as any;

    const decision: DecisionInfo = {
      result,
      decidedBy: userId,
      decidedAt: Timestamp.now(),
      comments,
      isAutomatic: false,
    };

    // Actualizar aplicación
    await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .update({
        decision,
        status: result, // Actualizar estado según la decisión
        updatedAt: Timestamp.now(),
      });

    // Registrar en auditoría
    await this.auditService.log(
      userId,
      "MANUAL_DECISION",
      "loanApplication",
      applicationId,
      {},
      { decision },
      applicationId,
      { comments }
    );

    // Enviar email según el resultado
    try {
      const customerName = `${appData.personalInfo?.firstName || ''} ${appData.personalInfo?.lastName || ''}`.trim();
      const email = appData.contactInfo?.email;

      if (email) {
        if (result === "approved") {
          const monthlyPayment = this.calculateMonthlyPayment(
            appData.financialInfo.loanAmount,
            appData.financialInfo.loanTermMonths
          );
          
          await this.emailService.sendLoanApprovedEmail(
            email,
            customerName || 'Cliente',
            appData.financialInfo.loanAmount,
            monthlyPayment,
            appData.financialInfo.loanTermMonths
          );
          console.log(`✅ Email de aprobación enviado a: ${email}`);
        } else if (result === "rejected") {
          await this.emailService.sendLoanRejectedEmail(
            email,
            customerName || 'Cliente',
            comments
          );
          console.log(`✅ Email de rechazo enviado a: ${email}`);
        } else if (result === "observed") {
          await this.emailService.sendLoanObservedEmail(
            email,
            customerName || 'Cliente',
            comments
          );
          console.log(`✅ Email de observación enviado a: ${email}`);
        }
      }
    } catch (emailError) {
      console.error("❌ Error enviando email:", emailError);
      // No fallar la decisión si el email falla
    }

    console.log(
      `Decisión manual: ${result} por ${userId} (App: ${applicationId})`
    );

    return decision;
  }

  private calculateMonthlyPayment(amount: number, termMonths: number): number {
    const monthlyRate = 0.02; // 24% anual = 2% mensual
    return (
      (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1)
    );
  }

  async getDecisionStatistics(
    microfinancieraId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    total: number;
    approved: number;
    rejected: number;
    observed: number;
    automatic: number;
    manual: number;
    approvalRate: number;
  }> {
    const snapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .where("decision.decidedAt", ">=", Timestamp.fromDate(startDate))
      .where("decision.decidedAt", "<=", Timestamp.fromDate(endDate))
      .get();

    const stats = {
      total: snapshot.size,
      approved: 0,
      rejected: 0,
      observed: 0,
      automatic: 0,
      manual: 0,
      approvalRate: 0,
    };

    snapshot.docs.forEach((doc) => {
      const decision = doc.data().decision as DecisionInfo;
      if (decision.result === "approved") stats.approved++;
      if (decision.result === "rejected") stats.rejected++;
      if (decision.result === "observed") stats.observed++;
      if (decision.isAutomatic) stats.automatic++;
      else stats.manual++;
    });

    stats.approvalRate = stats.total > 0 ? stats.approved / stats.total : 0;

    return stats;
  }
}

