import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, Database, X, ExternalLink } from 'lucide-react';
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
  const [selectedCarrier, setSelectedCarrier] = useState<CarrierData | null>(null);
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
      setLogs(prev => [...prev, `Mode: ${config.useMockData ? 'Simulation' : config.useProxy ? 'Proxy Network' : 'Direct (VPN)'}`]);
      setLogs(prev => [...prev, `💾 Supabase integration: ACTIVE`]);
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
        setLogs(prev => [...prev, "⛔ DAILY LIMIT REACHED."]);
        setShowUpgradeModal(true);
        return;
      }

      let newData: CarrierData | null = null;
      try {
        if (config.useMockData) {
           await new Promise(r => setTimeout(r, 50)); // Faster mock
           newData = generateMockCarrier(mc, config.includeBrokers && Math.random() > 0.5);
        } else {
           newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) { /* silent fail */ }

      if (newData) {
          let matchesFilter = true;
          const status = newData.status.toUpperCase();

          if (config.onlyAuthorized && (status.includes('NOT AUTHORIZED') || !status.includes('AUTHORIZED'))) {
            matchesFilter = false;
          }

          if (matchesFilter) {
              setScrapedData(prev => [...prev, newData!]);
              successfulResults.push(newData!);
              
              // Database Persistence
              const saveResult = await saveCarrierToSupabase(newData!);
              if (saveResult.success) {
                setDbSaveCount(prev => prev + 1);
                setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} → DB Saved`]);
              }
              
              sessionExtracted++;
              onUpdateUsage(1);
          }
      } else {
          setLogs(prev => [...prev, `[Fail] MC ${mc} - No Data`]);
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
    if (successfulResults.length > 0) onNewCarriers(successfulResults);

    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `✅ Batch Complete. ${successfulResults.length} records found.`]);

    if (onFinish && successfulResults.length > 0) {
      setTimeout(() => onFinish(), 1500);
    }
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative bg-slate-950 text-slate-200">
      
      {/* 1. LIMIT MODAL */}
      {showUpgradeModal && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 p-8 rounded-2xl max-w-md text-center shadow-2xl">
              <Lock size={48} className="mx-auto mb-4 text-indigo-400" />
              <h2 className="text-2xl font-bold mb-2 text-white">Daily Limit Reached</h2>
              <p className="text-slate-400 mb-6">Upgrade to extract unlimited FMCSA data.</p>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setShowUpgradeModal(false)} className="px-4 py-2 text-slate-400">Close</button>
                <button onClick={onUpgrade} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">View Plans</button>
              </div>
          </div>
        </div>
      )}

      {/* 2. SAFETY REPORT MODAL */}
      {selectedCarrier && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedCarrier.legalName}</h2>
                <div className="flex gap-3 text-sm text-slate-400 mt-1">
                  <span>MC# <span className="text-indigo-400 font-mono">{selectedCarrier.mcNumber}</span></span>
                  <span>DOT# <span className="text-emerald-400 font-mono">{selectedCarrier.dotNumber}</span></span>
                </div>
              </div>
              <button onClick={() => setSelectedCarrier(null)} className="p-2 hover:bg-slate-700 rounded-full transition-colors"><X size={24} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Safety Rating</p>
                  <div className={`text-xl font-black py-1 rounded ${selectedCarrier.safetyRating === 'SATISFACTORY' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {selectedCarrier.safetyRating || 'NOT RATED'}
                  </div>
                </div>
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Authority</p>
                  <div className="text-indigo-400 font-bold">{selectedCarrier.status}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Contact</p>
                  <div className="text-white text-xs truncate">{selectedCarrier.email || 'No Email'}</div>
                  <div className="text-slate-500 text-[10px]">{selectedCarrier.phone}</div>
                </div>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
                <div className="p-3 bg-slate-800/50 border-b border-slate-700 text-xs font-bold flex items-center gap-2">
                  <Activity size={14} className="text-indigo-400" /> BASIC Safety Scores (SMS)
                </div>
                <table className="w-full text-xs text-left">
                   <thead className="text-slate-500">
                     <tr>
                       <th className="p-3">Category</th>
                       <th className="p-3 text-center">Measure</th>
                       <th className="p-3 text-center">Percentile</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-800">
                     {[
                       { lab: 'Unsafe Driving', val: selectedCarrier.unsafeDrivingPercentile },
                       { lab: 'HOS Compliance', val: selectedCarrier.hosCompliancePercentile },
                       { lab: 'Vehicle Maint.', val: selectedCarrier.vehicleMaintPercentile },
                       { lab: 'Controlled Subs.', val: selectedCarrier.controlledSubsPercentile }
                     ].map((item, idx) => (
                       <tr key={idx}>
                         <td className="p-3 text-slate-300">{item.lab}</td>
                         <td className="p-3 text-center">-</td>
                         <td className="p-3 text-center font-mono font-bold text-indigo-400">{item.val || '0'}%</td>
                       </tr>
                     ))}
                   </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. HEADER & CONTROLS */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Live Scraper <span className="text-indigo-500 text-sm font-normal">v2.4</span></h1>
          <p className="text-slate-500 text-sm">Industrial FMCSA Data Pipeline + Safety Intelligence</p>
        </div>
        <div className="flex gap-3">
           {scrapedData.length > 0 && (
            <button onClick={handleDownload} className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-all">
              <Download size={18} /> Export
            </button>
           )}
          <button
            onClick={toggleRun}
            className={`flex items-center gap-2 px-8 py-2.5 rounded-xl font-bold transition-all ${isRunning ? 'bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
          >
            {isRunning ? <><Pause size={20} /> Stop</> : <><Play size={20} /> Start Extraction</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* LEFT PANEL: CONFIG */}
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">
          <div className="bg-slate-800/40 border border-slate-700/50 p-5 rounded-2xl space-y-5">
            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <Activity size={16} className="text-indigo-400" /> Parameters
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Start MC Range</label>
                <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:ring-1 focus:ring-indigo-500" disabled={isRunning} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                  <input type="checkbox" checked={config.includeCarriers} onChange={(e) => setConfig({...config, includeCarriers: e.target.checked})} className="rounded text-indigo-600" disabled={isRunning} />
                  <span className="text-xs">Carriers</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                  <input type="checkbox" checked={config.includeBrokers} onChange={(e) => setConfig({...config, includeBrokers: e.target.checked})} className="rounded text-indigo-600" disabled={isRunning} />
                  <span className="text-xs">Brokers</span>
                </label>
              </div>
            </div>
            
            {/* PROGRESS SECTION */}
            <div className="pt-4 border-t border-slate-700/50">
               <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-2 uppercase">
                 <span>Batch Progress</span>
                 <span className="text-indigo-400">{progress}%</span>
               </div>
               <div className="w-full bg-slate-900 rounded-full h-1.5">
                 <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
               </div>
               <div className="flex justify-between mt-4">
                 <div className="text-center">
                   <p className="text-[10px] text-slate-500 uppercase">Saved to DB</p>
                   <p className="text-xl font-bold text-emerald-400">{dbSaveCount}</p>
                 </div>
                 <div className="text-center">
                   <p className="text-[10px] text-slate-500 uppercase">Limit Used</p>
                   <p className="text-xl font-bold text-white">{user.recordsExtractedToday}</p>
                 </div>
               </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: LOGS & TABLE */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full min-h-0">
          {/* CONSOLE */}
          <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-[11px] p-4 overflow-y-auto relative">
             <div className="flex items-center gap-2 mb-4 text-slate-600 border-b border-slate-900 pb-2">
                <TerminalIcon size={12} /> SYSTEM_KERNEL_LOG_STREAM
             </div>
             <div className="space-y-1">
               {logs.map((log, i) => (
                 <div key={i} className={`${log.includes('[Success]') ? 'text-emerald-500' : log.includes('[Fail]') ? 'text-red-400' : 'text-slate-400'}`}>
                   <span className="opacity-30 mr-2">[{new Date().toLocaleTimeString()}]</span> {log}
                 </div>
               ))}
               <div ref={logsEndRef} />
             </div>
          </div>

          {/* TABLE */}
          <div className="h-80 bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-center">
              <h3 className="font-bold text-xs uppercase tracking-tighter">Live Results <span className="text-slate-500 font-normal">(Click row for safety report)</span></h3>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs text-slate-400">
                <thead className="bg-slate-900/80 text-slate-500 sticky top-0 z-10">
                  <tr>
                    <th className="p-3">MC#</th>
                    <th className="p-3">LEGAL NAME</th>
                    <th className="p-3">ADDRESS</th>
                    <th className="p-3 text-center">SAFETY</th>
                    <th className="p-3 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {scrapedData.length === 0 ? (
                    <tr><td colSpan={5} className="p-10 text-center text-slate-600">No active extraction stream.</td></tr>
                  ) : (
                    scrapedData.slice().reverse().map((row, i) => (
                      <tr 
                        key={i} 
                        onClick={() => setSelectedCarrier(row)}
                        className="hover:bg-indigo-500/5 cursor-pointer transition-colors group"
                      >
                        <td className="p-3 font-mono text-white">{row.mcNumber}</td>
                        <td className="p-3 truncate max-w-[140px] font-medium">{row.legalName}</td>
                        <td className="p-3 truncate max-w-[180px] text-slate-500 italic">{row.physicalAddress || row.address || '-'}</td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${row.safetyRating === 'SATISFACTORY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-700 text-slate-400'}`}>
                            {row.safetyRating?.substring(0,4) || 'N/A'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button className="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1 w-full">
                            Report <ExternalLink size={12} />
                          </button>
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
