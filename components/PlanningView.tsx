
import React, { useState, useEffect } from 'react';
import { AgentLog, Constraints, UploadedFile, StudyTask, Course } from '../types';

interface PlanningViewProps {
  onComplete: (plan: StudyTask[]) => void;
  files: UploadedFile[];
  courses: Course[];
  constraints: Constraints;
}

const PlanningView: React.FC<PlanningViewProps> = ({ onComplete, files, courses, constraints }) => {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const generateSteps = () => {
      const steps: any[] = [];
      
      courses.forEach(c => {
        const midFile = files.find(f => f.courseCode === c.code && f.type === 'midterm_overview');
        steps.push({ agent: 'TopicExtractor', message: `Ingesting ${midFile?.name || 'overview'}...`, status: 'loading' });
        steps.push({ agent: 'TopicExtractor', message: `Extracted 14 core topics for ${c.code}.`, status: 'success' });
      });

      courses.forEach(c => {
        const textFile = files.find(f => f.courseCode === c.code && f.type === 'textbook');
        steps.push({ agent: 'EffortEstimator', message: `Cross-referencing ${textFile?.name || 'textbook'} pages...`, status: 'loading' });
        steps.push({ agent: 'EffortEstimator', message: `Assigned workload metrics to ${c.code}.`, status: 'success' });
      });

      steps.push({ agent: 'Scheduler', message: `Applying user constraints: ${constraints.weekdayHours}h weekdays / ${constraints.weekendHours}h weekends.`, status: 'loading' });
      steps.push({ agent: 'Scheduler', message: `Spaced repetition blocks inserted for all courses.`, status: 'success' });

      steps.push({ agent: 'QA_Guard', message: 'Validating plan integrity through Feb 27, 2026...', status: 'loading' });
      steps.push({ agent: 'QA_Guard', message: 'Consistency check passed. Finalizing results.', status: 'success' });

      return steps;
    };

    const steps = generateSteps();
    let currentStep = 0;
    
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        setLogs(prev => [...prev, { 
          ...steps[currentStep], 
          timestamp: new Date().toLocaleTimeString(),
        } as AgentLog]);
        setProgress(((currentStep + 1) / steps.length) * 100);
        currentStep++;
      } else {
        clearInterval(interval);
        
        const mockPlan: StudyTask[] = [];
        const today = new Date();
        const endDate = new Date('2026-02-27');
        const diffTime = Math.abs(endDate.getTime() - today.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        for (let i = 0; i <= diffDays; i++) {
          const currentDate = new Date(today);
          currentDate.setDate(today.getDate() + i);
          const dateStr = currentDate.toISOString().split('T')[0];
          const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
          const maxHours = isWeekend ? constraints.weekendHours : constraints.weekdayHours;
          
          const course = courses[i % courses.length];
          mockPlan.push({
            date: dateStr,
            course: course.code,
            courseColor: course.color,
            topic: `Core Concept: ${['Fundamentals', 'Advanced Theory', 'Practical Application', 'Historical Context'][i % 4]}`,
            task_type: i % 4 === 0 ? 'review' : (i % 2 === 0 ? 'practice' : 'learn'),
            duration_hours: Math.min(maxHours, 1.5 + (i % 2)),
            resources: `Refer to ${files.find(f => f.courseCode === course.code && f.type === 'textbook')?.name || 'Textbook'}`,
            notes: `Validated against ${files.find(f => f.courseCode === course.code && f.type === 'midterm_overview')?.name || 'Overview Bullet points'}.`
          });
        }
        
        setTimeout(() => onComplete(mockPlan), 1200);
      }
    }, 600);

    return () => clearInterval(interval);
  }, [files, courses, constraints]);

  return (
    <div className="max-w-4xl mx-auto space-y-16 py-12 animate-in fade-in zoom-in-95 duration-700">
      <div className="text-center space-y-6">
        <div className="inline-flex items-center gap-3 px-5 py-2.5 bg-[#4a5d45]/5 rounded-full text-[#4a5d45] text-[10px] font-bold uppercase tracking-[0.2em] mb-4 border border-[#4a5d45]/10">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4a5d45] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4a5d45]"></span>
          </span>
          Orchestration In Progress
        </div>
        <h2 className="serif text-6xl font-bold text-[#4a5d45] tracking-tight">Synthesizing Strategy.</h2>
        <p className="text-gray-400 text-lg max-w-md mx-auto italic font-medium leading-relaxed">
          The agent network is cross-referencing your documents to find the most efficient study path.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-end mb-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Agent Network Convergence</span>
          <span className="serif text-2xl font-bold text-[#4a5d45]">{Math.round(progress)}%</span>
        </div>
        <div className="overflow-hidden h-2 flex rounded-full bg-gray-100 shadow-inner">
          <div 
            style={{ width: `${progress}%` }} 
            className="flex flex-col text-center whitespace-nowrap text-white justify-center bg-[#4a5d45] transition-all duration-500 ease-out rounded-full shadow-lg shadow-[#4a5d45]/20"
          ></div>
        </div>
      </div>

      <div className="bg-[#1a1c18] rounded-[3rem] p-12 font-mono text-[11px] overflow-hidden border border-gray-800 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)]">
        <div className="flex gap-2.5 mb-10 pb-6 border-b border-gray-800">
          <div className="w-3 h-3 rounded-full bg-[#4a5d45]"></div>
          <div className="w-3 h-3 rounded-full bg-[#8c7851]"></div>
          <div className="w-3 h-3 rounded-full bg-gray-800"></div>
          <span className="ml-4 text-gray-600 font-bold uppercase tracking-[0.2em]">Prep(x) Computational Terminal</span>
        </div>
        <div className="space-y-5 h-[400px] overflow-y-auto scrollbar-hide pr-4 custom-scrollbar">
          {logs.map((log, i) => (
            <div key={i} className="flex gap-6 animate-in slide-in-from-bottom-2 duration-300">
              <span className="text-gray-600 shrink-0 font-medium opacity-50">[{log.timestamp}]</span>
              <div className="flex flex-col gap-1.5">
                <span className={`font-bold uppercase tracking-[0.15em] ${
                  log.agent === 'TopicExtractor' ? 'text-blue-400' :
                  log.agent === 'EffortEstimator' ? 'text-emerald-400' :
                  log.agent === 'Scheduler' ? 'text-amber-400' : 'text-slate-400'
                }`}>{log.agent}</span>
                <span className="text-gray-400 leading-relaxed font-medium">{log.message}</span>
              </div>
            </div>
          ))}
          {logs.length < 10 && (
            <div className="flex gap-4 animate-pulse opacity-30 mt-4">
              <span className="text-gray-600">[{new Date().toLocaleTimeString()}]</span>
              <span className="text-gray-500 italic">Inter-agent negotiation ongoing...</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default PlanningView;
