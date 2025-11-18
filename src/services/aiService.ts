import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { config } from '../config';

export type ChatHistoryItem = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

interface ProcessChatParams {
  userId: string;
  microfinancieraId: string;
  userName?: string;
  message: string;
  history?: ChatHistoryItem[];
}

interface AccountSummary {
  id: string;
  accountType?: string;
  accountNumber?: string;
  currency?: string;
  balance?: number;
  status?: string;
  updatedAt?: Date | null;
}

interface LoanSummary {
  id: string;
  status?: string;
  productName?: string;
  principal?: number;
  rateNominal?: number;
  termMonths?: number;
  createdAt?: Date | null;
  nextInstallment?: PendingInstallment | null;
  pendingInstallments?: PendingInstallment[];
}

interface PendingInstallment {
  installmentNumber: number;
  dueDate: Date | null;
  totalDue: number;
  status: string;
}

export class AIService {
  async processChat(params: ProcessChatParams) {
    if (!config.llm.endpoint || !config.llm.apiKey) {
      throw new Error('LLM credentials are not configured in the backend');
    }

    const [accounts, loans] = await Promise.all([
      this.fetchUserAccounts(params.microfinancieraId, params.userId),
      this.fetchUserLoans(params.microfinancieraId, params.userId),
    ]);

    const contextSummary = this.buildContextSummary({
      accounts,
      loans,
      userId: params.userId,
      microfinancieraId: params.microfinancieraId,
      userName: params.userName,
    });

    const messages = this.buildMessages({
      history: params.history,
      message: params.message,
      contextSummary,
      userName: params.userName,
    });

    const agentResponse = await this.callAgent(messages, {
      userId: params.userId,
      microfinancieraId: params.microfinancieraId,
    });

    return {
      answer: agentResponse,
      contextSummary,
    };
  }

  private async fetchUserAccounts(
    microfinancieraId: string,
    userId: string,
  ): Promise<AccountSummary[]> {
    const snapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('accounts')
      .where('userId', '==', userId)
      .limit(10)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        accountType: data.accountType,
        accountNumber: data.accountNumber,
        currency: data.currency ?? 'PEN',
        balance: typeof data.balance === 'number' ? data.balance : Number(data.balance) || 0,
        status: data.status,
        updatedAt: this.toDate(data.updatedAt ?? data.lastUpdatedAt),
      };
    });
  }

  private async fetchUserLoans(
    microfinancieraId: string,
    userId: string,
  ): Promise<LoanSummary[]> {
    const snapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('loanApplications')
      .where('userId', '==', userId)
      .get();

    const loans = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        status: data.status,
        productName: data.product?.name ?? data.productName,
        principal: typeof data.financialInfo?.loanAmount === 'number'
          ? data.financialInfo.loanAmount
          : data.principal ?? 0,
        rateNominal: data.product?.rateNominal ?? data.rateNominal,
        termMonths: data.financialInfo?.loanTermMonths ?? data.termMonths,
        createdAt: this.toDate(data.createdAt),
      } as LoanSummary;
    });

    const activeLoans = loans
      .filter((loan) =>
        ['disbursed', 'active', 'approved', 'in_progress'].includes(
          (loan.status || '').toLowerCase(),
        ),
      )
      .slice(0, 3); // limitar cronogramas consultados

    const schedules = await Promise.all(
      activeLoans.map((loan) =>
        this.fetchPendingInstallments(microfinancieraId, loan.id),
      ),
    );

    activeLoans.forEach((loan, index) => {
      const pending = schedules[index];
      loan.pendingInstallments = pending;
      loan.nextInstallment = pending.length ? pending[0] : null;
    });

    return loans;
  }

  private async fetchPendingInstallments(
    microfinancieraId: string,
    loanId: string,
  ): Promise<PendingInstallment[]> {
    const snapshot = await db()
      .collection('microfinancieras')
      .doc(microfinancieraId)
      .collection('loanApplications')
      .doc(loanId)
      .collection('repaymentSchedule')
      .orderBy('installmentNumber')
      .limit(50)
      .get();

    const installments = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          installmentNumber: data.installmentNumber ?? data.installmentNo ?? 0,
          dueDate: this.toDate(data.dueDate),
          totalDue: typeof data.totalDue === 'number'
            ? data.totalDue
            : data.totalPayment ?? 0,
          status: (data.status || 'pending').toLowerCase(),
        } as PendingInstallment;
      })
      .filter((inst) => inst.installmentNumber > 0);

    return installments
      .filter((inst) => inst.status !== 'paid')
      .sort((a, b) => a.installmentNumber - b.installmentNumber)
      .slice(0, 6);
  }

  private buildContextSummary(args: {
    accounts: AccountSummary[];
    loans: LoanSummary[];
    userId: string;
    microfinancieraId: string;
    userName?: string;
  }): string {
    const formatCurrency = (value?: number, currency = 'PEN') =>
      new Intl.NumberFormat('es-PE', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value ?? 0);

    const accountSection = args.accounts.length
      ? args.accounts
          .map((account) => {
            const alias =
              account.accountNumber?.slice(-4) !== undefined
                ? `****${account.accountNumber?.slice(-4)}`
                : account.id;
            return `- ${account.accountType ?? 'Cuenta'} (${alias}) · ${formatCurrency(
              account.balance,
              account.currency,
            )} · estado ${account.status ?? 'desconocido'}`;
          })
          .join('\n')
      : '- No se encontraron cuentas asociadas.';

    const loanSection = args.loans.length
      ? args.loans
          .map((loan) => {
            const next = loan.nextInstallment
              ? `Próxima cuota #${loan.nextInstallment.installmentNumber} vence ${this.formatDate(
                  loan.nextInstallment.dueDate,
                )} por ${formatCurrency(loan.nextInstallment.totalDue)}`
              : 'Sin cuotas pendientes registradas.';
            return `- Crédito ${loan.id} (${loan.productName ?? 'sin producto'}) · estado ${
              loan.status ?? 'desconocido'
            } · principal ${formatCurrency(loan.principal)} · ${next}`;
          })
          .join('\n')
      : '- No hay créditos registrados para este usuario.';

    return [
      `### Usuario autenticado`,
      `- Nombre visible: ${args.userName ?? 'sin nombre'}`,
      `- userId: ${args.userId}`,
      `- microfinancieraId: ${args.microfinancieraId}`,
      ``,
      `### Cuentas (${args.accounts.length})`,
      accountSection,
      ``,
      `### Créditos (${args.loans.length})`,
      loanSection,
      ``,
      `### Reglas de respuesta`,
      `- Usa los datos anteriores para responder sin volver a solicitarlos.`,
      `- Si faltan detalles específicos (ej. elegir entre varias cuentas), pide solo esa aclaración.`,
      `- Cita montos con dos decimales y especifica la moneda.`,
    ].join('\n');
  }

  private buildMessages(args: {
    contextSummary: string;
    message: string;
    history?: ChatHistoryItem[];
    userName?: string;
  }) {
    const baseSystemPrompt =
      'Eres el asistente financiero oficial de la app móvil de Avante/Microfinance. ' +
      'Dispones de datos confidenciales del usuario que ya fueron autenticados. ' +
      'Nunca inventes información y responde en español claro, utilizando viñetas o tablas cuando ayuden a la lectura.';

    const systemMessages: ChatHistoryItem[] = [
      { role: 'system', content: baseSystemPrompt },
      { role: 'system', content: args.contextSummary },
    ];

    const normalizedHistory =
      args.history?.filter(
        (item) => item.role && item.content && item.content.trim().length > 0,
      ) ?? [];

    const messages = [...systemMessages, ...normalizedHistory];

    if (!normalizedHistory.length || normalizedHistory[normalizedHistory.length - 1].role !== 'user') {
      messages.push({
        role: 'user',
        content: args.message,
      });
    }

    return messages;
  }

  private async callAgent(
    messages: ChatHistoryItem[],
    metadata: { userId: string; microfinancieraId: string },
  ): Promise<string> {
    const endpoint = this.buildEndpoint();
    const payload = {
      messages,
      stream: false,
      include_retrieval_info: true,
      include_functions_info: false,
      include_guardrails_info: false,
      metadata,
    };

    const response = await this.fetchJson(endpoint, payload);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `LLM request failed (${response.status} ${response.statusText}): ${errorBody}`,
      );
    }

    const data = await response.json();
    const answer = this.extractMessage(data);
    if (!answer) {
      throw new Error('LLM response did not include a valid answer');
    }
    return answer;
  }

  private async fetchJson(endpoint: string, body: unknown) {
    const runtimeFetch = (globalThis as any).fetch;
    if (typeof runtimeFetch !== 'function') {
      throw new Error('Fetch API is not available in this runtime');
    }

    return runtimeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  private buildEndpoint() {
    const normalized = config.llm.endpoint.replace(/\/+$/, '');
    if (normalized.endsWith('/api/v1/chat/completions')) {
      return normalized;
    }
    return `${normalized}/api/v1/chat/completions`;
  }

  private extractMessage(data: any): string | null {
    const choices = data?.choices;
    if (Array.isArray(choices) && choices.length) {
      const message = choices[0]?.message;
      if (typeof message?.content === 'string') {
        return message.content;
      }
      const parts = message?.content;
      if (Array.isArray(parts) && parts.length) {
        const first = parts[0];
        if (typeof first?.text === 'string') {
          return first.text;
        }
      }
    }
    if (typeof data?.response === 'string') return data.response;
    if (typeof data?.message === 'string') return data.message;
    if (typeof data?.content === 'string') return data.content;
    return null;
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private formatDate(value: Date | null | undefined) {
    if (!value) return 'sin fecha';
    return value.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
