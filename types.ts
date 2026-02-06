
export type DocType = 'syllabus' | 'midterm_overview' | 'textbook';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: DocType;
  courseCode: string;
  status: 'pending' | 'uploading' | 'complete' | 'error';
}

export interface Course {
  id: string;
  code: string;
  name: string;
  examDate: string;
  color: string;
}

export interface Constraints {
  weekdayHours: number;
  weekendHours: number;
  noStudyDates: string[];
  reviewFrequency: 'daily' | 'every_2_days' | 'weekly';
}

export interface StudyTask {
  date: string;
  course: string;
  courseColor: string;
  topic: string;
  task_type: 'learn' | 'practice' | 'review';
  duration_hours: number;
  resources: string;
  notes: string;
  isCompleted?: boolean;
  isFlagged?: boolean;
}

export interface AgentLog {
  agent: string;
  message: string;
  timestamp: string;
  status: 'loading' | 'success' | 'error';
}

export type ViewState = 'setup' | 'planning' | 'results';
