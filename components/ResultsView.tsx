
import React, { useState, useMemo, useEffect } from 'react';
import { StudyTask } from '../types';

interface ResultsViewProps {
  plan: StudyTask[];
}

// Parse note text into structured sections for better display
function parseNotes(notes: string): { label: string; icon: string; text: string }[] {
  if (!notes) return [];

  const sectionConfig: Record<string, { label: string; icon: string }> = {
    focus: { label: 'Focus', icon: '🎯' },
    practice: { label: 'Practice', icon: '✏️' },
    memorize: { label: 'Memorize', icon: '🧠' },
    'self-test': { label: 'Self-Test', icon: '✅' },
    derive: { label: 'Derive', icon: '📐' },
  };

  // Strategy 1: Split on " | " delimiter (new format from prompt)
  if (notes.includes(' | ')) {
    const parts = notes.split(' | ');
    const sections: { label: string; icon: string; text: string }[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Try to match "Label: text" pattern
      const colonMatch = trimmed.match(/^([\w\s-]+?):\s*(.+)$/s);
      if (colonMatch) {
        const key = colonMatch[1].trim().toLowerCase();
        const config = sectionConfig[key];
        if (config) {
          sections.push({ label: config.label, icon: config.icon, text: colonMatch[2].trim() });
          continue;
        }
      }
      // Fallback: unrecognized section
      sections.push({ label: 'Notes', icon: '📝', text: trimmed });
    }
    if (sections.length > 0) return sections;
  }

  // Strategy 2: Match keyword patterns inline (old format / fallback)
  const patterns: [RegExp, string, string][] = [
    [/Focus\s*(?:on)?:\s*/i, 'Focus', '🎯'],
    [/Derive\s*(?:[:—-]\s*)?/i, 'Derive', '📐'],
    [/(?:Memorize|Key definitions)\s*(?:[:—-]\s*)?/i, 'Memorize', '🧠'],
    [/(?:Work through|Practice|Attempt)\s*(?:[:—-]\s*)?/i, 'Practice', '✏️'],
    [/Self[- ]?[Tt]est\s*(?:[:—-]\s*)?/i, 'Self-Test', '✅'],
  ];

  const matches: { pos: number; end: number; label: string; icon: string }[] = [];
  for (const [regex, label, icon] of patterns) {
    const m = notes.search(regex);
    if (m !== -1) {
      const fullMatch = notes.match(regex);
      matches.push({ pos: m, end: m + (fullMatch?.[0].length || 0), label, icon });
    }
  }

  if (matches.length === 0) {
    return [{ label: 'Notes', icon: '📝', text: notes.trim() }];
  }

  matches.sort((a, b) => a.pos - b.pos);
  const sections: { label: string; icon: string; text: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const end = i + 1 < matches.length ? matches[i + 1].pos : notes.length;
    const text = notes.slice(start, end).replace(/\.\s*$/, '').trim();
    if (text) {
      sections.push({ label: matches[i].label, icon: matches[i].icon, text });
    }
  }
  return sections.length > 0 ? sections : [{ label: 'Notes', icon: '📝', text: notes.trim() }];
}

const ResultsView: React.FC<ResultsViewProps> = ({ plan: initialPlan }) => {
  const [activeTab, setActiveTab] = useState<'list' | 'calendar' | 'curriculum'>('curriculum');
  const [localPlan, setLocalPlan] = useState<StudyTask[]>(initialPlan);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  useEffect(() => {
    setLocalPlan(initialPlan);
  }, [initialPlan]);

  const flaggedCount = useMemo(() => localPlan.filter(t => t.isFlagged).length, [localPlan]);

  const taskId = (t: StudyTask) => `${t.course}-${t.topic}-${t.task_type}-${t.date}`;

  const updateTask = (id: string, updates: Partial<StudyTask>) => {
    setLocalPlan(prev => prev.map(t => taskId(t) === id ? { ...t, ...updates } : t));
  };

  // Filtered plan based on flag toggle
  const displayPlan = useMemo(() =>
    showFlaggedOnly ? localPlan.filter(t => t.isFlagged) : localPlan
    , [localPlan, showFlaggedOnly]);

  const groupedPlan = useMemo(() => displayPlan.reduce((acc, curr) => {
    acc[curr.date] = acc[curr.date] || [];
    acc[curr.date].push(curr);
    return acc;
  }, {} as Record<string, StudyTask[]>), [displayPlan]);

  const sortedDates = useMemo(() => Object.keys(groupedPlan).sort(), [groupedPlan]);

  const curriculumData = useMemo(() => {
    const data: Record<string, { color: string, topics: StudyTask[] }> = {};
    displayPlan.forEach(t => {
      if (t.course === 'REST') return;
      if (!data[t.course]) data[t.course] = { color: t.courseColor, topics: [] };
      if (!data[t.course].topics.some(item => item.topic === t.topic)) {
        data[t.course].topics.push(t);
      }
    });
    return data;
  }, [displayPlan]);

  const calendarDays = useMemo(() => {
    const allDates = Object.keys(localPlan.reduce((acc, curr) => { acc[curr.date] = true; return acc; }, {} as Record<string, boolean>)).sort();
    if (allDates.length === 0) return [];
    const anchorDate = new Date(allDates[0] + 'T00:00:00');
    const start = new Date(anchorDate);
    start.setDate(anchorDate.getDate() - anchorDate.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [localPlan]);

  // Calendar uses full plan (not filtered) for grouping
  const calendarGrouped = useMemo(() => localPlan.reduce((acc, curr) => {
    acc[curr.date] = acc[curr.date] || [];
    acc[curr.date].push(curr);
    return acc;
  }, {} as Record<string, StudyTask[]>), [localPlan]);

  const exportToCSV = () => {
    const headers = ['Date', 'Course', 'Topic', 'Task Type', 'Duration (H)', 'Resources', 'Notes'];
    const csvEscape = (val: string | number) => {
      const s = String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = localPlan.map(t => [
      csvEscape(t.date), csvEscape(t.course), csvEscape(t.topic),
      csvEscape(t.task_type), csvEscape(t.duration_hours),
      csvEscape(t.resources || ''), csvEscape(t.notes || '')
    ]);
    const csvContent = [headers.map(csvEscape).join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plan.csv';
    link.click();
  };

  const exportToMarkdown = () => {
    let md = '# Study Plan\n\n';
    md += '| Date | Course | Topic | Task Type | Hours | Resources |\n';
    md += '| :--- | :--- | :--- | :--- | :--- | :--- |\n';
    localPlan.forEach(t => {
      md += `| ${t.date} | ${t.course} | ${t.topic} | ${t.task_type} | ${t.duration_hours} | ${t.resources} |\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plan.md';
    link.click();
  };

  // ---- Formatted Notes Component ----
  const FormattedNotes = ({ notes }: { notes: string }) => {
    const sections = parseNotes(notes);
    return (
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={i} className="flex gap-3 items-start">
            <span className="text-sm shrink-0 mt-0.5">{s.icon}</span>
            <div className="min-w-0">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#a7b8a1] block mb-1">{s.label}</span>
              <p className="text-sm text-gray-600 leading-relaxed font-medium">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ---- Topic Detail Modal ----
  const TopicDebrief = () => {
    if (!selectedTopicId) return null;
    const task = localPlan.find(t => taskId(t) === selectedTopicId);
    if (!task) return null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#4a5d45]/20 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setSelectedTopicId(null)}>
        <div className="bg-white w-full max-w-xl max-h-[90vh] rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500" onClick={(e) => e.stopPropagation()}>
          <div className="p-10 space-y-8 overflow-y-auto max-h-[90vh] custom-scrollbar">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: task.courseColor }}></div>
                  <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-300">{task.course}</span>
                  {task.isFlagged && <span className="text-[9px] font-black uppercase tracking-[0.2em] text-red-400 bg-red-50 px-2 py-0.5 rounded-full">Flagged</span>}
                </div>
                <h2 className="serif text-4xl font-bold text-[#4a5d45] tracking-tight">{task.topic}</h2>
              </div>
              <button onClick={() => setSelectedTopicId(null)} className="p-3 bg-gray-50 rounded-full text-gray-300 hover:text-gray-500 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 p-4 bg-[#fdfdfb] border border-gray-100 rounded-2xl">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-2">Date</label>
                <input type="date" value={task.date} onChange={(e) => updateTask(selectedTopicId, { date: e.target.value })} className="w-full bg-transparent text-sm font-bold text-[#4a5d45] focus:outline-none" />
              </div>
              <div className="w-32 p-4 bg-[#fdfdfb] border border-gray-100 rounded-2xl">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-2">Hours</label>
                <input type="number" step="0.5" value={task.duration_hours} onChange={(e) => updateTask(selectedTopicId, { duration_hours: parseFloat(e.target.value) })} className="w-full bg-transparent text-sm font-bold text-[#4a5d45] focus:outline-none" />
              </div>
              <div className="w-32 p-4 bg-[#fdfdfb] border border-gray-100 rounded-2xl">
                <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-2">Type</label>
                <span className="text-sm font-bold text-[#4a5d45] capitalize">{task.task_type}</span>
              </div>
            </div>

            <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100/50">
              <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-3">Resources</label>
              <p className="text-sm font-medium text-gray-600">{task.resources}</p>
            </div>

            <div className="p-6 bg-white border border-gray-100 rounded-[2rem] shadow-sm">
              <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[#a7b8a1] block mb-4">Study Notes</label>
              <FormattedNotes notes={task.notes} />
            </div>

            <div className="flex gap-4 pt-4">
              <button
                onClick={() => updateTask(selectedTopicId, { isCompleted: !task.isCompleted })}
                className={`flex-1 py-5 rounded-3xl text-[11px] font-black uppercase tracking-[0.4em] transition-all ${task.isCompleted ? 'bg-gray-100 text-gray-400' : 'bg-[#4a5d45] text-white shadow-xl shadow-[#4a5d45]/20 hover:scale-[1.02]'}`}
              >
                {task.isCompleted ? 'Mark Incomplete' : 'Mark Done'}
              </button>
              <button
                onClick={() => updateTask(selectedTopicId, { isFlagged: !task.isFlagged })}
                className={`px-8 py-5 rounded-3xl transition-all border flex items-center gap-3 ${task.isFlagged ? 'bg-red-50 border-red-100 text-red-500' : 'bg-white border-gray-100 text-gray-300 hover:text-red-400'}`}
              >
                <svg className="w-5 h-5" fill={task.isFlagged ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">{task.isFlagged ? 'Unflag' : 'Flag for Review'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---- Day Detail Modal ----
  const DayDebrief = () => {
    if (!selectedDayDate) return null;
    const tasks = calendarGrouped[selectedDayDate] || [];
    const displayDate = new Date(selectedDayDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const totalHours = tasks.reduce((sum, t) => sum + (t.duration_hours || 0), 0);

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#4a5d45]/20 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setSelectedDayDate(null)}>
        <div className="bg-[#fdfdfb] w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-12 duration-500" onClick={(e) => e.stopPropagation()}>
          <div className="p-12 space-y-10">
            <div className="flex justify-between items-center">
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <span className="text-[11px] font-black uppercase tracking-[0.5em] text-[#a7b8a1]">Selected Day</span>
                  {totalHours > 0 && <span className="serif text-sm font-bold text-[#4a5d45]">{Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1)}h total</span>}
                </div>
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
                  <div key={idx} onClick={() => { setSelectedDayDate(null); setSelectedTopicId(taskId(t)); }} className="group bg-white p-8 rounded-[2.5rem] border border-gray-50 shadow-sm hover:shadow-xl transition-all cursor-pointer relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: t.courseColor }}></div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#a7b8a1]">{t.course} • {t.task_type}</span>
                        {t.isFlagged && <span className="w-3 h-3 text-red-400"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" /></svg></span>}
                      </div>
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
          {flaggedCount > 0 && (
            <button
              onClick={() => setShowFlaggedOnly(!showFlaggedOnly)}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm ${showFlaggedOnly
                ? 'bg-red-50 border-red-200 text-red-500'
                : 'bg-white border-gray-100 text-gray-400 hover:text-red-400 hover:border-red-100'
                }`}
            >
              <svg className="w-3.5 h-3.5" fill={showFlaggedOnly ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
              {showFlaggedOnly ? `Showing ${flaggedCount} Flagged` : `${flaggedCount} Flagged`}
            </button>
          )}
          <div className="flex gap-4 mr-6 border-r border-gray-100 pr-6">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-[#a7b8a1] hover:text-[#4a5d45] hover:border-[#4a5d45]/20 transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              CSV
            </button>
            <button
              onClick={exportToMarkdown}
              className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-[#a7b8a1] hover:text-[#4a5d45] hover:border-[#4a5d45]/20 transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Markdown
            </button>
          </div>
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
            const courseData = data as { color: string, topics: StudyTask[] };
            const completed = courseData.topics.filter(t => t.isCompleted).length;
            const flagged = courseData.topics.filter(t => t.isFlagged).length;
            const percentage = Math.round((completed / courseData.topics.length) * 100);
            return (
              <div key={course} className="bg-white border border-gray-100 rounded-[3rem] p-12 shadow-sm hover:shadow-2xl transition-all flex flex-col group relative overflow-hidden">
                <div className="flex items-center justify-between mb-8 relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-4 h-4 rounded-full shadow-lg" style={{ backgroundColor: courseData.color }}></div>
                    <h3 className="serif text-4xl font-bold text-[#4a5d45] tracking-tight">{course}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {flagged > 0 && (
                      <span className="flex items-center gap-1.5 text-red-400 text-[9px] font-black uppercase tracking-[0.2em]">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" /></svg>
                        {flagged}
                      </span>
                    )}
                    <button onClick={() => setActiveTab('list')} className="text-[9px] font-black uppercase tracking-widest text-[#a7b8a1] hover:text-[#4a5d45] transition-all border border-gray-100 px-4 py-1.5 rounded-full">
                      View Timeline
                    </button>
                  </div>
                </div>
                <div className="space-y-4 mb-10 relative z-10">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-300">Mastery</span>
                    <span className="serif text-2xl font-bold text-[#4a5d45]">{percentage}%</span>
                  </div>
                  <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100 shadow-inner">
                    <div className="h-full transition-all duration-1000 ease-out shadow-lg" style={{ width: `${percentage}%`, backgroundColor: courseData.color }}></div>
                  </div>
                </div>
                <div className="space-y-4 flex-1 relative z-10">
                  {courseData.topics.map((t, idx) => {
                    const id = taskId(t);
                    return (
                      <div key={idx} className={`p-6 rounded-[2rem] border transition-all flex items-center justify-between group/item cursor-pointer ${t.isCompleted ? 'bg-gray-50 border-gray-100 opacity-40 grayscale' : t.isFlagged ? 'bg-red-50/30 border-red-100/50 hover:border-red-200 hover:bg-red-50/50 shadow-sm hover:scale-[1.03]' : 'bg-[#fdfdfb] border-gray-50 hover:border-[#a7b8a1] hover:bg-white shadow-sm hover:scale-[1.03]'}`} onClick={() => setSelectedTopicId(id)}>
                        <div className="flex items-center gap-5 min-w-0">
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${t.isCompleted ? 'bg-[#4a5d45] border-[#4a5d45] text-white' : 'border-gray-100'}`}>
                            {t.isCompleted && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-bold truncate ${t.isCompleted ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.topic}</p>
                              {t.isFlagged && <svg className="w-3 h-3 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" /></svg>}
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-300 tabular-nums w-[60px] shrink-0 text-right">{new Date(t.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#a7b8a1] min-w-[50px]">{t.task_type}</span>
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#a7b8a1]">{t.duration_hours}h</span>
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
            <div
              className="grid grid-cols-7 gap-px bg-gray-50 rounded-[3rem] overflow-hidden border border-gray-100 shadow-inner"
              style={{ gridTemplateRows: 'repeat(6, minmax(110px, 1fr))' }}
            >
              {calendarDays.map((date, idx) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                const dayTasks = calendarGrouped[dateStr] || [];
                const isToday = dateStr === new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
                const allDates = Object.keys(calendarGrouped).sort();
                const anchorDate = allDates.length > 0 ? new Date(allDates[0]) : new Date();
                const isDifferentMonth = date.getMonth() !== anchorDate.getMonth();
                const hasFlagged = dayTasks.some(t => t.isFlagged);
                const totalH = dayTasks.reduce((s, t) => s + (t.duration_hours || 0), 0);

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDayDate(dateStr)}
                    className={`p-4 bg-white hover:bg-[#fdfdfb] transition-all relative group/cell cursor-pointer flex flex-col gap-2 min-h-[110px] ${hasFlagged ? 'ring-1 ring-inset ring-red-100' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-serif font-bold transition-all ${isToday ? 'bg-[#4a5d45] text-white w-7 h-7 flex items-center justify-center rounded-full shadow-lg' :
                        isDifferentMonth ? 'text-gray-100' : 'text-gray-200 group-hover/cell:text-[#a7b8a1]'
                        }`}>
                        {date.getDate()}
                      </span>
                      {totalH > 0 && !isDifferentMonth && (
                        <span className="text-[8px] font-bold text-[#a7b8a1]">{Number.isInteger(totalH) ? totalH : totalH.toFixed(1)}h</span>
                      )}
                    </div>
                    {dayTasks.length > 0 && (
                      <div className="flex flex-col gap-1 mt-auto w-full">
                        {dayTasks.slice(0, 3).map((t, i) => (
                          <div key={i} className="flex items-center gap-1.5 w-full min-w-0">
                            <div className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: t.courseColor || '#4a5d45' }}></div>
                            <span className="text-[8px] font-bold text-gray-400 truncate leading-tight">{t.course === 'REST' ? 'Rest 🏖️' : t.course}</span>
                            {t.isFlagged && <svg className="w-2 h-2 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" /></svg>}
                          </div>
                        ))}
                        {dayTasks.length > 3 && <span className="text-[8px] font-bold text-[#a7b8a1] ml-3.5">+{dayTasks.length - 3}</span>}
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
              <div className="mb-10"><h3 className={`serif text-4xl font-bold transition-all duration-700 ${selectedDayDate === date ? 'text-[#4a5d45] translate-x-2' : 'text-gray-400'}`}>{new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3></div>
              <div className="grid gap-10">
                {groupedPlan[date].map((task, idx) => {
                  const id = taskId(task);
                  return (
                    <div key={idx} onClick={() => setSelectedTopicId(id)} className={`flex flex-col md:flex-row gap-10 p-12 rounded-[4rem] bg-white border transition-all group overflow-hidden relative cursor-pointer ${task.isCompleted ? 'opacity-40 border-gray-50' : task.isFlagged ? 'border-red-100 shadow-sm hover:shadow-2xl' : 'border-gray-50 hover:shadow-2xl shadow-sm'} ${selectedDayDate === date ? 'shadow-2xl ring-1 ring-[#4a5d45]/10' : ''}`}>
                      <div className="absolute left-0 top-0 bottom-0 w-2.5 transition-all group-hover:w-4" style={{ backgroundColor: task.courseColor }}></div>
                      {task.isFlagged && <div className="absolute top-6 right-6"><svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" /></svg></div>}
                      <div className="md:w-52 shrink-0"><span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-200 block mb-4">Course</span><span className="serif text-3xl font-bold text-gray-800 tracking-tighter leading-none">{task.course}</span></div>
                      <div className="flex-1 space-y-6">
                        <div className="flex items-center gap-5"><span className="text-[10px] font-black uppercase tracking-[0.3em] px-5 py-2 rounded-full shadow-inner bg-gray-50 text-gray-600">{task.task_type}</span><h4 className={`serif text-3xl font-bold text-gray-800 tracking-tight leading-none group-hover:text-[#4a5d45] transition-colors ${task.isCompleted ? 'line-through opacity-50' : ''}`}>{task.topic}{task.task_type.toLowerCase() === 'rest' || task.course === 'REST' ? ' 🏖️' : ''}</h4></div>
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #ddd; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default ResultsView;
