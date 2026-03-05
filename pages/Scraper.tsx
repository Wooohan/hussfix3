import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, Lock, Database, ShieldAlert, Loader2 } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
// We are going to use the same services that your working component uses
import { scrapeRealCarrier, fetchSafetyData, downloadCSV } from '../services/mockService';
import { saveCarrierToSupabase, updateCarrierSafety } from '../services/supabaseClient';

const CONCURRENCY_LIMIT = 2; // Keep low to prevent 403 Forbidden blocks

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
    recordCount: 20, // Smaller batches are safer
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

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const toggleRun = () => {
    if (isRunning) {
      isRunningRef.current = false;
      setIsRunning(false);
      setLogs(prev => [...prev, "⚠️ Stopping engine..."]);
    } else {
      if (user.recordsExtractedToday >= user.dailyLimit) {
        setShowUpgradeModal(true);
        return;
      }
      setIsRunning(true);
      isRunningRef.current = true;
      setLogs(prev => [...prev, `🚀 INITIALIZING PAIRED EXTRACTION...`]);
      setScrapedData([]);
      setProgress(0);
      processBatch();
    }
  };

  const processBatch = async () => {
    const start = parseInt(config.startPoint);
    const total = config.recordCount;
    
    for (let i = 0; i < total; i++) {
      if (!isRunningRef.current) break;

      const currentMc = (start + i).toString();
      setLogs(prev => [...prev, `📡 Querying MC ${currentMc}...`]);

      try {
        // STEP 1: Get basic info (DOT Number)
        const carrierBase = await scrapeRealCarrier(currentMc, config.useProxy);
        
        if (carrierBase && carrierBase.dotNumber) {
          // STEP 2: Use the working Safety Fetcher from your other component
          const safetyInfo = await fetchSafetyData(carrierBase.dotNumber);
          
          const fullCarrier: CarrierData = {
            ...carrierBase,
            safetyRating: safetyInfo?.rating || 'NOT RATED',
            ratingDate: safetyInfo?.date || '—'
          };

          // STEP 3: Filter & Save
          const isAuthorized = fullCarrier.status.toUpperCase().includes('AUTHORIZED');
          if (!config.onlyAuthorized || isAuthorized) {
            
            await saveCarrierToSupabase(fullCarrier);
            // If safety info was found, we also call the safety update just like your working code
            if (safetyInfo) await updateCarrierSafety(fullCarrier.dotNumber, safetyInfo);

            setScrapedData(prev => [...prev, fullCarrier]);
            setDbSaveCount(c => c + 1);
            setLogs(prev => [...prev, `✨ [MATCH] ${fullCarrier.legalName} | 🛡️ Rating: ${fullCarrier.safetyRating}`]);
            onUpdateUsage(1);
          }
        } else {
          setLogs(prev => [...prev, `❌ MC ${currentMc}: No record found.`]);
        }
      } catch (err) {
        setLogs(prev => [...prev, `⚠️ Error on MC ${currentMc}: Rate limited or connection lost.`]);
      }

      setProgress(Math.round(((i + 1) / total) * 100));
      // Vital 1-second delay to match your working component's logic
      await sleep(1200); 
    }

    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `🎉 BATCH COMPLETE.`]);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* Modal for Limits */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-8 rounded-3xl max-w-sm text-center shadow-2xl">
            <Lock className="mx-auto mb-4 text-indigo-400" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">Limit Reached</h2>
            <button onClick={onUpgrade} className="w-full py-3 bg-indigo-600 rounded-xl font-bold transition-all">Upgrade Now</button>
            <button onClick={() => setShowUpgradeModal(false)} className="mt-2 text-slate-500 text-xs uppercase">Dismiss</button>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 p-6 md:p-10 space-y-6 min-h-0">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black text-white italic">SMS<span className="text-indigo-500 not-italic">SCRAPER</span></h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em]">Safety & Insurance Intelligence</p>
          </div>
          <div className="flex gap-4">
             <button onClick={() => downloadCSV(scrapedData)} className="px-6 py-3 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-bold hover:bg-slate-800 transition-all">
                Download CSV
             </button>
             <button onClick={toggleRun} className={`px-8 py-3 rounded-2xl font-black flex items-center gap-2 transition-all ${isRunning ? 'bg-red-500 shadow-red-500/20' : 'bg-indigo-600 shadow-indigo-500/20 shadow-lg'}`}>
                {isRunning ? <><Loader2 className="animate-spin" size={18}/> STOP</> : <><Play size={18}/> START ENGINE</>}
             </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
          {/* Sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
            <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-[2rem]">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Start MC#</label>
                  <input type="text" value={config.startPoint} onChange={e => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 text-white" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Count</label>
                  <input type="number" value={config.recordCount} onChange={e => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 outline-none focus:border-indigo-500 text-white" />
                </div>
              </div>
            </div>

            <div className="bg-indigo-600 p-6 rounded-[2rem] shadow-xl">
               <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-black text-indigo-200 uppercase">Live Progress</span>
                  <Database size={20} className="text-indigo-300" />
               </div>
               <div className="text-4xl font-black text-white mb-4">{progress}%</div>
               <div className="w-full bg-indigo-900 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-white h-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
               </div>
            </div>
          </div>

          {/* Main Console */}
          <div className="col-span-12 lg:col-span-8 flex flex-col min-h-0">
             <div className="flex-1 bg-slate-950 border border-slate-800 rounded-[2rem] p-6 font-mono text-[11px] overflow-y-auto custom-scrollbar mb-6">
                <div className="flex items-center gap-2 text-slate-500 mb-4 border-b border-slate-900 pb-2">
                   <TerminalIcon size={14} /> SYSTEM_LOGS
                </div>
                {logs.map((log, i) => (
                  <div key={i} className={`mb-1 ${log.includes('Success') || log.includes('MATCH') ? 'text-indigo-400' : 'text-slate-500'}`}>
                    <span className="opacity-30 mr-2">[{new Date().toLocaleTimeString()}]</span>
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
             </div>

             <div className="flex-1 bg-slate-900/30 border border-slate-800 rounded-[2rem] overflow-hidden flex flex-col min-h-0">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center px-6">
                   <span className="text-[10px] font-black text-slate-500 uppercase">Live Feed ({scrapedData.length})</span>
                </div>
                <div className="overflow-auto flex-1 custom-scrollbar">
                   <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-950 text-slate-500 sticky top-0">
                         <tr>
                            <th className="p-4">MC#</th>
                            <th className="p-4">Name</th>
                            <th className="p-4">Rating</th>
                            <th className="p-4">Status</th>
                         </tr>
                      </thead>
                      <tbody>
                        {scrapedData.slice().reverse().map((row, i) => (
                          <tr key={i} className="border-b border-slate-800/50 hover:bg-white/5 transition-colors">
                            <td className="p-4 font-bold text-indigo-400">{row.mcNumber}</td>
                            <td className="p-4 text-white truncate max-w-[150px]">{row.legalName}</td>
                            <td className="p-4">
                               <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${row.safetyRating === 'Satisfactory' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                                  {row.safetyRating}
                               </span>
                            </td>
                            <td className="p-4">
                               <div className={`w-2 h-2 rounded-full ${row.status.includes('AUTHORIZED') ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}></div>
                            </td>
                          </tr>
                        ))}
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
