
import React from 'react';
import { Course, UploadedFile, Constraints, DocType } from '../types';

interface SetupViewProps {
  courses: Course[];
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  constraints: Constraints;
  setConstraints: React.Dispatch<React.SetStateAction<Constraints>>;
  onStart: () => void;
  onAddCourse: () => void;
  onRemoveCourse: (id: string) => void;
  onUpdateCourse: (id: string, updates: Partial<Course>) => void;
}

const SetupView: React.FC<SetupViewProps> = ({ 
  courses, 
  files, 
  setFiles, 
  constraints, 
  setConstraints, 
  onStart,
  onAddCourse,
  onRemoveCourse,
  onUpdateCourse
}) => {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, courseCode: string, type: DocType) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((f: File) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: f.name,
        size: f.size,
        type,
        courseCode,
        status: 'complete' as const
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const isCourseComplete = (code: string) => {
    const types: DocType[] = ['syllabus', 'midterm_overview', 'textbook'];
    return types.every(t => files.some(f => f.courseCode === code && f.type === t));
  };

  const isReady = courses.length > 0 && courses.every(c => isCourseComplete(c.code));
  
  const totalFilesNeeded = courses.length * 3;
  const currentFilesCount = files.length;
  const missingFilesCount = Math.max(0, totalFilesNeeded - currentFilesCount);

  return (
    <div className="space-y-16 animate-in fade-in duration-1000">
      <section className="space-y-6">
        <div className="flex items-center gap-4 mb-2">
          <span className="h-[1px] w-12 bg-gray-200"></span>
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#a7b8a1]">Phase 01: Ingestion</span>
        </div>
        <h1 className="serif text-6xl font-bold text-[#4a5d45] tracking-tight leading-[1.1] max-w-3xl">
          Construct your curriculum architecture.
        </h1>
        <p className="text-gray-400 text-xl max-w-2xl leading-relaxed font-medium">
          Upload your raw materials. For every node in your curriculum, we require a triad of data: Syllabus, Overview, and Textbook.
        </p>
      </section>

      {courses.length === 0 ? (
        <div className="py-20 border-2 border-dashed border-gray-100 rounded-[3rem] bg-white flex flex-col items-center justify-center space-y-8 group transition-all hover:border-[#a7b8a1]/30">
          <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 group-hover:scale-110 group-hover:bg-[#4a5d45]/5 group-hover:text-[#4a5d45] transition-all duration-500">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
          </div>
          <div className="text-center space-y-2">
            <h3 className="serif text-2xl font-bold text-gray-300">Your Dashboard is Empty</h3>
            <p className="text-gray-400 text-sm font-medium tracking-wide">Initialize your first course module to begin the mapping process.</p>
          </div>
          <button 
            onClick={onAddCourse}
            className="px-8 py-4 bg-[#4a5d45] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:shadow-xl hover:-translate-y-1 transition-all"
          >
            Create First Module
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {courses.map(course => (
            <div key={course.id} className="group relative bg-white border border-gray-100 rounded-[3rem] p-10 shadow-sm hover:shadow-2xl transition-all duration-700 hover:-translate-y-2">
              <button 
                onClick={() => onRemoveCourse(course.id)}
                className="absolute top-8 right-8 p-2.5 rounded-full hover:bg-red-50 text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 z-10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>

              <div className="space-y-4 mb-10">
                <input 
                  className="serif text-3xl font-bold text-[#4a5d45] w-full bg-transparent focus:outline-none border-b border-transparent focus:border-[#a7b8a1]/20 transition-all placeholder:opacity-20"
                  value={course.code}
                  onChange={e => onUpdateCourse(course.id, { code: e.target.value })}
                  placeholder="EXAM 101"
                />
                <input 
                  className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400 w-full bg-transparent focus:outline-none placeholder:opacity-20"
                  value={course.name}
                  onChange={e => onUpdateCourse(course.id, { name: e.target.value })}
                  placeholder="Module Description"
                />
                <div className="flex items-center gap-4 pt-4">
                  <span className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-300">Target</span>
                  <input 
                    type="date"
                    className="text-[10px] font-mono font-bold bg-[#fdfdfb] px-4 py-2 rounded-full border border-gray-100 text-[#4a5d45] focus:outline-none focus:ring-2 focus:ring-[#4a5d45]/10 shadow-sm"
                    value={course.examDate}
                    onChange={e => onUpdateCourse(course.id, { examDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-4">
                {(['syllabus', 'midterm_overview', 'textbook'] as DocType[]).map(type => {
                  const existingFile = files.find(f => f.courseCode === course.code && f.type === type);
                  return (
                    <div key={type} className="relative">
                      <label className={`block w-full text-left p-5 rounded-3xl border transition-all cursor-pointer ${
                        existingFile ? 'bg-[#4a5d45]/5 border-[#4a5d45]/10 shadow-inner' : 'bg-[#fdfdfb] border-gray-50 hover:border-[#a7b8a1] hover:bg-white shadow-sm'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-5">
                            <div className={`p-3 rounded-2xl transition-all duration-500 ${existingFile ? 'bg-[#4a5d45] text-white shadow-xl shadow-[#4a5d45]/30' : 'bg-white text-gray-200 border border-gray-50'}`}>
                              {existingFile ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                              ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M16 10l-4 4m0 0l-4-4m4 4V4" /></svg>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className={`text-[9px] font-black uppercase tracking-[0.3em] mb-1 transition-colors ${existingFile ? 'text-[#4a5d45]' : 'text-gray-300'}`}>
                                {type.replace('_', ' ')}
                              </p>
                              <p className={`text-xs font-bold truncate max-w-[160px] transition-colors ${existingFile ? 'text-gray-700' : 'text-gray-400'}`}>
                                {existingFile ? existingFile.name : 'Ingest Document'}
                              </p>
                            </div>
                          </div>
                          {existingFile && (
                            <button 
                              onClick={(e) => { e.preventDefault(); removeFile(existingFile.id); }}
                              className="p-2.5 hover:bg-white rounded-full text-gray-300 hover:text-red-400 transition-all shadow-sm"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          )}
                        </div>
                        <input 
                          type="file" 
                          className="hidden" 
                          accept=".pdf"
                          onChange={(e) => handleFileUpload(e, course.code, type)}
                          disabled={!!existingFile}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <button 
            onClick={onAddCourse}
            className="flex flex-col items-center justify-center p-12 rounded-[3rem] border-2 border-dashed border-gray-100 text-gray-200 hover:border-[#a7b8a1] hover:text-[#4a5d45] transition-all group min-h-[450px] hover:bg-white/50"
          >
            <div className="w-16 h-16 rounded-full border-2 border-current flex items-center justify-center mb-8 group-hover:scale-110 group-hover:rotate-90 transition-all duration-700 ease-out">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.5em] group-hover:tracking-[0.7em] transition-all">Expand Matrix</span>
          </button>
        </div>
      )}

      <div className="bg-[#f8f9f7] rounded-[4rem] p-20 max-w-5xl mx-auto space-y-20 border border-gray-100 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#4a5d45]/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
        
        <div className="text-center space-y-6 relative z-10">
          <h3 className="serif text-5xl font-bold text-[#4a5d45]">Operational Boundaries.</h3>
          <p className="text-gray-400 font-medium text-lg max-w-md mx-auto leading-relaxed">Quantify your temporal constraints for the agent scheduling algorithm.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-24 relative z-10">
          <div className="space-y-8">
            <div className="flex justify-between items-end">
              <label className="text-[11px] font-black text-[#4a5d45] uppercase tracking-[0.4em]">Weekday Load</label>
              <span className="serif text-4xl font-bold text-[#4a5d45]">{constraints.weekdayHours}<span className="text-sm ml-1.5 opacity-40 italic font-medium">H</span></span>
            </div>
            <div className="relative pt-2">
              <input 
                type="range" min="1" max="12" 
                value={constraints.weekdayHours}
                onChange={e => setConstraints({...constraints, weekdayHours: parseInt(e.target.value)})}
                className="w-full accent-[#4a5d45] h-2.5 bg-gray-200 rounded-full appearance-none cursor-pointer" 
              />
              <div className="flex justify-between mt-4 px-1">
                {[2, 4, 6, 8, 10, 12].map(v => <span key={v} className="text-[9px] font-black text-gray-300">{v}</span>)}
              </div>
            </div>
          </div>
          <div className="space-y-8">
            <div className="flex justify-between items-end">
              <label className="text-[11px] font-black text-[#4a5d45] uppercase tracking-[0.4em]">Weekend Load</label>
              <span className="serif text-4xl font-bold text-[#4a5d45]">{constraints.weekendHours}<span className="text-sm ml-1.5 opacity-40 italic font-medium">H</span></span>
            </div>
            <div className="relative pt-2">
              <input 
                type="range" min="1" max="16" 
                value={constraints.weekendHours}
                onChange={e => setConstraints({...constraints, weekendHours: parseInt(e.target.value)})}
                className="w-full accent-[#4a5d45] h-2.5 bg-gray-200 rounded-full appearance-none cursor-pointer" 
              />
              <div className="flex justify-between mt-4 px-1">
                {[4, 8, 12, 16].map(v => <span key={v} className="text-[9px] font-black text-gray-300">{v}</span>)}
              </div>
            </div>
          </div>
        </div>
        
        <div className="pt-10 flex flex-col items-center gap-10 relative z-10">
          <button 
            onClick={onStart}
            disabled={!isReady}
            className={`px-24 py-7 rounded-full text-[12px] font-black uppercase tracking-[0.5em] transition-all shadow-2xl ${
              isReady 
              ? 'bg-[#4a5d45] text-white hover:scale-105 active:scale-95 shadow-[#4a5d45]/40 hover:bg-[#3d4d38]' 
              : 'bg-gray-100 text-gray-300 cursor-not-allowed shadow-none'
            }`}
          >
            Initiate Orchestration
          </button>
          {!isReady && courses.length > 0 && (
            <div className="flex items-center gap-4 text-amber-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              {missingFilesCount} Required data points pending across {courses.length} modules
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetupView;
