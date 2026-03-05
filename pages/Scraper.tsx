import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, Database, ShieldAlert } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { generateMockCarrier, scrapeRealCarrier, downloadCSV } from '../services/mockService';
import { saveCarrierToSupabase } from '../services/supabaseClient';

const CONCURRENCY_LIMIT = 5;

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
      setLogs(prev => [...prev, `🚀 Initializing High-Speed Scraper...`]);
      setLogs(prev => [...prev, `Targeting ${config.recordCount} records (Including Safety Ratings)`]);
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
    const initialUsed = user.recordsExtractedToday;
    const limit = user.dailyLimit;
    
    const tasks = Array.from({ length: total }, (_, i) => (start + i).toString());
    const successfulResults: CarrierData[] = [];

    const worker = async (mc: string) => {
      if (!isRunningRef.current) return;

      if (initialUsed + sessionExtracted >= limit) {
        isRunningRef.current = false;
        setIsRunning(false);
        setLogs(prev => [...prev, "⛔ DAILY LIMIT REACHED"]);
        setShowUpgradeModal(true);
        return;
      }

      let newData: CarrierData | null = null;
      try {
        if (config.useMockData) {
           await new Promise(r => setTimeout(r, 100));
           newData = generateMockCarrier(mc, config.includeBrokers);
        } else {
           // This function must now fetch Safety Ratings from the CompleteProfile URL
           newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) { /* silent fail */ }

      if (newData) {
         let matchesFilter = true;
         if (config.onlyAuthorized && !newData.status.toUpperCase().includes('AUTHORIZED')) matchesFilter = false;

         if (matchesFilter) {
             setScrapedData(prev => [...prev, newData!]);
             successfulResults.push(newData!);
             
             const saveResult = await saveCarrierToSupabase(newData!);
             if (saveResult.success) {
               setDbSaveCount(prev => prev + 1);
               setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} | Rating: ${newData!.safetyRating || 'N/A'}`]);
             }
             
             sessionExtracted++;
             onUpdateUsage(1);
         }
      }

      completed++;
      setProgress(Math.round((completed / total) * 100));
    };

    const activePromises: Promise<void>[] = [];
    for (const mc of tasks) {
      if (!isRunningRef.current) break;
      const p = worker(mc).then(() => { activePromises.splice(activePromises.indexOf(p), 1); });
      activePromises.push(p);
      if (activePromises.length >= CONCURRENCY_LIMIT) await Promise.race(activePromises);
    }

    await Promise.all(activePromises);
    if (successfulResults.length > 0) onNewCarriers(successfulResults);
    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `✅ Batch Complete. Extracted ${successfulResults.length} records.`]);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative bg-slate-950 text-slate-200">
      
      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-700 p-8 rounded-2xl max-w-md text-center">
              <Lock className="mx-auto mb-4 text-indigo-400" size={48} />
              <h2 className="text-2xl font-bold mb-2">Daily Limit Reached</h2>
              <button onClick={() => setShowUpgradeModal(false)} className="mt-4 px-6 py-2 bg-indigo-600 rounded-lg">Close</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Safety Scraper Pro</h1>
          <p className="text-slate-400 text-sm">Extracting FMCSA MC Data & Safety Ratings</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleDownload} className="px-4 py-2 bg-slate-800 rounded-xl flex items-center gap-2 hover:bg-slate-700">
            <Download size={18} /> Export
          </button>
          <button onClick={toggleRun} className={`px-6 py-2 rounded-xl font-bold flex items-center gap-2 ${isRunning ? 'bg-red-500' : 'bg-indigo-600'}`}>
            {isRunning ? <Pause size={18} /> : <Play size={18} />} {isRunning ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        
        {/* Config Sidebar */}
        <div className="col-span-4 space-y-4 overflow-y-auto pr-2">
          <div className="bg-slate-800/40 border border-slate-800 p-5 rounded-2xl space-y-4">
            <h2 className="text-sm font-bold uppercase text-slate-500 tracking-widest">Parameters</h2>
            <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-900 border-slate-700 rounded-lg p-2" placeholder="Start MC" />
            <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-900 border-slate-700 rounded-lg p-2" />
            
            <div className="pt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config.onlyAuthorized} onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})} />
                Only Authorized
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config.useProxy} onChange={(e) => setConfig({...config, useProxy: e.target.checked})} />
                Secure Proxy Network
              </label>
            </div>
          </div>

          {/* Progress Card */}
          <div className="bg-slate-800/40 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between text-xs mb-2 text-slate-400 font-bold uppercase">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
              <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-4 flex justify-between items-end">
               <div>
                 <p className="text-[10px] text-slate-500 uppercase font-black">Saved to DB</p>
                 <p className="text-xl font-mono text-emerald-400">{dbSaveCount}</p>
               </div>
               <div className="text-right">
                 <p className="text-[10px] text-slate-500 uppercase font-black">Limit</p>
                 <p className="text-sm text-slate-300">{user.recordsExtractedToday} / {user.dailyLimit}</p>
               </div>
            </div>
          </div>
        </div>

        {/* Output Area */}
        <div className="col-span-8 flex flex-col gap-4 min-h-0">
          {/* Console */}
          <div className="flex-[2] bg-black border border-slate-800 rounded-2xl p-4 font-mono text-[12px] overflow-y-auto relative">
            <div className="sticky top-0 bg-black/80 backdrop-blur pb-2 mb-2 border-b border-slate-900 flex items-center gap-2 text-slate-500">
               <TerminalIcon size={14} /> System Console
            </div>
            {logs.map((log, i) => (
              <div key={i} className={`mb-1 ${log.includes('Success') ? 'text-emerald-400' : 'text-slate-400'}`}>
                <span className="opacity-30 mr-2">[{new Date().toLocaleTimeString()}]</span> {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>

          {/* Table Preview */}
          <div className="flex-[3] bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-3 bg-slate-800/50 border-b border-slate-800 text-xs font-bold uppercase tracking-tighter text-slate-400 flex justify-between">
              <span>Live Results</span>
              <span>{scrapedData.length} records</span>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead className="bg-slate-900 sticky top-0 text-slate-500">
                  <tr>
                    <th className="p-3">MC#</th>
                    <th className="p-3">Legal Name</th>
                    <th className="p-3 text-indigo-400"><ShieldAlert size={12} className="inline mr-1"/>Safety Rating</th>
                    <th className="p-3">Rating Date</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {scrapedData.length === 0 ? (
                    <tr><td colSpan={5} className="p-10 text-center text-slate-600">No data in current session.</td></tr>
                  ) : (
                    scrapedData.slice().reverse().map((row, i) => (
                      <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3 font-mono text-indigo-300">{row.mcNumber}</td>
                        <td className="p-3 font-bold text-slate-300 truncate max-w-[150px]">{row.legalName}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold ${
                            row.safetyRating === 'Satisfactory' ? 'bg-emerald-500/10 text-emerald-400' : 
                            row.safetyRating === 'Conditional' ? 'bg-yellow-500/10 text-yellow-400' : 
                            'bg-slate-800 text-slate-500'
                          }`}>
                            {row.safetyRating || 'NOT RATED'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500">{row.ratingDate || '-'}</td>
                        <td className="p-3">
                          {row.status.includes('AUTHORIZED') ? <span className="text-emerald-500">●</span> : <span className="text-red-500">●</span>}
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
  );
};
