import { getFirestore } from "firebase-admin/firestore";
import { RoutingRule, Agent, Branch } from "../types/routing";
import { RoutingInfo } from "../types/loanApplication";
import { Timestamp } from "firebase-admin/firestore";

export class RoutingService {
  private get db() {
    return getFirestore();
  }

  async routeApplication(
    microfinancieraId: string,
    district: string
  ): Promise<RoutingInfo> {
    // 1. Obtener regla de enrutamiento por distrito
    const branchId = await this.getBranchByDistrict(microfinancieraId, district);

    if (!branchId) {
      throw new Error(`No hay sucursal configurada para el distrito: ${district}`);
    }

    // 2. Obtener agente disponible con menor carga
    const agentId = await this.getAvailableAgent(microfinancieraId, branchId);

    return {
      branchId,
      agentId,
      assignedAt: agentId ? Timestamp.now() : null,
      district,
    };
  }

  private async getBranchByDistrict(
    microfinancieraId: string,
    district: string
  ): Promise<string | null> {
    // Buscar regla de enrutamiento
    const rulesSnapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("routingRules")
      .where("district", "==", district)
      .where("isActive", "==", true)
      .orderBy("priority", "desc")
      .limit(1)
      .get();

    if (!rulesSnapshot.empty) {
      const rule = rulesSnapshot.docs[0].data() as RoutingRule;
      return rule.branchId;
    }

    // Si no hay regla específica, buscar sucursal en el mismo distrito
    const branchSnapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("branches")
      .where("district", "==", district)
      .where("isActive", "==", true)
      .limit(1)
      .get();

    if (!branchSnapshot.empty) {
      return branchSnapshot.docs[0].id;
    }

    // Fallback: obtener cualquier sucursal activa
    const fallbackSnapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("branches")
      .where("isActive", "==", true)
      .limit(1)
      .get();

    return fallbackSnapshot.empty ? null : fallbackSnapshot.docs[0].id;
  }

  private async getAvailableAgent(
    microfinancieraId: string,
    branchId: string
  ): Promise<string | null> {
    // Obtener agentes activos de la sucursal
    const agentsSnapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("agents")
      .where("branchId", "==", branchId)
      .where("isActive", "==", true)
      .get();

    if (agentsSnapshot.empty) {
      return null;
    }

    const agents = agentsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Agent[];

    // Filtrar agentes que no han alcanzado su capacidad máxima
    const availableAgents = agents.filter(
      (agent) => agent.currentLoanCount < agent.maxConcurrentLoans
    );

    if (availableAgents.length === 0) {
      return null;
    }

    // Seleccionar agente con menor carga actual
    const selectedAgent = availableAgents.reduce((prev, current) =>
      prev.currentLoanCount < current.currentLoanCount ? prev : current
    );

    // Incrementar contador de préstamos del agente
    await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("agents")
      .doc(selectedAgent.id)
      .update({
        currentLoanCount: selectedAgent.currentLoanCount + 1,
      });

    return selectedAgent.id;
  }

  async reassignAgent(
    microfinancieraId: string,
    applicationId: string,
    newAgentId: string,
    userId: string
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

    const currentRouting = appDoc.data()?.routing as RoutingInfo;
    const oldAgentId = currentRouting?.agentId;

    // Decrementar contador del agente anterior
    if (oldAgentId) {
      await this.db
        .collection("microfinancieras")
        .doc(microfinancieraId)
        .collection("agents")
        .doc(oldAgentId)
        .update({
          currentLoanCount: (await this.db
            .collection("microfinancieras")
            .doc(microfinancieraId)
            .collection("agents")
            .doc(oldAgentId)
            .get()).data()?.currentLoanCount - 1 || 0,
        });
    }

    // Incrementar contador del nuevo agente
    await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("agents")
      .doc(newAgentId)
      .update({
        currentLoanCount: (await this.db
          .collection("microfinancieras")
          .doc(microfinancieraId)
          .collection("agents")
          .doc(newAgentId)
          .get()).data()?.currentLoanCount + 1 || 1,
      });

    // Actualizar routing
    await appRef.update({
      "routing.agentId": newAgentId,
      "routing.assignedAt": Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    console.log(
      `Reasignación: ${oldAgentId} → ${newAgentId} (App: ${applicationId})`
    );
  }

  async createRoutingRule(
    microfinancieraId: string,
    district: string,
    branchId: string,
    priority: number
  ): Promise<string> {
    const rule: Omit<RoutingRule, "id"> = {
      district,
      branchId,
      priority,
      isActive: true,
    };

    const docRef = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("routingRules")
      .add(rule);

    return docRef.id;
  }
}

