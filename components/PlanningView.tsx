
import React, { useState, useEffect, useRef } from 'react';
import { AgentLog, Constraints, UploadedFile, StudyTask, Course } from '../types';
import { API_BASE_URL } from '../App';

interface PlanningViewProps {
  sessionId: string;
  onComplete: (plan: StudyTask[]) => void;
  files: UploadedFile[];
  courses: Course[];
  constraints: Constraints;
}

const AGENT_COLORS: Record<string, string> = {
  SyllabusExpert: 'text-blue-400',
  ExamScopeAnalyst: 'text-emerald-400',
  TocNavigator: 'text-cyan-400',
  StudyGuideGuru: 'text-amber-400',
  ChiefOrchestrator: 'text-purple-400',
  System: 'text-slate-400',
};

const PlanningView: React.FC<PlanningViewProps> = ({ sessionId, onComplete, files, courses, constraints }) => {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const startPlanning = async () => {
      try {
        await fetch(`${API_BASE_URL}/api/plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            courses: courses.map(c => ({ id: c.id, code: c.code, name: c.name, examDate: c.examDate })),
            constraints
          })
        });
      } catch (err) {
        console.error('Error starting plan:', err);
        setError('Failed to connect to server. Is the backend running?');
        return;
      }

      // Use SSE for real-time streaming
      const evtSource = new EventSource(`${API_BASE_URL}/api/plan/${sessionId}/stream`);

      evtSource.onmessage = (event) => {
        try {
          const log = JSON.parse(event.data);

          // Check for done signal
          if (log._done) {
            evtSource.close();

            if (log.status === 'error') {
              setError(log.message);
              return;
            }

            // Fetch the final result
            setProgress(100);
            fetchResult();
            return;
          }

          setLogs(prev => [...prev, log]);

          // Update progress based on log count
          const expectedSteps = (courses.length * 4) + 2; // 4 logs per course + 2 for orchestrator
          setProgress(prev => {
            const newProg = Math.min(90, ((prev / 100 * expectedSteps + 1) / expectedSteps) * 100);
            return Math.max(prev, newProg);
          });
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        // Fallback to polling if SSE fails
        startPolling();
      };

      const fetchResult = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/plan/${sessionId}/result`);
          if (response.ok) {
            const result = await response.json();
            if (Array.isArray(result)) {
              setTimeout(() => onComplete(result), 1500);
            } else if (result.error) {
              setError(result.error);
            }
          }
        } catch (err) {
          console.error('Error fetching result:', err);
        }
      };
    };

    // Polling fallback if SSE is unavailable
    const startPolling = () => {
      const logInterval = setInterval(async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/plan/${sessionId}/logs`);
          if (response.ok) {
            const newLogs = await response.json();
            setLogs(newLogs);
            const expectedSteps = (courses.length * 4) + 2;
            const currentProgress = Math.min(95, (newLogs.length / expectedSteps) * 100);
            setProgress(currentProgress);
          }
        } catch (err) {
          console.error('Error fetching logs:', err);
        }
      }, 2000);

      const resultInterval = setInterval(async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/plan/${sessionId}/result`);
          if (response.ok) {
            const result = await response.json();
            if (Array.isArray(result)) {
              setProgress(100);
              clearInterval(logInterval);
              clearInterval(resultInterval);
              setTimeout(() => onComplete(result), 1500);
            } else if (result.error) {
              setError(result.error);
              clearInterval(logInterval);
              clearInterval(resultInterval);
            }
          }
        } catch (err) {
          console.error('Error fetching result:', err);
        }
      }, 3000);
    };

    startPlanning();
  }, [sessionId, courses, constraints, onComplete]);

  return (
    <div className="max-w-4xl mx-auto space-y-16 py-12 animate-in fade-in zoom-in-95 duration-700">
      <div className="text-center space-y-6">
        <div className="inline-flex items-center gap-3 px-5 py-2.5 bg-[#4a5d45]/5 rounded-full text-[#4a5d45] text-[10px] font-bold uppercase tracking-[0.2em] mb-4 border border-[#4a5d45]/10">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4a5d45] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4a5d45]"></span>
          </span>
          {error ? 'Pipeline Error' : progress >= 100 ? 'Complete' : 'Orchestration In Progress'}
        </div>
        <h2 className="serif text-6xl font-bold text-[#4a5d45] tracking-tight">
          {error ? 'Pipeline Failed.' : progress >= 100 ? 'Strategy Complete.' : 'Synthesizing Strategy.'}
        </h2>
        <p className="text-gray-400 text-lg max-w-md mx-auto italic font-medium leading-relaxed">
          {error
            ? 'An error occurred during agent processing. Check the terminal below for details.'
            : 'The agent network is cross-referencing your documents to find the most efficient study path.'}
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
            className={`flex flex-col text-center whitespace-nowrap text-white justify-center transition-all duration-500 ease-out rounded-full shadow-lg ${
              error ? 'bg-red-500 shadow-red-500/20' : 'bg-[#4a5d45] shadow-[#4a5d45]/20'
            }`}
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
        <div ref={terminalRef} className="space-y-5 h-[400px] overflow-y-auto scrollbar-hide pr-4 custom-scrollbar">
          {logs.map((log, i) => (
            <div key={i} className="flex gap-6 animate-in slide-in-from-bottom-2 duration-300">
              <span className="text-gray-600 shrink-0 font-medium opacity-50">[{log.timestamp}]</span>
              <div className="flex flex-col gap-1.5">
                <span className={`font-bold uppercase tracking-[0.15em] ${AGENT_COLORS[log.agent] || 'text-slate-400'}`}>
                  {log.agent}
                </span>
                <span className={`leading-relaxed font-medium ${log.status === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                  {log.message}
                </span>
              </div>
              {log.status === 'loading' && (
                <span className="shrink-0 self-center">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                </span>
              )}
            </div>
          ))}
          {!error && logs.length === 0 && (
            <div className="flex gap-4 animate-pulse opacity-30 mt-4">
              <span className="text-gray-600">[{new Date().toLocaleTimeString()}]</span>
              <span className="text-gray-500 italic">Initializing agent network...</span>
            </div>
          )}
          {!error && progress < 100 && logs.length > 0 && (
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
