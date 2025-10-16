export interface RoutingRule {
  id: string;
  district: string;
  branchId: string;
  priority: number;
  isActive: boolean;
}

export interface Branch {
  id: string;
  microfinancieraId: string;
  name: string;
  code: string;
  district: string;
  address: string;
  phone: string;
  capacity: number;
  operatingHours: string;
  isActive: boolean;
  agentCount: number;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface Agent {
  id: string;
  userId: string;
  microfinancieraId: string;
  branchId: string;
  employeeCode: string;
  position: string;
  isActive: boolean;
  maxConcurrentLoans: number;
  currentLoanCount: number;
  specializations?: string[];
  workingHours: string;
  metrics?: {
    loansProcessed: number;
    approvalRate: number;
    avgProcessingTime: number;
  };
}

