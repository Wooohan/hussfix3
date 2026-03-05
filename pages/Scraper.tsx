import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, Database, ShieldAlert, Zap } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { scrapeRealCarrier, downloadCSV, generateMockCarrier } from '../services/mockService';
import { saveCarrierToSupabase } from '../services/supabaseClient';

// CONFIGURATION
const CONCURRENCY_LIMIT = 3; 

interface ScraperProps {
  user: User;
  onUpdateUsage: (count: number) => void;
  onNewCarriers: (data: CarrierData[]) => void;
  onUpgrade: () => void;
}

export const Scraper: React.FC<ScraperProps> = ({ user, onUpdateUsage, onNewCarriers, onUpgrade }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [config, setConfig] = useState<ScraperConfig>({
    startPoint: '1580000',
    recordCount: 20,
    includeCarriers: true,
    includeBrokers: false,
    onlyAuthorized: true,
    useMockData: false,
    useProxy: true,
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const [scrapedData, setScrapedData] = useState<CarrierData[]>([]);
  const [progress, setProgress] = useState(0);
  const [dbSaveCount, setDbSaveCount] = useState(0);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const toggleRun = () => {
    if (isRunning) {
      setIsRunning(false);
      isRunningRef.current = false;
      setLogs(prev => [...prev, "⚠️ Engine Paused."]);
    } else {
      if (user.recordsExtractedToday >= user.dailyLimit) {
        onUpgrade();
        return;
      }
      setIsRunning(true);
      isRunningRef.current = true;
      setLogs(prev => [...prev, `🚀 Engine Started | Concurrency: ${CONCURRENCY_LIMIT} | Mode: SMS Optimized`]);
      setScrapedData([]);
      setProgress(0);
      setDbSaveCount(0);
      processQueue();
    }
  };

  const processQueue = async () => {
    const start = parseInt(config.startPoint);
    const total = config.recordCount;
    const tasks = Array.from({ length: total }, (_, i) => (start + i).toString());
    let completed = 0;

    // The individual worker logic
    const worker = async (mc: string) => {
      if (!isRunningRef.current) return;

      const startTime = performance.now();
      try {
        const data = config.useMockData 
          ? generateMockCarrier(mc, config.includeBrokers) 
          : await scrapeRealCarrier(mc);

        if (data) {
          // Filter: Only Authorized if checked
          const isAuth = data.status.toUpperCase().includes('AUTHORIZED');
          if (!config.onlyAuthorized || isAuth) {
            const latency = Math.round(performance.now() - startTime);
            
            // 1. Update UI List
            setScrapedData(prev => [...prev, data]);
            
            // 2. Save to Supabase
            const saveResult = await saveCarrierToSupabase(data);
            if (saveResult.success) setDbSaveCount(prev => prev + 1);
            
            // 3. Log Success with Email/Rating check
            const emailStatus = data.email && data.email !== 'N/A' ? '📧 Found' : '❌ No Email';
            setLogs(prev => [...prev, `[Success] MC ${mc} | ${data.safetyRating} | ${emailStatus} | ${latency}ms`]);
            
            onUpdateUsage(1);
          } else {
            setLogs(prev => [...prev, `[Skip] MC ${mc} is NOT AUTHORIZED.`]);
          }
        } else {
          setLogs(prev => [...prev, `[Error] MC ${mc} returned no data.`]);
        }
      } catch (err) {
        setLogs(prev => [...prev, `[Failed] MC ${mc} connection error.`]);
      }

      completed++;
      setProgress(Math.round((completed / total) * 100));
      
      // Random "Human" delay between 400ms - 900ms to protect proxy health
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 500) + 400));
    };

    // Parallel execution logic
    const queue = [...tasks];
    const pool = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
      while (queue.length > 0 && isRunningRef.current) {
        const mc = queue.shift();
        if (mc) await worker(mc);
      }
    });

    await Promise.all(pool);
    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, "✅ Task Finished."]);
    onNewCarriers(scrapedData);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
      <div className="flex flex-col flex-1 p-6 md:p-10 space-y-6 min-h-0">
        
        {/* HEADER AREA */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight italic">SMS<span className="text-indigo-500 font-normal not-italic">Scraper</span></h1>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">Enhanced Proxy Rotation Engine</p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button onClick={() => downloadCSV(scrapedData)} className="flex-1 md:flex-none px-5 py-3 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all text-sm font-bold">
              <Download size={18} /> Export
            </button>
            <button onClick={toggleRun} className={`flex-1 md:flex-none px-8 py-3 rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg transition-all ${isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
              {isRunning ? <><Pause size={18} /> STOP</> : <><Play size={18} /> START</>}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
          
          {/* LEFT SIDE: CONFIG & PROGRESS */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
            <section className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl space-y-5">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm uppercase tracking-wider">
                <Activity size={16} /> Parameters
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase">Start MC#</label>
                  <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 transition-all" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase">Count</label>
                  <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 transition-all" />
                </div>
                <div className="flex flex-col gap-3 pt-2">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-300">Only Authorized</span>
                    <input type="checkbox" checked={config.onlyAuthorized} onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})} className="w-5 h-5 rounded bg-slate-950 border-slate-800 text-indigo-600" />
                  </label>
                </div>
              </div>
            </section>

            <section className="bg-indigo-600 p-6 rounded-3xl shadow-xl shadow-indigo-500/10">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <p className="text-indigo-200 text-[10px] font-black uppercase tracking-widest">Active Progress</p>
                  <h3 className="text-3xl font-black text-white">{progress}%</h3>
                </div>
                <Zap className="text-indigo-300/50" size={32} />
              </div>
              <div className="w-full bg-indigo-800 h-2 rounded-full mb-6 overflow-hidden">
                <div className="bg-white h-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-indigo-500 pt-4 font-mono">
                <div>
                  <p className="text-indigo-200 text-[10px] font-bold uppercase">DB Saves</p>
                  <p className="text-white font-black">{dbSaveCount}</p>
                </div>
                <div>
                  <p className="text-indigo-200 text-[10px] font-bold uppercase">Usage</p>
                  <p className="text-white font-black">{user.recordsExtractedToday}/{user.dailyLimit}</p>
                </div>
              </div>
            </section>
          </div>

          {/* RIGHT SIDE: LOGS & TABLE */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 min-h-0">
            {/* CONSOLE */}
            <div className="flex-[1] bg-slate-950 border border-slate-800 rounded-3xl p-5 font-mono text-[11px] overflow-y-auto custom-scrollbar relative">
              <div className="sticky top-0 bg-slate-950/90 backdrop-blur pb-2 mb-2 border-b border-slate-900 flex items-center gap-2 text-slate-500 uppercase tracking-widest font-bold">
                <TerminalIcon size={14} /> System Console
              </div>
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="opacity-20 shrink-0">{new Date().toLocaleTimeString([], { hour12: false })}</span>
                    <span className={log.includes('[Success]') ? 'text-indigo-400' : log.includes('[Failed]') ? 'text-red-400' : 'text-slate-500'}>
                      {log}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>

            {/* LIVE FEED TABLE */}
            <div className="flex-[2] bg-slate-900/30 border border-slate-800 rounded-3xl overflow-hidden flex flex-col min-h-0">
              <div className="p-4 bg-slate-900/50 border-b border-slate-800 flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Live Data Stream</h3>
                <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-2 py-1 rounded-full font-bold">{scrapedData.length} Records</span>
              </div>
              <div className="overflow-auto flex-1 custom-scrollbar">
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-slate-950/50 sticky top-0 text-slate-500 font-bold uppercase tracking-tighter border-b border-slate-800">
                    <tr>
                      <th className="p-4">MC#</th>
                      <th className="p-4">Legal Name</th>
                      <th className="p-4 text-indigo-400">Email Address</th>
                      <th className="p-4">Rating</th>
                      <th className="p-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {scrapedData.length === 0 ? (
                      <tr><td colSpan={5} className="p-20 text-center text-slate-700 italic">Engine idle. Awaiting start command...</td></tr>
                    ) : (
                      scrapedData.slice().reverse().map((row, i) => (
                        <tr key={i} className="hover:bg-indigo-500/[0.03] transition-colors">
                          <td className="p-4 font-mono text-indigo-400">{row.mcNumber}</td>
                          <td className="p-4 font-bold text-slate-200 truncate max-w-[150px]">{row.legalName}</td>
                          <td className="p-4 font-mono text-slate-400">{row.email || 'N/A'}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-lg font-black text-[9px] uppercase ${
                              row.safetyRating === 'Satisfactory' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                              row.safetyRating === 'Conditional' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 
                              'bg-slate-800/50 text-slate-500'
                            }`}>
                              {row.safetyRating || 'NOT RATED'}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <div className={`inline-block w-2 h-2 rounded-full ${row.status.includes('AUTHORIZED') ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
