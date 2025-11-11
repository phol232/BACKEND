import { getFirestore } from 'firebase-admin/firestore';

import { Timestamp } from 'firebase-admin/firestore';

export class ExportService {
  private get db() {
    return getFirestore();
  }

  async exportToCSV(data: any[], headers: string[]): Promise<string> {
    const csvRows: string[] = [];

    // Headers
    csvRows.push(headers.join(','));

    // Data rows
    for (const row of data) {
      const values = headers.map((header) => {
        const value = this.getNestedValue(row, header);
        // Escape commas and quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value || '';
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }

  async exportToExcel(data: any[], headers: string[]): Promise<Buffer> {
    // Para Excel necesitaríamos una librería como exceljs
    // Por ahora retornamos CSV como Excel
    const csv = await this.exportToCSV(data, headers);
    return Buffer.from(csv, 'utf-8');
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  formatDate(date: Date | Timestamp | string | any): string {
    if (!date) return '';
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    if (typeof date === 'string') {
      return date.split('T')[0];
    }
    // Firestore Timestamp
    if (date && typeof date === 'object' && 'toDate' in date) {
      return date.toDate().toISOString().split('T')[0];
    }
    return '';
  }
}

