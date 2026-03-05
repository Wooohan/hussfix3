import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, Download, Pause, Activity, Terminal as TerminalIcon, 
  AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, X, Info, Database 
} from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { generateMockCarrier, scrapeRealCarrier, downloadCSV } from '../services/mockService';
import { saveCarrierToSupabase } from '../services/supabaseClient';

const CONCURRENCY_LIMIT = 5;

interface ScraperProps {
  user: User;
  onUpdateUsage: (count: number) => void;
  onUpgrade: () => void;
}

export const Scraper: React.FC<ScraperProps> = ({ user, onUpdateUsage, onUpgrade }) => {
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

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
          await new Promise(r => setTimeout(r, 150));
          newData = generateMockCarrier(mc, config.includeBrokers);
        } else {
          newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) {
        setLogs(prev => [...prev, `[Error] MC ${mc}: Connection Failed`]);
      }

      if (newData) {
        // --- DATA PARSING LOGIC FOR POWER UNITS, DRIVERS, MILEAGE ---
        const raw = newData.rawContent || "";
        const powerUnitsMatch = raw.match(/Power Units:\s*(\d+)/i);
        const driversMatch = raw.match(/Drivers:\s*(\d+)/i);
        const mileageMatch = raw.match(/([\d,]+)\s*\(\d{4}\)/i); // Extracts mileage before the year (2023)

        newData.powerUnits = powerUnitsMatch ? parseInt(powerUnitsMatch[1]) : newData.powerUnits;
        newData.drivers = driversMatch ? parseInt(driversMatch[1]) : newData.drivers;
        newData.mileage = mileageMatch ? mileageMatch[1] : newData.mileage;

        const type = newData.entityType.toUpperCase();
        const isCarrier = type.includes('CARRIER');
        const isBroker = type.includes('BROKER');
        const status = newData.status.toUpperCase();

        let matchesFilter = true;
        if (!config.includeCarriers && isCarrier && !isBroker) matchesFilter = false;
        if (!config.includeBrokers && isBroker && !isCarrier) matchesFilter = false;
        if (config.onlyAuthorized && (status.includes('NOT AUTHORIZED') || !status.includes('AUTHORIZED'))) {
          matchesFilter = false;
        }

        if (matchesFilter) {
          try {
            const dbResponse = await saveCarrierToSupabase(newData);
            if (dbResponse.success) {
              setDbSaveCount(prev => prev + 1);
              setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} (Synced)`]);
              setScrapedData(prev => [...prev, newData!]);
              sessionExtracted++;
              onUpdateUsage(1);
            }
          } catch (dbErr) {
            setLogs(prev => [...prev, `[DB Error] MC ${mc}`]);
          }
        }
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
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative bg-slate-900 text-slate-100">
      
      {/* 1. Detail Modal */}
      {selectedCarrier && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedCarrier.legalName}</h2>
                <p className="text-slate-400 font-mono text-sm">MC# {selectedCarrier.mcNumber} | DOT# {selectedCarrier.dotNumber}</p>
              </div>
              <button onClick={() => setSelectedCarrier(null)} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Power Units</span>
                  <div className="text-xl font-bold text-indigo-400">{selectedCarrier.powerUnits || '--'}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Drivers</span>
                  <div className="text-xl font-bold text-indigo-400">{selectedCarrier.drivers || '--'}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mileage / VMT</span>
                  <div className="text-xl font-bold text-indigo-400">{selectedCarrier.mileage || '--'}</div>
                </div>
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Status</span>
                  <div className="text-xs font-bold text-green-400 truncate">{selectedCarrier.status}</div>
                </div>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                 <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2"><Info size={16}/> Raw Data Extraction</h3>
                 <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono leading-tight">
                    {selectedCarrier.rawContent}
                 </pre>
              </div>
            </div>
            <div className="p-6 border-t border-slate-700 bg-slate-800/50 flex justify-end">
              <button onClick={() => setSelectedCarrier(null)} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Live Scraper</h1>
          <p className="text-slate-400">Automated FMCSA Extraction Engine</p>
        </div>
        <div className="flex gap-4">
          <button onClick={toggleRun} className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all shadow-lg ${isRunning ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
            {isRunning ? <><Pause size={20} /> Stop</> : <><Play size={20} /> Start Extraction</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* 3. Config Sidebar */}
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Activity className="text-indigo-400" /> Parameters</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Start MC Number</label>
                <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" disabled={isRunning} />
              </div>
              
              <div className="pt-2 space-y-3">
                <label className="text-sm font-medium text-slate-400">Target Entities</label>
                <div className="flex flex-col gap-3 bg-slate-900 p-4 rounded-xl border border-slate-700">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={config.includeCarriers} onChange={(e) => setConfig({...config, includeCarriers: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-800" disabled={isRunning} />
                    <span className="text-sm text-slate-200">Carriers</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={config.includeBrokers} onChange={(e) => setConfig({...config, includeBrokers: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-800" disabled={isRunning} />
                    <span className="text-sm text-slate-200">Brokers</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer border-t border-slate-700 pt-2 mt-1">
                    <input type="checkbox" checked={config.onlyAuthorized} onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-800" disabled={isRunning} />
                    <span className="text-sm text-slate-200">Only Authorized Status</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
             <div className="flex justify-between text-sm mb-4">
               <div className="flex flex-col">
                 <span className="text-slate-400 text-xs uppercase">Supabase Sync</span>
                 <span className="text-emerald-400 font-bold flex items-center gap-1"><Database size={12}/> {dbSaveCount} Saved</span>
               </div>
               <div className="text-right">
                 <span className="text-slate-400 text-xs uppercase">Progress</span>
                 <div className="text-white font-bold">{progress}%</div>
               </div>
             </div>
             <div className="w-full bg-slate-900 rounded-full h-2">
               <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
             </div>
          </div>
        </div>

        {/* 4. Terminal and Table */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full min-h-0">
          <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-[11px] p-4 overflow-y-auto custom-scrollbar relative">
             <div className="sticky top-0 bg-slate-900/90 backdrop-blur p-2 border-b border-slate-800 flex items-center justify-between z-10 mb-2">
                <div className="flex items-center gap-2 text-slate-400"><TerminalIcon size={14} /> Console</div>
                {config.useProxy && <div className="text-green-500 flex items-center gap-1"><ShieldCheck size={12} /> Proxy Protected</div>}
             </div>
             {logs.map((log, i) => (
               <div key={i} className={`pb-1 ${log.includes('[Success]') ? 'text-green-400' : 'text-slate-400'}`}>
                 <span className="opacity-30 mr-2">{new Date().toLocaleTimeString()}</span>{log}
               </div>
             ))}
             <div ref={logsEndRef} />
          </div>

          <div className="h-64 bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden">
             <table className="w-full text-left text-xs">
               <thead className="bg-slate-900 text-slate-400 sticky top-0">
                 <tr>
                   <th className="p-3">MC#</th>
                   <th className="p-3">Legal Name</th>
                   <th className="p-3 text-center">Units</th>
                   <th className="p-3 text-center">Drivers</th>
                   <th className="p-3 text-right">Action</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-800">
                 {scrapedData.slice().reverse().map((row, i) => (
                   <tr key={i} className="hover:bg-slate-700/30">
                     <td className="p-3 text-indigo-400 font-mono">{row.mcNumber}</td>
                     <td className="p-3 text-slate-200 truncate max-w-[180px]">{row.legalName}</td>
                     <td className="p-3 text-center text-slate-400">{row.powerUnits || '-'}</td>
                     <td className="p-3 text-center text-slate-400">{row.drivers || '-'}</td>
                     <td className="p-3 text-right">
                       <button onClick={() => setSelectedCarrier(row)} className="text-indigo-400 hover:text-white transition-colors">Details</button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
          </div>
        </div>
      </div>
    </div>
  );
};
