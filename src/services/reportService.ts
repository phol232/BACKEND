import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ApplicationStatus } from "../types/loanApplication";

export interface ReportFilters {
  dateFrom: Date;
  dateTo: Date;
  branchId?: string;
  agentId?: string;
  status?: ApplicationStatus;
}

export interface ApplicationReport {
  applicationId: string;
  customerName: string;
  dni: string;
  loanAmount: number;
  termMonths: number;
  status: ApplicationStatus;
  branchName: string;
  agentName: string;
  createdAt: Date;
  updatedAt: Date;
  decisionResult?: string;
  scoreBand?: string;
}

export class ReportService {
  private get db() {
    return getFirestore();
  }

  async generateApplicationsReport(
    microfinancieraId: string,
    filters: ReportFilters
  ): Promise<ApplicationReport[]> {
    let query = this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .where("createdAt", ">=", Timestamp.fromDate(filters.dateFrom))
      .where("createdAt", "<=", Timestamp.fromDate(filters.dateTo));

    if (filters.status) {
      query = query.where("status", "==", filters.status);
    }

    const snapshot = await query.get();

    const reports: ApplicationReport[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Filtrar por agente si se especifica
      if (filters.agentId && data.routing?.agentId !== filters.agentId) {
        continue;
      }

      // Filtrar por sucursal si se especifica
      if (filters.branchId && data.routing?.branchId !== filters.branchId) {
        continue;
      }

      reports.push({
        applicationId: doc.id,
        customerName: `${data.personalInfo.firstName} ${data.personalInfo.lastName}`,
        dni: data.personalInfo.documentNumber,
        loanAmount: data.financialInfo.loanAmount,
        termMonths: data.financialInfo.loanTermMonths,
        status: data.status,
        branchName: await this.getBranchName(microfinancieraId, data.routing?.branchId),
        agentName: await this.getAgentName(microfinancieraId, data.routing?.agentId),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
        decisionResult: data.decision?.result,
        scoreBand: data.scoring?.band,
      });
    }

    return reports;
  }

  async getConversionMetrics(
    microfinancieraId: string,
    filters: ReportFilters
  ): Promise<{
    totalApplications: number;
    received: number;
    inReview: number;
    approved: number;
    rejected: number;
    disbursed: number;
    conversionRate: number;
    avgProcessingDays: number;
  }> {
    const applications = await this.generateApplicationsReport(microfinancieraId, filters);

    const metrics = {
      totalApplications: applications.length,
      received: 0,
      inReview: 0,
      approved: 0,
      rejected: 0,
      disbursed: 0,
      conversionRate: 0,
      avgProcessingDays: 0,
    };

    let totalProcessingDays = 0;
    let completedApplications = 0;

    applications.forEach((app) => {
      if (app.status === "received") metrics.received++;
      if (app.status === "in_review") metrics.inReview++;
      if (app.status === "approved") metrics.approved++;
      if (app.status === "rejected") metrics.rejected++;
      if (app.status === "disbursed") metrics.disbursed++;

      if (app.status === "approved" || app.status === "rejected" || app.status === "disbursed") {
        const processingDays =
          (app.updatedAt.getTime() - app.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        totalProcessingDays += processingDays;
        completedApplications++;
      }
    });

    metrics.conversionRate =
      metrics.totalApplications > 0 ? metrics.disbursed / metrics.totalApplications : 0;

    metrics.avgProcessingDays =
      completedApplications > 0 ? totalProcessingDays / completedApplications : 0;

    return metrics;
  }

  async getAgentPerformance(
    microfinancieraId: string,
    agentId: string,
    filters: ReportFilters
  ): Promise<{
    agentId: string;
    agentName: string;
    totalProcessed: number;
    approved: number;
    rejected: number;
    pending: number;
    approvalRate: number;
    avgProcessingTime: number;
  }> {
    const applications = await this.generateApplicationsReport(microfinancieraId, {
      ...filters,
      agentId,
    });

    const agentName = await this.getAgentName(microfinancieraId, agentId);

    let totalProcessingTime = 0;
    let completedCount = 0;

    const performance = {
      agentId,
      agentName,
      totalProcessed: applications.length,
      approved: 0,
      rejected: 0,
      pending: 0,
      approvalRate: 0,
      avgProcessingTime: 0,
    };

    applications.forEach((app) => {
      if (app.status === "approved" || app.status === "disbursed") {
        performance.approved++;
        const time = (app.updatedAt.getTime() - app.createdAt.getTime()) / (1000 * 60 * 60);
        totalProcessingTime += time;
        completedCount++;
      } else if (app.status === "rejected") {
        performance.rejected++;
        const time = (app.updatedAt.getTime() - app.createdAt.getTime()) / (1000 * 60 * 60);
        totalProcessingTime += time;
        completedCount++;
      } else {
        performance.pending++;
      }
    });

    performance.approvalRate =
      performance.totalProcessed > 0 ? performance.approved / performance.totalProcessed : 0;

    performance.avgProcessingTime = completedCount > 0 ? totalProcessingTime / completedCount : 0;

    return performance;
  }

  generateCSV(data: ApplicationReport[]): string {
    const headers = [
      "ID Solicitud",
      "Cliente",
      "DNI",
      "Monto",
      "Plazo (meses)",
      "Estado",
      "Sucursal",
      "Asesor",
      "Fecha Creación",
      "Fecha Actualización",
      "Decisión",
      "Banda Score",
    ];

    const rows = data.map((app) => [
      app.applicationId,
      app.customerName,
      app.dni,
      app.loanAmount.toString(),
      app.termMonths.toString(),
      app.status,
      app.branchName,
      app.agentName,
      app.createdAt.toISOString(),
      app.updatedAt.toISOString(),
      app.decisionResult || "N/A",
      app.scoreBand || "N/A",
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");

    return csvContent;
  }

  private async getBranchName(
    microfinancieraId: string,
    branchId?: string
  ): Promise<string> {
    if (!branchId) return "Sin asignar";

    try {
      const branchDoc = await this.db
        .collection("microfinancieras")
        .doc(microfinancieraId)
        .collection("branches")
        .doc(branchId)
        .get();

      return branchDoc.exists ? branchDoc.data()?.name || "Desconocida" : "Desconocida";
    } catch (error) {
      return "Desconocida";
    }
  }

  private async getAgentName(
    microfinancieraId: string,
    agentId?: string
  ): Promise<string> {
    if (!agentId) return "Sin asignar";

    try {
      const agentDoc = await this.db
        .collection("microfinancieras")
        .doc(microfinancieraId)
        .collection("agents")
        .doc(agentId)
        .get();

      if (agentDoc.exists) {
        const userId = agentDoc.data()?.userId;
        if (userId) {
          const userDoc = await this.db.collection("users").doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            return `${userData?.firstName || ""} ${userData?.lastName || ""}`.trim();
          }
        }
      }
      return "Desconocido";
    } catch (error) {
      return "Desconocido";
    }
  }
}

