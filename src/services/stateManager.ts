import { ApplicationStatus, StateTransition } from "../types/loanApplication";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { AuditService } from "./auditService";

export class StateManager {
  private auditService = new AuditService();
  private get db() {
    return getFirestore();
  }

  private validTransitions: Record<ApplicationStatus, ApplicationStatus[]> = {
    pending: ["received"],
    received: ["routed", "rejected"],
    routed: ["in_review", "rejected"],
    in_review: ["decision", "observed", "rejected"],
    decision: ["approved", "rejected", "observed"],
    approved: ["disbursed"],
    rejected: [],
    observed: ["in_review"],
    disbursed: [],
  };

  async transitionState(
    microfinancieraId: string,
    applicationId: string,
    newStatus: ApplicationStatus,
    userId: string,
    reason?: string
  ): Promise<void> {
    const appRef = this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId);

    const appDoc = await appRef.get();
    if (!appDoc.exists) {
      throw new Error("Solicitud no encontrada");
    }

    const currentStatus = appDoc.data()?.status as ApplicationStatus;

    // Validar transición
    if (!this.isValidTransition(currentStatus, newStatus)) {
      throw new Error(
        `Transición inválida de ${currentStatus} a ${newStatus}`
      );
    }

    // Crear registro de transición
    const transition: StateTransition = {
      from: currentStatus,
      to: newStatus,
      timestamp: Timestamp.now(),
      userId,
      reason,
    };

    // Actualizar aplicación
    await appRef.update({
      status: newStatus,
      updatedAt: Timestamp.now(),
    });

    // Guardar transición en subcolección
    await appRef.collection("transitions").add(transition);

    // Registrar en auditoría
    await this.auditService.log(
      userId,
      "STATE_TRANSITION",
      "loanApplication",
      applicationId,
      { status: currentStatus },
      { status: newStatus },
      applicationId,
      { reason }
    );

    console.log(
      `Transición: ${currentStatus} → ${newStatus} (App: ${applicationId})`
    );
  }

  isValidTransition(
    from: ApplicationStatus,
    to: ApplicationStatus
  ): boolean {
    return this.validTransitions[from]?.includes(to) || false;
  }

  getValidNextStates(currentStatus: ApplicationStatus): ApplicationStatus[] {
    return this.validTransitions[currentStatus] || [];
  }

  async getTransitionHistory(
    microfinancieraId: string,
    applicationId: string
  ): Promise<StateTransition[]> {
    const snapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .collection("transitions")
      .orderBy("timestamp", "desc")
      .get();

    return snapshot.docs.map((doc) => doc.data() as StateTransition);
  }
}

