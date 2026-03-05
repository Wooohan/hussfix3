import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, Database } from 'lucide-react';
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

  // --- LOGIC TO PARSE THE "CHUNK" DATA ---
  const parseRawDataChunk = (raw: string) => {
    const powerUnits = raw.match(/Power Units:\s*(\d+)/)?.[1] || "0";
    const drivers = raw.match(/Drivers:\s*(\d+)/)?.[1] || "0";
    const mileage = raw.match(/(\d{1,3}(?:,\d{3})*)\s*\((\d{4})\)/)?.[1] || "0";
    const mileageYear = raw.match(/(\d{1,3}(?:,\d{3})*)\s*\((\d{4})\)/)?.[2] || "";
    
    return { powerUnits, drivers, mcs150_mileage: mileage, mcs150_date: mileageYear };
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
      setLogs(prev => [...prev, `🚀 Initializing High-Speed Scraper...`]);
      setLogs(prev => [...prev, `Target: ${config.includeCarriers ? 'Carriers' : ''} ${config.includeBrokers ? 'Brokers' : ''}`]);
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

      let newData: any | null = null;
      try {
        if (config.useMockData) {
           await new Promise(r => setTimeout(r, 100));
           const isBroker = config.includeBrokers && (!config.includeCarriers || Math.random() > 0.5);
           newData = generateMockCarrier(mc, isBroker);
        } else {
           newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) { /* fail silent */ }

      if (newData) {
          // Check if data is a "Chunk" and parse it
          if (typeof newData.powerUnits !== 'string' || newData.powerUnits.length > 5) {
             const parsed = parseRawDataChunk(newData.raw || "");
             newData = { ...newData, ...parsed };
          }

          let matchesFilter = true;
          const type = (newData.entityType || "").toUpperCase();
          const status = (newData.status || "").toUpperCase();

          if (!config.includeCarriers && type.includes('CARRIER')) matchesFilter = false;
          if (!config.includeBrokers && type.includes('BROKER')) matchesFilter = false;
          if (config.onlyAuthorized && (!status.includes('AUTHORIZED') || status.includes('NOT AUTHORIZED'))) matchesFilter = false;

          if (matchesFilter) {
              setScrapedData(prev => [...prev, newData!]);
              successfulResults.push(newData!);
              
              const saveResult = await saveCarrierToSupabase(newData!);
              if (saveResult.success) {
                setDbSaveCount(prev => prev + 1);
                setLogs(prev => [...prev, `[Success] MC ${mc} → Saved`]);
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
    setLogs(prev => [...prev, `✅ Batch Complete. Extracted: ${successfulResults.length}`]);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative">
      {/* ... Upgrade Modal Code ... */}

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Live Scraper</h1>
          <p className="text-slate-400">Automated FMCSA Extraction Engine</p>
        </div>
        <div className="flex gap-4">
          <button onClick={toggleRun} className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all shadow-lg ${isRunning ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
            {isRunning ? <><Pause size={20} /> Stop</> : <><Play size={20} /> Start Extraction</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">
          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity className="text-indigo-400" /> Parameters
            </h2>
            
            <div className="space-y-4">
              {/* MC Number & Record Count Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Start MC</label>
                  <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none" disabled={isRunning} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Count</label>
                  <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none" disabled={isRunning} />
                </div>
              </div>

              {/* REQUESTED INPUT OPTIONS */}
              <div className="pt-4 border-t border-slate-700">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Target Entities</label>
                <div className="grid grid-cols-1 gap-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input type="checkbox" checked={config.includeCarriers} onChange={(e) => setConfig({...config, includeCarriers: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-900" disabled={isRunning} />
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Carriers</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input type="checkbox" checked={config.includeBrokers} onChange={(e) => setConfig({...config, includeBrokers: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-900" disabled={isRunning} />
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Brokers</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group pt-2 border-t border-slate-700/50 mt-1">
                    <input type="checkbox" checked={config.onlyAuthorized} onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-900" disabled={isRunning} />
                    <span className="text-sm text-white font-medium">Only Authorized Status</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          
          {/* Progress Section */}
          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
             <div className="flex justify-between text-sm mb-2">
               <span className="text-slate-400">Batch Progress</span>
               <span className="text-white font-bold">{progress}%</span>
             </div>
             <div className="w-full bg-slate-900 rounded-full h-2.5">
               <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
             </div>
          </div>
        </div>

        {/* Terminal and Table Preview */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full min-h-0">
          <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-sm p-4 overflow-y-auto custom-scrollbar relative">
             {/* Terminal Content Mapping */}
             <div className="mt-8 space-y-1">
               {logs.map((log, i) => (
                 <div key={i} className="pb-1 border-b border-slate-900/50 text-slate-300">
                   <span className="opacity-50 mr-2 text-[10px]">{new Date().toLocaleTimeString()}</span>{log}
                 </div>
               ))}
               <div ref={logsEndRef} />
             </div>
          </div>

          {/* Table with parsed columns */}
          <div className="h-72 bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-sm text-slate-400">
                <thead className="bg-slate-900 text-slate-200 sticky top-0">
                  <tr>
                    <th className="p-3 text-[10px] uppercase">MC#</th>
                    <th className="p-3 text-[10px] uppercase">Legal Name</th>
                    <th className="p-3 text-[10px] uppercase text-indigo-400">Units</th>
                    <th className="p-3 text-[10px] uppercase text-indigo-400">Drivers</th>
                    <th className="p-3 text-[10px] uppercase text-indigo-400">Mileage</th>
                    <th className="p-3 text-[10px] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {scrapedData.slice().reverse().map((row, i) => (
                    <tr key={i} className="hover:bg-slate-700/50 transition-colors">
                      <td className="p-3 font-mono text-white text-xs">{row.mcNumber}</td>
                      <td className="p-3 truncate max-w-[120px] text-xs">{row.legalName}</td>
                      <td className="p-3 text-white font-bold">{row.powerUnits || '-'}</td>
                      <td className="p-3 text-white font-bold">{row.drivers || '-'}</td>
                      <td className="p-3 text-xs text-slate-300">{row.mcs150_mileage || '0'} <span className="opacity-50 text-[10px]">({row.mcs150_date})</span></td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${row.status.includes('AUTH') ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {row.status.includes('AUTH') ? 'Active' : 'Inactive'}
                        </span>
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
  );
};
