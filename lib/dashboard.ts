export interface TodayApproval {
  offerId: string;
  candidateName: string;
  jobTitle: string;
  baseSalary: number;
  currency: string;
  sequence: number;
}

export interface TodayInterview {
  id: string;
  type: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  videoLink: string | null;
  candidateName: string;
  jobTitle: string;
  panelists: string[];
}

export interface TodayCv {
  documentId: string;
  candidateId: string;
  candidateName: string;
  jobId: string;
  jobTitle: string;
  uploadedAt: string;
}

export interface TodayOverdueTask {
  taskId: string;
  candidateId: string;
  candidateName: string;
  jobTitle: string;
  title: string;
  dueDate: string;
  status: string;
}

export interface TodayDashboardDto {
  approvals: TodayApproval[];
  interviews: TodayInterview[];
  recentCvs: TodayCv[];
  overdueTasks: TodayOverdueTask[];
}
