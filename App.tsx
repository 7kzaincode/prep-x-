
import React, { useState } from 'react';
import { Logo } from './constants';
import { ViewState, UploadedFile, Course, Constraints, StudyTask } from './types';
import SetupView from './components/SetupView';
import PlanningView from './components/PlanningView';
import ResultsView from './components/ResultsView';

const COURSE_COLORS = ['#4a5d45', '#8c7851', '#51688c', '#8c5151', '#518c86'];

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('setup');
  const [courses, setCourses] = useState<Course[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [constraints, setConstraints] = useState<Constraints>({
    weekdayHours: 3,
    weekendHours: 6,
    noStudyDates: [],
    reviewFrequency: 'every_2_days',
  });
  const [plan, setPlan] = useState<StudyTask[]>([]);

  const handleStartPlanning = () => {
    setCurrentView('planning');
  };

  const handlePlanningComplete = (generatedPlan: StudyTask[]) => {
    setPlan(generatedPlan);
    setCurrentView('results');
  };

  const loadDemoData = () => {
    const demoCourses: Course[] = [
      { id: '1', code: 'PHYS 234', name: 'Quantum Mechanics', examDate: '2026-02-26', color: COURSE_COLORS[2] },
      { id: '2', code: 'SYSD 300', name: 'Business Dynamics', examDate: '2026-02-24', color: COURSE_COLORS[1] },
      { id: '3', code: 'HLTH 204', name: 'Biostatistics', examDate: '2026-02-27', color: COURSE_COLORS[0] },
    ];

    const demoFiles: UploadedFile[] = [];
    demoCourses.forEach(c => {
      ['syllabus', 'midterm_overview', 'textbook'].forEach(t => {
        demoFiles.push({
          id: Math.random().toString(36).substr(2, 9),
          name: `${c.code}_${t}.pdf`,
          size: 1024 * 1024 * (t === 'textbook' ? 50 : 2),
          type: t as any,
          courseCode: c.code,
          status: 'complete'
        });
      });
    });

    const demoPlan: StudyTask[] = [];
    const today = new Date();
    const endDate = new Date('2026-02-27');
    const diffDays = Math.ceil(Math.abs(endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const topics = [
      "Eigenvalues & State Vectors",
      "Schrödinger Equation Applications",
      "Feedback Loop Modeling",
      "Normal Distribution Theory",
      "Stochastic Processes",
      "Causal Loop Diagrams",
      "Wave-Particle Duality",
      "Confidence Interval Analysis"
    ];

    for (let i = 0; i <= diffDays; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];
      const course = demoCourses[i % demoCourses.length];
      
      demoPlan.push({
        date: dateStr,
        course: course.code,
        courseColor: course.color,
        topic: topics[i % topics.length],
        task_type: i % 3 === 0 ? 'review' : 'learn',
        duration_hours: i % 2 === 0 ? 2 : 3.5,
        resources: `Ch ${Math.floor(Math.random() * 10) + 1} of ${course.name} Core Text`,
        notes: "Automated synthesis of high-yield topics based on midterm overview alignment."
      });
    }

    setCourses(demoCourses);
    setFiles(demoFiles);
    setPlan(demoPlan);
    setCurrentView('results');
  };

  const addCourse = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    setCourses([...courses, { 
      id: newId, 
      code: `COURSE ${courses.length + 1}`, 
      name: 'Enter Course Name', 
      examDate: new Date(2026, 1, 27).toISOString().split('T')[0],
      color: COURSE_COLORS[courses.length % COURSE_COLORS.length]
    }]);
  };

  const removeCourse = (id: string) => {
    const courseToRemove = courses.find(c => c.id === id);
    if (courseToRemove) {
      setCourses(courses.filter(c => c.id !== id));
      setFiles(files.filter(f => f.courseCode !== courseToRemove.code));
    }
  };

  const updateCourse = (id: string, updates: Partial<Course>) => {
    const oldCourse = courses.find(c => c.id === id);
    if (oldCourse && updates.code && updates.code !== oldCourse.code) {
      setFiles(files.map(f => f.courseCode === oldCourse.code ? { ...f, courseCode: updates.code! } : f));
    }
    setCourses(courses.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  return (
    <div className="min-h-screen bg-[#fdfdfb] flex flex-col selection:bg-[#4a5d45] selection:text-white">
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <button onClick={() => setCurrentView('setup')} className="hover:opacity-80 transition-opacity">
              <Logo />
            </button>
            {currentView === 'setup' && (
              <button 
                onClick={loadDemoData}
                className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] hover:text-[#4a5d45] transition-colors border border-[#a7b8a1]/20 px-4 py-2 rounded-full hidden sm:block"
              >
                Inject Demo Matrix
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-8 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
              <span className={`transition-colors ${currentView === 'setup' ? 'text-[#4a5d45]' : ''}`}>01. Setup</span>
              <span className={`transition-colors ${currentView === 'planning' ? 'text-[#4a5d45]' : ''}`}>02. Orchestration</span>
              <span className={`transition-colors ${currentView === 'results' ? 'text-[#4a5d45]' : ''}`}>03. Results</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 py-12">
        {currentView === 'setup' && (
          <SetupView 
            courses={courses} 
            files={files} 
            setFiles={setFiles}
            constraints={constraints}
            setConstraints={setConstraints}
            onStart={handleStartPlanning}
            onAddCourse={addCourse}
            onRemoveCourse={removeCourse}
            onUpdateCourse={updateCourse}
          />
        )}
        {currentView === 'planning' && (
          <PlanningView 
            onComplete={handlePlanningComplete} 
            files={files} 
            courses={courses}
            constraints={constraints} 
          />
        )}
        {currentView === 'results' && (
          <ResultsView plan={plan} />
        )}
      </main>

      <footer className="border-t border-gray-100 py-12 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
          <p>© 2026 prep(x) INC.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-[#4a5d45] transition-colors">Privacy</a>
            <a href="#" className="hover:text-[#4a5d45] transition-colors">Terms</a>
            <a href="#" className="hover:text-[#4a5d45] transition-colors">Documentation</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
