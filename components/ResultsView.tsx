
import React, { useState, useMemo, useEffect } from 'react';
import { StudyTask } from '../types';

interface ResultsViewProps {
  plan: StudyTask[];
}

const ResultsView: React.FC<ResultsViewProps> = ({ plan: initialPlan }) => {
  const [activeTab, setActiveTab] = useState<'list' | 'calendar' | 'curriculum'>('curriculum');
  const [localPlan, setLocalPlan] = useState<StudyTask[]>(initialPlan);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);

  useEffect(() => {
    setLocalPlan(initialPlan);
  }, [initialPlan]);

  const updateTask = (topicId: string, updates: Partial<StudyTask>) => {
    setLocalPlan(prev => prev.map(t => {
      const id = `${t.course}-${t.topic}`;
      return id === topicId ? { ...t, ...updates } : t;
    }));
  };

  const groupedPlan = useMemo(() => localPlan.reduce((acc, curr) => {
    acc[curr.date] = acc[curr.date] || [];
    acc[curr.date].push(curr);
    return acc;
  }, {} as Record<string, StudyTask[]>), [localPlan]);

  const sortedDates = useMemo(() => Object.keys(groupedPlan).sort(), [groupedPlan]);

  const curriculumData = useMemo(() => {
    const data: Record<string, { color: string, topics: StudyTask[] }> = {};
    localPlan.forEach(t => {
      if (!data[t.course]) data[t.course] = { color: t.courseColor, topics: [] };
      if (!data[t.course].topics.some(item => item.topic === t.topic)) {
        data[t.course].topics.push(t);
      }
    });
    return data;
  }, [localPlan]);

  const calendarDays = useMemo(() => {
    if (sortedDates.length === 0) return [];
    // Anchor the calendar to the first visible study date
    const anchorDate = new Date(sortedDates[0]);
    const start = new Date(anchorDate);
    start.setDate(anchorDate.getDate() - anchorDate.getDay());
    
    const days = [];
    // Fixed 42-day window (6 weeks) ensures a consistent grid without empty gaps
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [sortedDates]);

  const scrollToDate = (date: string) => {
    setSelectedDayDate(date);
    setActiveTab('list');
    setTimeout(() => {
      const el = document.getElementById(`date-${date}`);
      if (el) {
        window.scrollTo({ top: el.offsetTop - 120, behavior: 'smooth' });
      }
    }, 100);
  };

  const TopicDebrief = () => {
    if (!selectedTopicId) return null;
    const task = localPlan.find(t => `${t.course}-${t.topic}` === selectedTopicId);
    if (!task) return null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#4a5d45]/20 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setSelectedTopicId(null)}>
        <div className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500" onClick={(e) => e.stopPropagation()}>
          <div className="p-10 space-y-8">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: task.courseColor }}></div>
                  <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-300">{task.course}</span>
                </div>
                <h2 className="serif text-4xl font-bold text-[#4a5d45] tracking-tight">{task.topic}</h2>
              </div>
              <button onClick={() => setSelectedTopicId(null)} className="p-3 bg-gray-50 rounded-full text-gray-300 hover:text-gray-500 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1]">Study Date</label>
                <input type="date" value={task.date} onChange={(e) => updateTask(selectedTopicId, { date: e.target.value })} className="w-full bg-[#fdfdfb] border border-gray-100 rounded-2xl px-5 py-3 text-sm font-bold text-[#4a5d45] focus:outline-none focus:ring-2 focus:ring-[#4a5d45]/10" />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1]">Study Time (H)</label>
                <input type="number" value={task.duration_hours} onChange={(e) => updateTask(selectedTopicId, { duration_hours: parseFloat(e.target.value) })} className="w-full bg-[#fdfdfb] border border-gray-100 rounded-2xl px-5 py-3 text-sm font-bold text-[#4a5d45] focus:outline-none focus:ring-2 focus:ring-[#4a5d45]/10" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100/50">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-3">Resources</label>
                <p className="text-sm font-medium text-gray-600 italic">"{task.resources}"</p>
              </div>
              <div className="p-6 bg-white border border-gray-100 rounded-[2rem] shadow-sm">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-3">Study Notes</label>
                <p className="text-sm text-gray-500 leading-relaxed font-medium">{task.notes}</p>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button 
                onClick={() => updateTask(selectedTopicId, { isCompleted: !task.isCompleted })}
                className={`flex-1 py-5 rounded-3xl text-[11px] font-black uppercase tracking-[0.4em] transition-all ${
                  task.isCompleted ? 'bg-gray-100 text-gray-400' : 'bg-[#4a5d45] text-white shadow-xl shadow-[#4a5d45]/20 hover:scale-[1.02]'
                }`}
              >
                {task.isCompleted ? 'Mark Incomplete' : 'Mark Done'}
              </button>
              <button 
                onClick={() => updateTask(selectedTopicId, { isFlagged: !task.isFlagged })}
                className={`px-8 py-5 rounded-3xl transition-all border ${
                  task.isFlagged ? 'bg-red-50 border-red-100 text-red-500' : 'bg-white border-gray-100 text-gray-300 hover:text-red-400'
                }`}
              >
                <svg className="w-5 h-5" fill={task.isFlagged ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const DayDebrief = () => {
    if (!selectedDayDate) return null;
    const tasks = groupedPlan[selectedDayDate] || [];
    const displayDate = new Date(selectedDayDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#4a5d45]/20 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setSelectedDayDate(null)}>
        <div className="bg-[#fdfdfb] w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-12 duration-500" onClick={(e) => e.stopPropagation()}>
          <div className="p-12 space-y-10">
            <div className="flex justify-between items-center">
              <div className="space-y-2">
                <span className="text-[11px] font-black uppercase tracking-[0.5em] text-[#a7b8a1]">Selected Day</span>
                <h2 className="serif text-4xl font-bold text-[#4a5d45]">{displayDate}</h2>
              </div>
              <button onClick={() => setSelectedDayDate(null)} className="p-3 bg-white border border-gray-100 rounded-full text-gray-300 hover:text-gray-500 shadow-sm transition-all">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-6 max-h-[50vh] overflow-y-auto pr-4 custom-scrollbar">
              {tasks.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-gray-100 rounded-[2.5rem]"><p className="serif text-xl text-gray-300">Nothing scheduled.</p></div>
              ) : (
                tasks.map((t, idx) => (
                  <div key={idx} onClick={() => { setSelectedDayDate(null); setSelectedTopicId(`${t.course}-${t.topic}`); }} className="group bg-white p-8 rounded-[2.5rem] border border-gray-50 shadow-sm hover:shadow-xl transition-all cursor-pointer relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: t.courseColor }}></div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#a7b8a1]">{t.course} • {t.task_type}</span>
                      <span className="serif text-xl font-bold text-[#4a5d45]">{t.duration_hours}h</span>
                    </div>
                    <h4 className="serif text-2xl font-bold text-gray-800 tracking-tight group-hover:text-[#4a5d45] transition-colors">{t.topic}</h4>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-16 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <TopicDebrief />
      <DayDebrief />

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 border-b border-gray-100 pb-16 relative">
        <div className="space-y-6 relative z-10">
          <div className="flex items-center gap-4 mb-2">
            <span className="h-[1px] w-16 bg-[#4a5d45]/20"></span>
            <span className="text-[11px] font-black uppercase tracking-[0.5em] text-[#a7b8a1]">Dashboard</span>
          </div>
          <h1 className="serif text-7xl font-bold text-[#4a5d45] tracking-tighter leading-none">The Roadmap.</h1>
          <p className="text-gray-400 font-medium text-xl leading-relaxed max-w-2xl">
            Track study sessions, visualize your curriculum, and stay on course.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-5 items-center relative z-10">
          <div className="flex bg-[#f8f9f7] p-2 rounded-[1.5rem] border border-gray-100 shadow-sm">
            <button onClick={() => setActiveTab('curriculum')} className={`px-7 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${activeTab === 'curriculum' ? 'bg-white text-[#4a5d45] shadow-xl scale-105' : 'text-gray-300 hover:text-gray-500'}`}>Dashboard</button>
            <button onClick={() => setActiveTab('calendar')} className={`px-7 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${activeTab === 'calendar' ? 'bg-white text-[#4a5d45] shadow-xl scale-105' : 'text-gray-300 hover:text-gray-500'}`}>Calendar</button>
            <button onClick={() => setActiveTab('list')} className={`px-7 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${activeTab === 'list' ? 'bg-white text-[#4a5d45] shadow-xl scale-105' : 'text-gray-300 hover:text-gray-500'}`}>Timeline</button>
          </div>
        </div>
      </div>

      {activeTab === 'curriculum' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 animate-in fade-in zoom-in-95 duration-700">
          {Object.entries(curriculumData).map(([course, data]) => {
            const completed = data.topics.filter(t => t.isCompleted).length;
            const percentage = Math.round((completed / data.topics.length) * 100);
            return (
              <div key={course} className="bg-white border border-gray-100 rounded-[3rem] p-12 shadow-sm hover:shadow-2xl transition-all flex flex-col group relative overflow-hidden">
                <div className="flex items-center justify-between mb-8 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-4 h-4 rounded-full shadow-lg" style={{ backgroundColor: data.color }}></div>
                    <h3 className="serif text-4xl font-bold text-[#4a5d45] tracking-tight">{course}</h3>
                  </div>
                  <button onClick={() => setActiveTab('list')} className="text-[9px] font-black uppercase tracking-widest text-[#a7b8a1] hover:text-[#4a5d45] transition-all border border-gray-100 px-4 py-1.5 rounded-full">
                    View Timeline
                  </button>
                </div>
                <div className="space-y-4 mb-10 relative z-10">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-300">Mastery</span>
                    <span className="serif text-2xl font-bold text-[#4a5d45]">{percentage}%</span>
                  </div>
                  <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100 shadow-inner">
                    <div className="h-full transition-all duration-1000 ease-out shadow-lg" style={{ width: `${percentage}%`, backgroundColor: data.color }}></div>
                  </div>
                </div>
                <div className="space-y-4 flex-1 relative z-10">
                  {data.topics.map((t, idx) => {
                    const id = `${t.course}-${t.topic}`;
                    return (
                      <div key={idx} className={`p-6 rounded-[2rem] border transition-all flex items-center justify-between group/item cursor-pointer ${t.isCompleted ? 'bg-gray-50 border-gray-100 opacity-40 grayscale' : 'bg-[#fdfdfb] border-gray-50 hover:border-[#a7b8a1] hover:bg-white shadow-sm hover:scale-[1.03]'}`} onClick={() => setSelectedTopicId(id)}>
                        <div className="flex items-center gap-5 min-w-0">
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${t.isCompleted ? 'bg-[#4a5d45] border-[#4a5d45] text-white' : 'border-gray-100'}`}>
                            {t.isCompleted && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-bold truncate ${t.isCompleted ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.topic}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-300">{new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#a7b8a1]">{t.task_type}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="bg-white border border-gray-100 rounded-[4rem] p-10 lg:p-16 shadow-sm hover:shadow-2xl transition-all duration-1000 animate-in fade-in slide-in-from-right-8 h-auto max-w-6xl mx-auto overflow-hidden">
          <div className="flex flex-col">
            <div className="grid grid-cols-7 mb-8 border-b border-gray-50 pb-6">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-[10px] font-black uppercase tracking-[0.6em] text-[#a7b8a1]">{day}</div>
              ))}
            </div>
            {/* The grid is consistently 6 rows to prevent empty voids and layouts shifts */}
            <div 
              className="grid grid-cols-7 gap-px bg-gray-50 rounded-[3rem] overflow-hidden border border-gray-100 shadow-inner"
              style={{ gridTemplateRows: 'repeat(6, minmax(110px, 1fr))' }}
            >
              {calendarDays.map((date, idx) => {
                const dateStr = date.toISOString().split('T')[0];
                const dayTasks = groupedPlan[dateStr] || [];
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                const anchorDate = new Date(sortedDates[0]);
                const isDifferentMonth = date.getMonth() !== anchorDate.getMonth();
                
                return (
                  <div 
                    key={idx} 
                    onClick={() => setSelectedDayDate(dateStr)} 
                    className="p-4 bg-white hover:bg-[#fdfdfb] transition-all relative group/cell cursor-pointer flex flex-col gap-2 min-h-[110px]"
                  >
                    <span className={`text-sm font-serif font-bold transition-all self-start ${
                      isToday ? 'bg-[#4a5d45] text-white w-7 h-7 flex items-center justify-center rounded-full shadow-lg' : 
                      isDifferentMonth ? 'text-gray-100' : 'text-gray-200 group-hover/cell:text-[#a7b8a1]'
                    }`}>
                      {date.getDate()}
                    </span>
                    {dayTasks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-auto pb-1">
                        {dayTasks.slice(0, 5).map((t, i) => (
                          <div key={i} className="w-2.5 h-2.5 rounded-full border border-white shadow-sm" style={{ backgroundColor: t.courseColor }} title={`${t.course}: ${t.topic}`}></div>
                        ))}
                        {dayTasks.length > 5 && <span className="text-[8px] font-bold text-gray-300 ml-1">+{dayTasks.length - 5}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'list' && (
        <div className="space-y-16 max-w-5xl mx-auto">
          {sortedDates.map((date, dIdx) => (
            <div key={date} id={`date-${date}`} className="relative pl-24 animate-in fade-in slide-in-from-left-8" style={{ animationDelay: `${dIdx * 50}ms` }}>
              <div className="absolute left-10 top-0 bottom-0 w-[1px] bg-gray-100"></div>
              <div className={`absolute left-[33px] top-4 w-4 h-4 rounded-full ring-[12px] ring-white shadow-2xl ${selectedDayDate === date ? 'bg-[#4a5d45] scale-150 rotate-45' : 'bg-gray-100'}`}></div>
              <div className="mb-10"><h3 className={`serif text-4xl font-bold transition-all duration-700 ${selectedDayDate === date ? 'text-[#4a5d45] translate-x-2' : 'text-gray-400'}`}>{new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3></div>
              <div className="grid gap-10">
                {groupedPlan[date].map((task, idx) => {
                  const id = `${task.course}-${task.topic}`;
                  return (
                    <div key={idx} onClick={() => setSelectedTopicId(id)} className={`flex flex-col md:flex-row gap-10 p-12 rounded-[4rem] bg-white border border-gray-50 transition-all group overflow-hidden relative cursor-pointer ${task.isCompleted ? 'opacity-40' : ''} ${selectedDayDate === date ? 'shadow-2xl ring-1 ring-[#4a5d45]/10' : 'hover:shadow-2xl shadow-sm'}`}>
                      <div className="absolute left-0 top-0 bottom-0 w-2.5 transition-all group-hover:w-4" style={{ backgroundColor: task.courseColor }}></div>
                      <div className="md:w-52 shrink-0"><span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-200 block mb-4">Course</span><span className="serif text-3xl font-bold text-gray-800 tracking-tighter leading-none">{task.course}</span></div>
                      <div className="flex-1 space-y-6">
                        <div className="flex items-center gap-5"><span className="text-[10px] font-black uppercase tracking-[0.3em] px-5 py-2 rounded-full shadow-inner bg-gray-50 text-gray-600">{task.task_type}</span><h4 className={`serif text-3xl font-bold text-gray-800 tracking-tight leading-none group-hover:text-[#4a5d45] transition-colors ${task.isCompleted ? 'line-through opacity-50' : ''}`}>{task.topic}</h4></div>
                        <p className="text-sm text-gray-400 font-medium tracking-tight border-l-2 border-gray-100 pl-4">{task.resources}</p>
                      </div>
                      <div className="md:w-40 md:text-right shrink-0 flex flex-col justify-center border-l border-gray-50 md:pl-10"><span className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-200 block mb-3">Time</span><span className="serif text-6xl font-bold text-[#4a5d45] tracking-tighter leading-none">{task.duration_hours}<span className="text-base align-top ml-1 font-bold italic opacity-30">H</span></span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-center py-32 border-t border-gray-100 mt-32 space-y-8">
        <div className="flex justify-center gap-4 opacity-20">{[1, 2, 3].map(i => <div key={i} className="w-2 h-2 rounded-full bg-[#4a5d45]"></div>)}</div>
        <p className="text-gray-300 text-[12px] font-black uppercase tracking-[0.8em]">prep(x) Logic Verified</p>
      </div>
    </div>
  );
};

export default ResultsView;
