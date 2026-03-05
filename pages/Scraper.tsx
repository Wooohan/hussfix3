import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, Database, ShieldAlert } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { generateMockCarrier, scrapeRealCarrier, downloadCSV, fetchSafetyData } from '../services/mockService';
import { saveCarrierToSupabase } from '../services/supabaseClient';

// RESTORED SPEED
const CONCURRENCY_LIMIT = 2;

interface ScraperProps {
  user: User;
  onUpdateUsage: (count: number) => void;
  onNewCarriers: (data: CarrierData[]) => void;
  onUpgrade: () => void;
  onFinish?: () => void;
}

export const Scraper: React.FC<ScraperProps> = ({ user, onUpdateUsage, onNewCarriers, onUpgrade, onFinish }) => {
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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [dbSaveCount, setDbSaveCount] = useState(0);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const handleDownload = () => {
    if (scrapedData.length === 0) return;
    downloadCSV(scrapedData);
  };

  const toggleRun = () => {
    if (isRunning) {
      setIsRunning(false);
      isRunningRef.current = false;
      setLogs(prev => [...prev, "⚠️ Process paused by user."]);
    } else {
      if (user.recordsExtractedToday >= user.dailyLimit) {
        setShowUpgradeModal(true);
        return;
      }
      setIsRunning(true);
      isRunningRef.current = true;
      setLogs(prev => [...prev, `🚀 Initializing Safety Scraper Engine...`]);
      setScrapedData([]);
      setProgress(0);
      setDbSaveCount(0);
      processScrapingConcurrent();
    }
  };

  const processScrapingConcurrent = async () => {
    const start = parseInt(config.startPoint);
    const total = config.recordCount;
    let completed = 0;
    let sessionExtracted = 0;
    
    const tasks = Array.from({ length: total }, (_, i) => (start + i).toString());
    const successfulResults: CarrierData[] = [];

    const worker = async (mc: string) => {
      if (!isRunningRef.current) return;

      if (user.recordsExtractedToday + sessionExtracted >= user.dailyLimit) {
        isRunningRef.current = false;
        setIsRunning(false);
        setLogs(prev => [...prev, "⛔ DAILY LIMIT REACHED"]);
        setShowUpgradeModal(true);
        return;
      }

      try {
        let newData: CarrierData | null = null;
        if (config.useMockData) {
           await new Promise(r => setTimeout(r, 150));
           newData = generateMockCarrier(mc, config.includeBrokers);
        } else {
           // STEP 1: Get Basic Data
           const baseCarrier = await scrapeRealCarrier(mc, config.useProxy);
           
           if (baseCarrier && baseCarrier.dotNumber) {
             // STEP 2: Immediately Fetch Safety (Fixes the undefined/NA issue)
             const safety = await fetchSafetyData(baseCarrier.dotNumber);
             newData = {
               ...baseCarrier,
               safetyRating: safety?.rating || 'NOT RATED',
               ratingDate: safety?.date || '—'
             };
           }
        }

        if (newData) {
          const matchesFilter = !config.onlyAuthorized || newData.status.toUpperCase().includes('AUTHORIZED');
          
          if (matchesFilter) {
            setScrapedData(prev => [...prev, newData!]);
            successfulResults.push(newData!);
            
            const saveResult = await saveCarrierToSupabase(newData!);
            if (saveResult.success) {
              setDbSaveCount(prev => prev + 1);
              // LOG FIX: Uses the local newData variable to ensure rating is populated
              setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} | Rating: ${newData!.safetyRating}`]);
            }
            sessionExtracted++;
            onUpdateUsage(1);
          }
        } else {
          setLogs(prev => [...prev, `[No Data] MC ${mc} not found.`]);
        }
      } catch (e) {
        setLogs(prev => [...prev, `[Error] MC ${mc}: Connection Failed.`]);
      }

      completed++;
      setProgress(Math.round((completed / total) * 100));
    };

    const activePromises: Promise<void>[] = [];
    for (const mc of tasks) {
      if (!isRunningRef.current) break;
      const p = worker(mc).then(() => {
        activePromises.splice(activePromises.indexOf(p), 1);
      });
      activePromises.push(p);
      if (activePromises.length >= CONCURRENCY_LIMIT) await Promise.race(activePromises);
    }

    await Promise.all(activePromises);
    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `✅ Finished. Found ${successfulResults.length} matches.`]);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-8 rounded-3xl max-w-sm text-center shadow-2xl">
            <Lock className="mx-auto mb-4 text-indigo-400" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">Limit Reached</h2>
            <p className="text-slate-400 mb-6 text-sm">Upgrade your plan to unlock more extractions per day.</p>
            <button onClick={onUpgrade} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold transition-all">View Plans</button>
            <button onClick={() => setShowUpgradeModal(false)} className="mt-2 text-slate-500 text-xs uppercase tracking-widest">Dismiss</button>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 p-6 md:p-10 space-y-6 min-h-0">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight italic">SMS<span className="text-indigo-500 font-normal not-italic">Scraper</span></h1>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">FMCSA Safety Rating Engine</p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button onClick={handleDownload} className="flex-1 md:flex-none px-5 py-3 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all text-sm font-bold">
              <Download size={18} /> Export
            </button>
            <button onClick={toggleRun} className={`flex-1 md:flex-none px-8 py-3 rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg transition-all ${isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
              {isRunning ? <><Pause size={18} /> STOP</> : <><Play size={18} /> START</>}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
            <section className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl space-y-5">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm uppercase tracking-wider">
                <Activity size={16} /> Parameters
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase">Start MC#</label>
                  <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:border-indigo-500 outline-none transition-all" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase">Batch Size</label>
                  <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:border-indigo-500 outline-none transition-all" />
                </div>
                <div className="flex flex-col gap-3 pt-2">
                  <label className="flex items-center justify-between group cursor-pointer">
                    <span className="text-sm text-slate-300">Only Authorized Status</span>
                    <input type="checkbox" checked={config.onlyAuthorized} onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})} className="w-5 h-5 rounded-lg border-slate-800 bg-slate-950 text-indigo-600" />
                  </label>
                  <label className="flex items-center justify-between group cursor-pointer">
                    <span className="text-sm text-slate-300">Use Secure Proxies</span>
                    <input type="checkbox" checked={config.useProxy} onChange={(e) => setConfig({...config, useProxy: e.target.checked})} className="w-5 h-5 rounded-lg border-slate-800 bg-slate-950 text-indigo-600" />
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
                <Database className="text-indigo-300/50" size={32} />
              </div>
              <div className="w-full bg-indigo-800 h-2 rounded-full mb-6 overflow-hidden">
                <div className="bg-white h-full transition-all duration-700" style={{ width: `${progress}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-indigo-500 pt-4">
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

          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 min-h-0">
            <div className="flex-[1] bg-slate-950 border border-slate-800 rounded-3xl p-5 font-mono text-[11px] overflow-y-auto relative custom-scrollbar">
              <div className="sticky top-0 bg-slate-950/90 backdrop-blur pb-3 mb-3 border-b border-slate-900 flex items-center justify-between">
                 <div className="flex items-center gap-2 text-slate-500 font-bold uppercase tracking-widest">
                   <TerminalIcon size={14} /> System Console
                 </div>
              </div>
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className={`flex gap-3 ${log.includes('Success') ? 'text-indigo-400' : 'text-slate-500'}`}>
                    <span className="opacity-20 shrink-0">{new Date().toLocaleTimeString()}</span>
                    <span>{log}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>

            <div className="flex-[2] bg-slate-900/30 border border-slate-800 rounded-3xl overflow-hidden flex flex-col min-h-0">
              <div className="p-4 bg-slate-900/50 border-b border-slate-800 flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Live Data Feed</h3>
                <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-2 py-1 rounded-full font-bold">{scrapedData.length} Found</span>
              </div>
              <div className="overflow-auto flex-1 custom-scrollbar">
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-slate-950/50 sticky top-0 text-slate-500 font-bold uppercase tracking-tighter border-b border-slate-800">
                    <tr>
                      <th className="p-4">MC#</th>
                      <th className="p-4">Carrier Name</th>
                      <th className="p-4 text-indigo-400"><ShieldAlert size={12} className="inline mb-0.5 mr-1"/>Safety Rating</th>
                      <th className="p-4">Rating Date</th>
                      <th className="p-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {scrapedData.length === 0 ? (
                      <tr><td colSpan={5} className="p-20 text-center text-slate-700 italic">No records captured in this session.</td></tr>
                    ) : (
                      scrapedData.slice().reverse().map((row, i) => (
                        <tr key={i} className="hover:bg-indigo-500/[0.03] transition-colors border-b border-slate-800/30">
                          <td className="p-4 font-mono text-indigo-400">{row.mcNumber}</td>
                          <td className="p-4 font-bold text-slate-200 truncate max-w-[200px]">{row.legalName}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-lg font-black text-[9px] uppercase ${
                              row.safetyRating === 'Satisfactory' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                              row.safetyRating === 'Conditional' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 
                              'bg-slate-800/50 text-slate-500'
                            }`}>
                              {row.safetyRating || 'NOT RATED'}
                            </span>
                          </td>
                          <td className="p-4 text-slate-500 font-mono">{row.ratingDate || '—'}</td>
                          <td className="p-4 text-center">
                            {row.status.includes('AUTHORIZED') ? 
                              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span> : 
                              <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                            }
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
