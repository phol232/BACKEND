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
    requestId: string,
    accountId: string,
    branchId?: string
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

    if (!accountId) {
      throw new Error("Debe seleccionar una cuenta destino para el desembolso");
    }

    // Verificar cuenta destino
    const accountRef = this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("accounts")
      .doc(accountId);

    const accountDoc = await accountRef.get();
    if (!accountDoc.exists) {
      throw new Error("Cuenta destino no encontrada");
    }

    const account = accountDoc.data() as any;
    if (account.status !== "active") {
      throw new Error("La cuenta seleccionada no está activa");
    }

    if (account.userId !== application.userId) {
      throw new Error("La cuenta seleccionada no pertenece al solicitante");
    }

    const currentBalance =
      typeof account.balance === "number"
        ? account.balance
        : typeof account.initialDeposit === "number"
          ? account.initialDeposit
          : 0;

    const {
      loanAmount: rawLoanAmount,
      loanTermMonths: rawLoanTerm,
    } = application.financialInfo;
    const loanAmount = typeof rawLoanAmount === "number" ? rawLoanAmount : Number(rawLoanAmount);
    const loanTermMonths =
      typeof rawLoanTerm === "number" ? rawLoanTerm : Number(rawLoanTerm);

    if (!loanAmount || isNaN(loanAmount) || loanAmount <= 0) {
      throw new Error("El monto del préstamo es inválido");
    }

    if (!loanTermMonths || isNaN(loanTermMonths) || loanTermMonths <= 0) {
      throw new Error("El plazo del préstamo es inválido");
    }

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

    // 5. Registrar transacciones y actualizar la cuenta destino
    const transactionsRef = this.db
      .collection("microfinancieras")
      .doc(microfinancieraId)
      .collection("transactions");

    const batch = this.db.batch();
    const now = Timestamp.now();
    const branch = branchId || application.routing?.branchId || "central";

    const disbursementRef = transactionsRef.doc();
    batch.set(disbursementRef, {
      mfId: microfinancieraId,
      type: "DISBURSEMENT",
      refType: "loan",
      refId: applicationId,
      debit: 0,
      credit: loanAmount,
      currency: "PEN",
      branchId: branch,
      createdAt: now,
      metadata: {
        accountId,
        disbursementType: "loan",
      },
    });

    const accountCreditRef = transactionsRef.doc();
    batch.set(accountCreditRef, {
      mfId: microfinancieraId,
      type: "ACCOUNT_CREDIT",
      refType: "account",
      refId: accountId,
      debit: 0,
      credit: loanAmount,
      currency: "PEN",
      branchId: branch,
      createdAt: now,
      metadata: {
        loanId: applicationId,
        disbursementType: "loan",
      },
    });

    batch.update(accountRef, {
      balance: currentBalance + loanAmount,
      lastUpdated: now,
    });

    await batch.commit();

    // 6. Actualizar estado de la aplicación
    await appRef.update({
      status: "disbursed",
      disbursedAt: now,
      disbursementRequestId: requestId,
      disbursementDetails: {
        accountId,
        accountNumber: account.accountNumber || null,
        bankName: account.bankName || null,
        branchId: branch,
        amount: loanAmount,
        processedAt: now,
      },
      updatedAt: now,
    });

    // 7. Registrar desembolso procesado
    await this.db.collection("disbursements").doc(requestId).set({
      applicationId,
      microfinancieraId,
      amount: loanAmount,
      processedAt: now,
      accountId,
      branchId: branch,
    });

    this.processedRequests.add(requestId);

    console.log(`Desembolso completado: ${applicationId} (${loanAmount})`);

    // 8. Enviar email de confirmación de desembolso
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
