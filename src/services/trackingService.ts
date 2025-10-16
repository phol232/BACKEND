import * as jwt from "jsonwebtoken";
import { getFirestore } from "firebase-admin/firestore";

export interface TrackingTokenPayload {
  applicationId: string;
  microfinancieraId: string;
  expiresAt: number;
}

export interface ApplicationTrackingInfo {
  applicationId: string;
  status: string;
  currentStep: string;
  createdAt: Date;
  lastUpdated: Date;
  pendingDocuments: string[];
  assignedAgent?: {
    name: string;
    phone: string;
    email: string;
  };
  timeline: {
    status: string;
    timestamp: Date;
    description: string;
  }[];
}

export class TrackingService {
  private get db() {
    return getFirestore();
  }
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  generateTrackingToken(
    applicationId: string,
    microfinancieraId: string,
    validityHours = 24
  ): string {
    const expiresAt = Date.now() + validityHours * 60 * 60 * 1000;

    const payload: TrackingTokenPayload = {
      applicationId,
      microfinancieraId,
      expiresAt,
    };

    return jwt.sign(payload, this.secretKey, { expiresIn: `${validityHours}h` });
  }

  verifyTrackingToken(token: string): TrackingTokenPayload {
    try {
      const payload = jwt.verify(token, this.secretKey) as TrackingTokenPayload;

      // Verificar expiración adicional
      if (payload.expiresAt < Date.now()) {
        throw new Error("Token expirado");
      }

      return payload;
    } catch (error: any) {
      throw new Error(`Token inválido: ${error.message}`);
    }
  }

  async getApplicationTrackingInfo(
    microfinancieraId: string,
    applicationId: string
  ): Promise<ApplicationTrackingInfo> {
    const appDoc = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .get();

    if (!appDoc.exists) {
      throw new Error("Solicitud no encontrada");
    }

    const data = appDoc.data()!;

    // Obtener transiciones para timeline
    const transitionsSnapshot = await appDoc.ref
      .collection("transitions")
      .orderBy("timestamp", "asc")
      .get();

    const timeline = transitionsSnapshot.docs.map((doc) => {
      const t = doc.data();
      return {
        status: t.to,
        timestamp: t.timestamp.toDate(),
        description: this.getStatusDescription(t.to),
      };
    });

    // Determinar documentos pendientes
    const pendingDocuments = this.getPendingDocuments(data);

    // Obtener información del agente asignado
    let assignedAgent;
    if (data.routing?.agentId) {
      assignedAgent = await this.getAgentInfo(microfinancieraId, data.routing.agentId);
    }

    return {
      applicationId,
      status: data.status,
      currentStep: this.getCurrentStep(data.status),
      createdAt: data.createdAt.toDate(),
      lastUpdated: data.updatedAt.toDate(),
      pendingDocuments,
      assignedAgent,
      timeline,
    };
  }

  private getStatusDescription(status: string): string {
    const descriptions: Record<string, string> = {
      pending: "Solicitud iniciada",
      received: "Solicitud recibida y registrada",
      routed: "Asignada a sucursal y asesor",
      in_review: "En revisión por el equipo",
      decision: "En proceso de decisión",
      approved: "Solicitud aprobada",
      rejected: "Solicitud no aprobada",
      observed: "Requiere información adicional",
      disbursed: "Crédito desembolsado",
    };

    return descriptions[status] || "Estado desconocido";
  }

  private getCurrentStep(status: string): string {
    const steps: Record<string, string> = {
      pending: "Inicio",
      received: "Recepción",
      routed: "Asignación",
      in_review: "Revisión",
      decision: "Evaluación",
      approved: "Aprobado",
      rejected: "Finalizado",
      observed: "Información Adicional",
      disbursed: "Desembolsado",
    };

    return steps[status] || "Desconocido";
  }

  private getPendingDocuments(applicationData: any): string[] {
    const pending: string[] = [];

    // Verificar documentos básicos
    const documents = applicationData.documents || [];
    const requiredDocs = ["dni_front", "dni_back", "income_proof"];

    requiredDocs.forEach((docType) => {
      const exists = documents.some((doc: any) => doc.type === docType);
      if (!exists) {
        pending.push(this.getDocumentName(docType));
      }
    });

    // Verificar según estado
    if (applicationData.status === "observed") {
      if (applicationData.decision?.comments) {
        pending.push("Documentación adicional según comentarios del analista");
      }
    }

    return pending;
  }

  private getDocumentName(docType: string): string {
    const names: Record<string, string> = {
      dni_front: "DNI (frente)",
      dni_back: "DNI (reverso)",
      income_proof: "Comprobante de ingresos",
      address_proof: "Comprobante de domicilio",
    };

    return names[docType] || docType;
  }

  private async getAgentInfo(
    microfinancieraId: string,
    agentId: string
  ): Promise<{ name: string; phone: string; email: string } | undefined> {
    try {
      const agentDoc = await this.db
        .collection("microfinancieras")
        .doc(microfinancieraId)
        .collection("agents")
        .doc(agentId)
        .get();

      if (!agentDoc.exists) return undefined;

      const agentData = agentDoc.data()!;
      const userId = agentData.userId;

      if (!userId) return undefined;

      const userDoc = await this.db.collection("users").doc(userId).get();

      if (!userDoc.exists) return undefined;

      const userData = userDoc.data()!;

      return {
        name: `${userData.firstName || ""} ${userData.lastName || ""}`.trim(),
        phone: userData.phone || "No disponible",
        email: userData.email || "No disponible",
      };
    } catch (error) {
      console.error("Error obteniendo info del agente:", error);
      return undefined;
    }
  }
}

