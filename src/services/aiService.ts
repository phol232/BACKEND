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

interface CardSummary {
  id: string;
  accountId: string;
  cardType?: string;
  cardBrand?: string;
  status?: string;
  maskedNumber?: string;
  holderName?: string;
  createdAt?: Date | null;
}

interface TransactionSummary {
  id: string;
  refType: string;
  refId: string;
  type?: string;
  debit: number;
  credit: number;
  currency: string;
  createdAt?: Date | null;
  metadata?: Record<string, any>;
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

    const accountIds = accounts.map((account) => account.id);
    const cards = await this.fetchUserCards(params.microfinancieraId, accountIds);
    const cardIds = cards.map((card) => card.id);
    const transactions = await this.fetchRecentTransactions({
      microfinancieraId: params.microfinancieraId,
      accountIds,
      cardIds,
    });

    const contextSummary = this.buildContextSummary({
      accounts,
      loans,
      cards,
      transactions,
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

  private async fetchUserCards(
    microfinancieraId: string,
    accountIds: string[],
  ): Promise<CardSummary[]> {
    if (!accountIds.length) {
      return [];
    }

    const chunks = this.chunkArray(accountIds, 10);
    const results: CardSummary[] = [];

    for (const chunk of chunks) {
      const snapshot = await db()
        .collection('microfinancieras')
        .doc(microfinancieraId)
        .collection('cards')
        .where('accountId', 'in', chunk)
        .get();

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (!data?.accountId) return;
        const holderName =
          data.name ||
          [data.holderFirstName, data.holderLastName]
            .filter((value: string | undefined) => Boolean(value))
            .join(' ')
            .trim() ||
          undefined;
        results.push({
          id: doc.id,
          accountId: data.accountId,
          cardType: data.cardType,
          cardBrand: data.cardBrand,
          status: data.status,
          maskedNumber: data.maskedCardNumber,
          holderName,
          createdAt: this.toDate(data.createdAt),
        });
      });
    }

    return results;
  }

  private async fetchRecentTransactions(args: {
    microfinancieraId: string;
    accountIds: string[];
    cardIds: string[];
    perResourceLimit?: number;
    overallLimit?: number;
  }): Promise<TransactionSummary[]> {
    const { microfinancieraId, accountIds, cardIds } = args;
    const perResourceLimit = args.perResourceLimit ?? 3;
    const overallLimit = args.overallLimit ?? 12;

    const queries: Array<Promise<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>> =
      [];
    const references: Array<{ type: 'account' | 'card'; id: string }> = [];

    accountIds.slice(0, 4).forEach((accountId) => {
      queries.push(
        db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('transactions')
          .where('refType', '==', 'account')
          .where('refId', '==', accountId)
          .orderBy('createdAt', 'desc')
          .limit(perResourceLimit)
          .get(),
      );
      references.push({ type: 'account', id: accountId });
    });

    cardIds.slice(0, 4).forEach((cardId) => {
      queries.push(
        db()
          .collection('microfinancieras')
          .doc(microfinancieraId)
          .collection('transactions')
          .where('refType', '==', 'card')
          .where('refId', '==', cardId)
          .orderBy('createdAt', 'desc')
          .limit(perResourceLimit)
          .get(),
      );
      references.push({ type: 'card', id: cardId });
    });

    if (!queries.length) {
      return [];
    }

    const snapshots = await Promise.all(queries);
    const transactions: TransactionSummary[] = [];

    snapshots.forEach((snapshot, index) => {
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        transactions.push({
          id: doc.id,
          refType: data.refType ?? references[index]?.type ?? 'account',
          refId: data.refId ?? references[index]?.id ?? '',
          type: data.type,
          debit: typeof data.debit === 'number' ? data.debit : Number(data.debit) || 0,
          credit: typeof data.credit === 'number' ? data.credit : Number(data.credit) || 0,
          currency: data.currency ?? 'PEN',
          createdAt: this.toDate(data.createdAt),
          metadata: data.metadata,
        });
      });
    });

    return transactions
      .sort(
        (a, b) =>
          (b.createdAt?.getTime() ?? 0) -
          (a.createdAt?.getTime() ?? 0),
      )
      .slice(0, overallLimit);
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
    cards: CardSummary[];
    transactions: TransactionSummary[];
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

    const cardSection = args.cards.length
      ? args.cards
          .map((card) => {
            const alias =
              card.maskedNumber ??
              (card.id ? `****${card.id.slice(-4)}` : 'Tarjeta');
            return `- ${alias} (${card.cardType ?? 'tarjeta'}) · estado ${
              card.status ?? 'desconocido'
            }${card.cardBrand ? ` · marca ${card.cardBrand}` : ''}`;
          })
          .join('\n')
      : '- No hay tarjetas asociadas a las cuentas actuales.';

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

    const accountLookup = new Map(
      args.accounts.map((account) => {
        const alias =
          account.accountNumber && account.accountNumber.length >= 4
            ? `****${account.accountNumber.slice(-4)}`
            : account.id;
        return [account.id, alias];
      }),
    );

    const cardLookup = new Map(
      args.cards.map((card) => [card.id, card.maskedNumber ?? `****${card.id.slice(-4)}`]),
    );

    const transactionSection = args.transactions.length
      ? args.transactions
          .map((tx) => {
            const target =
              tx.refType === 'card'
                ? `Tarjeta ${cardLookup.get(tx.refId) ?? tx.refId}`
                : `Cuenta ${accountLookup.get(tx.refId) ?? tx.refId}`;
            const net = tx.credit - tx.debit;
            const amount =
              net !== 0
                ? `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net), tx.currency)}`
                : formatCurrency(tx.credit || tx.debit || 0, tx.currency);
            const concept =
              tx.metadata?.description ||
              tx.metadata?.concept ||
              tx.type ||
              'Movimiento';
            return `- ${this.formatDate(tx.createdAt)} · ${target} · ${concept} · ${amount}`;
          })
          .join('\n')
      : '- No se encontraron movimientos recientes en tus cuentas o tarjetas.';

    return [
      `### Usuario autenticado`,
      `- Nombre visible: ${args.userName ?? 'sin nombre'}`,
      `- userId: ${args.userId}`,
      `- microfinancieraId: ${args.microfinancieraId}`,
      ``,
      `### Cuentas (${args.accounts.length})`,
      accountSection,
      ``,
      `### Tarjetas (${args.cards.length})`,
      cardSection,
      ``,
      `### Créditos (${args.loans.length})`,
      loanSection,
      ``,
      `### Movimientos recientes`,
      transactionSection,
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

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    if (chunkSize <= 0) return [array];
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
