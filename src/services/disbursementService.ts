import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { EmailService } from "./emailService";

export interface RepaymentScheduleEntry {
  installmentNumber: number;
  dueDate: Date;
  principal: number;
  interest: number;
  totalPayment: number;
  remainingBalance: number;
}

export interface AccountingEntry {
  entryNumber: string;
  date: Timestamp;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  reference: string;
}

export class DisbursementService {
  private get db() {
    return getFirestore();
  }
  private processedRequests = new Set<string>();
  private emailService = new EmailService();

  async disburseLoan(
    microfinancieraId: string,
    applicationId: string,
    requestId: string
  ): Promise<void> {
    // Idempotencia: verificar si ya fue procesado
    if (this.processedRequests.has(requestId)) {
      console.log(`Solicitud ya procesada: ${requestId}`);
      throw new Error("Este préstamo ya fue desembolsado anteriormente");
    }

    // Verificar en Firestore si ya existe
    const disbursementDoc = await this.db
      .collection("disbursements")
      .doc(requestId)
      .get();

    if (disbursementDoc.exists) {
      console.log(`Desembolso ya existe: ${requestId}`);
      throw new Error("Este préstamo ya fue desembolsado anteriormente");
    }

    // Obtener aplicación
    const appRef = this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId);

    const appDoc = await appRef.get();
    if (!appDoc.exists) {
      throw new Error("Solicitud no encontrada");
    }

    const application = appDoc.data();
    
    // VALIDACIÓN CRÍTICA: Verificar que no esté ya desembolsado
    if (application?.status === "disbursed") {
      throw new Error("Este préstamo ya fue desembolsado. No se puede desembolsar dos veces.");
    }

    if (application?.status !== "approved") {
      throw new Error("La solicitud debe estar aprobada para desembolsar");
    }

    const { loanAmount, loanTermMonths } = application.financialInfo;

    // 1. Generar cronograma de pagos
    const schedule = this.generateRepaymentSchedule(
      loanAmount,
      loanTermMonths,
      0.02 // 2% mensual (24% anual)
    );

    // 2. Crear asientos contables
    const accountingEntries = this.generateAccountingEntries(
      applicationId,
      loanAmount,
      application.personalInfo.firstName + " " + application.personalInfo.lastName
    );

    // 3. Guardar cronograma
    const scheduleRef = appRef.collection("repaymentSchedule");
    for (const entry of schedule) {
      await scheduleRef.add(entry);
    }

    // 4. Guardar asientos contables
    const entriesRef = appRef.collection("accountingEntries");
    for (const entry of accountingEntries) {
      await entriesRef.add(entry);
    }

    // 5. Actualizar estado de la aplicación
    await appRef.update({
      status: "disbursed",
      disbursedAt: Timestamp.now(),
      disbursementRequestId: requestId,
      updatedAt: Timestamp.now(),
    });

    // 6. Registrar desembolso procesado
    await this.db.collection("disbursements").doc(requestId).set({
      applicationId,
      microfinancieraId,
      amount: loanAmount,
      processedAt: Timestamp.now(),
    });

    this.processedRequests.add(requestId);

    console.log(`Desembolso completado: ${applicationId} (${loanAmount})`);

    // 7. Enviar email de confirmación de desembolso
    try {
      const customerName = `${application.personalInfo.firstName} ${application.personalInfo.lastName}`;
      const customerEmail = application.contactInfo.email;
      const monthlyPayment = schedule[0]?.totalPayment || 0;
      const firstPaymentDate = schedule[0]?.dueDate || new Date();

      await this.emailService.sendLoanDisbursedEmail(
        customerEmail,
        customerName,
        loanAmount,
        loanTermMonths,
        monthlyPayment,
        firstPaymentDate
      );

      console.log(`✅ Email de desembolso enviado a: ${customerEmail}`);
    } catch (emailError) {
      console.error('❌ Error enviando email de desembolso:', emailError);
      // No lanzar error para no afectar el desembolso
    }
  }

  private generateRepaymentSchedule(
    principal: number,
    termMonths: number,
    monthlyRate: number
  ): RepaymentScheduleEntry[] {
    const schedule: RepaymentScheduleEntry[] = [];
    let remainingBalance = principal;

    // Calcular cuota mensual fija (sistema francés)
    const monthlyPayment =
      (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1);

    const today = new Date();

    for (let i = 1; i <= termMonths; i++) {
      const interest = remainingBalance * monthlyRate;
      const principalPayment = monthlyPayment - interest;
      remainingBalance -= principalPayment;

      // Calcular fecha de vencimiento
      const dueDate = new Date(today);
      dueDate.setMonth(dueDate.getMonth() + i);

      schedule.push({
        installmentNumber: i,
        dueDate,
        principal: Math.round(principalPayment * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        totalPayment: Math.round(monthlyPayment * 100) / 100,
        remainingBalance: Math.max(0, Math.round(remainingBalance * 100) / 100),
      });
    }

    return schedule;
  }

  private generateAccountingEntries(
    applicationId: string,
    amount: number,
    customerName: string
  ): AccountingEntry[] {
    const entryNumber = `DESB-${Date.now()}`;
    const now = Timestamp.now();

    return [
      {
        entryNumber,
        date: now,
        description: `Desembolso de crédito - ${customerName}`,
        debitAccount: "1401 - Cartera de Créditos",
        creditAccount: "1101 - Caja y Bancos",
        amount,
        reference: applicationId,
      },
      {
        entryNumber: `INT-${Date.now()}`,
        date: now,
        description: `Intereses por cobrar - ${customerName}`,
        debitAccount: "1402 - Intereses por Cobrar",
        creditAccount: "5101 - Ingresos por Intereses",
        amount: this.calculateTotalInterest(amount, 12, 0.02), // Ejemplo
        reference: applicationId,
      },
    ];
  }

  private calculateTotalInterest(
    principal: number,
    termMonths: number,
    monthlyRate: number
  ): number {
    const monthlyPayment =
      (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1);

    const totalPaid = monthlyPayment * termMonths;
    const totalInterest = totalPaid - principal;

    return Math.round(totalInterest * 100) / 100;
  }

  async getRepaymentSchedule(
    microfinancieraId: string,
    applicationId: string
  ): Promise<RepaymentScheduleEntry[]> {
    const snapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .collection("repaymentSchedule")
      .orderBy("installmentNumber")
      .get();

    return snapshot.docs.map((doc) => doc.data() as RepaymentScheduleEntry);
  }

  async getAccountingEntries(
    microfinancieraId: string,
    applicationId: string
  ): Promise<AccountingEntry[]> {
    const snapshot = await this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("loanApplications")
      .doc(applicationId)
      .collection("accountingEntries")
      .orderBy("date")
      .get();

    return snapshot.docs.map((doc) => doc.data() as AccountingEntry);
  }
}

