import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, Database, ShieldAlert, Zap, Search } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { scrapeRealCarrier, downloadCSV, generateMockCarrier } from '../services/mockService';
import { saveCarrierToSupabase } from '../services/supabaseClient';

interface ScraperProps {
  user: User;
  onUpdateUsage: (count: number) => void;
  onNewCarriers: (data: CarrierData[]) => void;
  onUpgrade: () => void;
}

// Adjust concurrency based on proxy quality. 3-4 is usually the sweet spot.
const CONCURRENCY_LIMIT = 1; 

export const Scraper: React.FC<ScraperProps> = ({ user, onUpdateUsage, onNewCarriers, onUpgrade }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [config, setConfig] = useState<ScraperConfig>({
    startPoint: '1580000',
    recordCount: 50,
    includeCarriers: true,
    includeBrokers: false,
    onlyAuthorized: true,
    useMockData: false,
    useProxy: true,
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const [scrapedData, setScrapedData] = useState<CarrierData[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ saved: 0, skipped: 0 });
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  // Auto-scroll logic for the console
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const toggleRun = () => {
    if (isRunning) {
      isRunningRef.current = false;
      setIsRunning(false);
      setLogs(prev => [...prev, "🛑 STOPPED: Finishing active tasks..."]);
    } else {
      if (user.recordsExtractedToday >= user.dailyLimit) {
        onUpgrade();
        return;
      }
      setIsRunning(true);
      isRunningRef.current = true;
      setLogs(prev => [...prev, `🚀 ENGINE START: MC Range ${config.startPoint}+`]);
      setScrapedData([]);
      setProgress(0);
      setStats({ saved: 0, skipped: 0 });
      executeBatch();
    }
  };

  const executeBatch = async () => {
    const startMc = parseInt(config.startPoint);
    const total = config.recordCount;
    const mcQueue = Array.from({ length: total }, (_, i) => (startMc + i).toString());
    let processedCount = 0;

    const worker = async (mc: string) => {
      if (!isRunningRef.current) return;

      const startTime = performance.now();
      try {
        // Step 1: Fetch data (Uses the optimized mockService logic)
        const data = config.useMockData 
          ? generateMockCarrier(mc, config.includeBrokers) 
          : await scrapeRealCarrier(mc, config.useProxy);

        if (data) {
          // Step 2: Filtering Logic
          const isAuthorized = data.status?.toUpperCase().includes('AUTHORIZED');
          
          if (!config.onlyAuthorized || isAuthorized) {
            const latency = Math.round(performance.now() - startTime);
            
            // Add to live table
            setScrapedData(prev => [...prev, data]);
            
            // Save to Database
            const { success } = await saveCarrierToSupabase(data);
            if (success) setStats(prev => ({ ...prev, saved: prev.saved + 1 }));

            // High-visibility logs
            const emailIcon = data.email && data.email !== 'N/A' ? '📧' : '❌';
            const safetyIcon = data.safetyRating === 'Satisfactory' ? '✅' : '⚠️';
            
            setLogs(prev => [...prev, `[FOUND] MC ${mc} | ${safetyIcon} ${data.safetyRating} | ${emailIcon} Email | ${latency}ms`]);
            onUpdateUsage(1);
          } else {
            setStats(prev => ({ ...prev, skipped: prev.skipped + 1 }));
            setLogs(prev => [...prev, `[SKIP] MC ${mc} - Not Authorized`]);
          }
        } else {
          setLogs(prev => [...prev, `[FAIL] MC ${mc} - No data found`]);
        }
      } catch (err) {
        setLogs(prev => [...prev, `[ERROR] MC ${mc} - Network / Proxy timeout`]);
      }

      processedCount++;
      setProgress(Math.round((processedCount / total) * 100));
      
      // Jitter delay to avoid pattern detection
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    };

    // Parallel Processing
    const currentQueue = [...mcQueue];
    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
      while (currentQueue.length > 0 && isRunningRef.current) {
        const mc = currentQueue.shift();
        if (mc) await worker(mc);
      }
    });

    await Promise.all(workers);
    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, "🏁 BATCH COMPLETE."]);
    onNewCarriers(scrapedData);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0c10] text-slate-300 overflow-hidden font-sans">
      <div className="flex flex-col flex-1 p-6 lg:p-10 space-y-6 min-h-0">
        
        {/* TOP NAVBAR */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/20">
              <Zap className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white italic tracking-tight">HUSS<span className="text-indigo-500 not-italic">FIX</span> ENGINE</h1>
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> SMS Sync Active
              </div>
            </div>
          </div>
          
          <div className="flex gap-3 w-full md:w-auto">
            <button onClick={() => downloadCSV(scrapedData)} className="flex-1 md:flex-none px-6 py-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all font-bold text-sm">
              <Download size={16} /> Export CSV
            </button>
            <button onClick={toggleRun} className={`flex-1 md:flex-none px-10 py-3 rounded-xl font-black flex items-center justify-center gap-2 transition-all shadow-xl ${isRunning ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/30'}`}>
              {isRunning ? <><Pause size={18} /> STOP</> : <><Play size={18} /> RUN BATCH</>}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
          
          {/* CONTROL PANEL */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
            <div className="bg-slate-900/40 border border-slate-800/60 p-6 rounded-3xl space-y-6">
              <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em]">Scraper Settings</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Starting MC</label>
                  <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 font-mono text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Batch Size</label>
                  <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 font-mono text-white" />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/50">
                <label className="flex items-center justify-between group cursor-pointer">
                  <span className="text-sm font-medium text-slate-400 group-hover:text-white transition-colors">Only Authorized Carriers</span>
                  <input type="checkbox" checked={config.onlyAuthorized} onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})} className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0" />
                </label>
              </div>
            </div>

            <div className="bg-indigo-600 p-8 rounded-3xl relative overflow-hidden group">
              <div className="relative z-10">
                <p className="text-indigo-200 text-xs font-bold uppercase tracking-widest mb-1">Batch Progress</p>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-5xl font-black text-white">{progress}%</h2>
                  <span className="text-indigo-200 text-sm font-bold">Done</span>
                </div>
                <div className="w-full bg-indigo-900/40 h-3 rounded-full mt-6 p-0.5">
                  <div className="bg-white h-full rounded-full transition-all duration-700 shadow-[0_0_15px_rgba(255,255,255,0.4)]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-6 flex justify-between text-[10px] font-black uppercase text-indigo-100/70">
                  <span>Saves: {stats.saved}</span>
                  <span>Skips: {stats.skipped}</span>
                </div>
              </div>
              <Activity className="absolute -right-4 -bottom-4 text-white/5 group-hover:text-white/10 transition-colors" size={160} />
            </div>
          </div>

          {/* CONSOLE & LIVE TABLE */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 min-h-0">
            {/* TERMINAL */}
            <div className="flex-[1] bg-slate-950 border border-slate-800/80 rounded-3xl p-5 font-mono text-[11px] overflow-y-auto custom-scrollbar relative">
              <div className="sticky top-0 bg-slate-950/90 backdrop-blur-md pb-3 mb-3 border-b border-slate-900 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-500 font-bold uppercase tracking-widest">
                  <TerminalIcon size={14} className="text-indigo-500" /> Live Logs
                </div>
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500/20" />
                  <div className="w-2 h-2 rounded-full bg-yellow-500/20" />
                  <div className="w-2 h-2 rounded-full bg-emerald-500/20" />
                </div>
              </div>
              <div className="space-y-1.5">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-4 border-l border-slate-900 pl-3">
                    <span className="text-slate-600 shrink-0">{new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}</span>
                    <span className={log.includes('[FOUND]') ? 'text-indigo-400' : log.includes('[SKIP]') ? 'text-slate-500' : 'text-amber-400'}>
                      {log}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>

            {/* LIVE FEED */}
            <div className="flex-[2] bg-slate-900/20 border border-slate-800 rounded-3xl overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-800/60 bg-slate-900/40 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Database size={16} className="text-indigo-400" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-white">Extracted Carriers</h3>
                </div>
                <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-3 py-1 rounded-full font-black border border-indigo-500/20">
                  {scrapedData.length} NEW RECORDS
                </span>
              </div>
              <div className="overflow-auto flex-1 custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-950/80 sticky top-0 z-10">
                    <tr>
                      <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800">MC Number</th>
                      <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800">Carrier Name</th>
                      <th className="p-4 text-[10px] font-black text-indigo-400 uppercase tracking-widest border-b border-slate-800">Email</th>
                      <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800">Rating</th>
                      <th className="p-4 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {scrapedData.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-20 text-center">
                          <div className="flex flex-col items-center opacity-20">
                            <Search size={48} className="mb-4" />
                            <p className="text-sm font-medium italic">Engine standby... Click START to begin extraction</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      scrapedData.slice().reverse().map((row, i) => (
                        <tr key={i} className="hover:bg-indigo-500/[0.04] transition-colors group">
                          <td className="p-4 font-mono text-indigo-400 font-bold">{row.mcNumber}</td>
                          <td className="p-4 font-bold text-white truncate max-w-[180px]">{row.legalName}</td>
                          <td className="p-4 font-mono text-slate-400 text-[10px]">
                            {row.email !== 'N/A' ? (
                              <span className="text-indigo-300 underline underline-offset-4 decoration-indigo-500/30">{row.email}</span>
                            ) : (
                              <span className="opacity-30">NOT_FOUND</span>
                            )}
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase border ${
                              row.safetyRating === 'Satisfactory' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                              row.safetyRating === 'Conditional' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                              'bg-slate-800 text-slate-500 border-slate-700'
                            }`}>
                              {row.safetyRating}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <div className={`inline-block w-2.5 h-2.5 rounded-full ${row.status.includes('AUTHORIZED') ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-red-500'}`} />
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
