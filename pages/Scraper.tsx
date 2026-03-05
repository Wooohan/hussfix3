import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, Download, Pause, Activity, Terminal as TerminalIcon, 
  AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, X, Info 
} from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { generateMockCarrier, scrapeRealCarrier, downloadCSV } from '../services/mockService';

// --- ADDED IMPORT ---
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
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  // Auto-scroll for terminal logs
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
      setLogs(prev => [...prev, `Mode: ${config.useMockData ? 'Simulation' : config.useProxy ? 'Proxy Network' : 'Direct (VPN)'}`]);
      setLogs(prev => [...prev, `Targeting ${config.recordCount} records starting at MC# ${config.startPoint}`]);
      setScrapedData([]);
      setProgress(0);
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
        setLogs(prev => [...prev, "⛔ DAILY LIMIT REACHED: Upgrade to extract more."]);
        setShowUpgradeModal(true);
        return;
      }

      let newData: CarrierData | null = null;
      try {
        if (config.useMockData) {
          await new Promise(r => setTimeout(r, 150)); // Simulated network lag
          const isBroker = config.includeBrokers && (!config.includeCarriers || Math.random() > 0.5);
          newData = generateMockCarrier(mc, isBroker);
        } else {
          newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) {
        setLogs(prev => [...prev, `[Error] MC ${mc}: Connection Failed`]);
      }

      if (newData) {
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
          // --- INTEGRATED SUPABASE SAVE LOGIC ---
          setLogs(prev => [...prev, `[Sync] MC ${mc}: Sending to Cloud...`]);
          
          try {
            const dbResponse = await saveCarrierToSupabase(newData);
            
            if (dbResponse.success) {
              setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} (Saved to DB)`]);
              setScrapedData(prev => [...prev, newData!]);
              sessionExtracted++;
              onUpdateUsage(1);
            } else {
              setLogs(prev => [...prev, `[DB Error] MC ${mc}: ${dbResponse.error}`]);
              // We still add to local UI even if DB fails, or you can skip it
              setScrapedData(prev => [...prev, newData!]);
            }
          } catch (dbErr: any) {
            setLogs(prev => [...prev, `[Critical Error] MC ${mc}: ${dbErr.message}`]);
          }
          // --- END INTEGRATION ---
        }
      } else {
        setLogs(prev => [...prev, `[Fail] MC ${mc} - No Data Found`]);
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
      if (activePromises.length >= CONCURRENCY_LIMIT) {
        await Promise.race(activePromises);
      }
    }
    await Promise.all(activePromises);

    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, "✅ Batch Job Complete."]);
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
                <p className="text-slate-400 font-mono">MC# {selectedCarrier.mcNumber} | DOT# {selectedCarrier.dotNumber}</p>
              </div>
              <button onClick={() => setSelectedCarrier(null)} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 text-center">
                  <span className="text-xs font-bold text-slate-500 uppercase mb-2 block">Safety Rating</span>
                  <div className={`text-xl font-black px-4 py-2 rounded-lg inline-block ${
                    selectedCarrier.safetyRating === 'SATISFACTORY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {selectedCarrier.safetyRating || 'UNRATED'}
                  </div>
                </div>
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 text-center">
                  <span className="text-xs font-bold text-slate-500 uppercase mb-2 block">Authority Status</span>
                  <div className="text-sm font-bold text-blue-400 bg-blue-500/10 px-3 py-2 rounded-lg">
                    {selectedCarrier.status}
                  </div>
                </div>
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 text-center">
                  <span className="text-xs font-bold text-slate-500 uppercase mb-2 block">Contact</span>
                  <div className="text-white text-sm truncate">{selectedCarrier.email || 'No Email'}</div>
                  <div className="text-slate-400 text-xs mt-1">{selectedCarrier.phone}</div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Activity size={20} className="text-indigo-400" /> BASIC Scores</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectedCarrier.basicScores?.map((score, i) => (
                    <div key={i} className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
                      <div className="text-[10px] font-bold text-slate-500 uppercase truncate" title={score.category}>{score.category}</div>
                      <div className="text-lg font-mono text-white mt-1">{score.measure}</div>
                    </div>
                  ))}
                </div>
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
          {scrapedData.length > 0 && (
            <button onClick={() => downloadCSV(scrapedData)} className="flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-all">
              <Download size={20} /> Export CSV
            </button>
          )}
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
                <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none" disabled={isRunning} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Number of Records</label>
                <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none" disabled={isRunning} />
              </div>
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-white">Use Secure Proxy</span>
                  <input type="checkbox" checked={config.useProxy} onChange={(e) => setConfig({...config, useProxy: e.target.checked})} className="w-4 h-4 rounded border-slate-600 text-indigo-600 bg-slate-900" disabled={isRunning} />
                </label>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
             <div className="flex justify-between text-sm mb-2">
               <span className="text-slate-400">Batch Progress</span>
               <span className="text-white font-bold">{progress}%</span>
             </div>
             <div className="w-full bg-slate-900 rounded-full h-2.5">
               <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
             </div>
          </div>
        </div>

        {/* 4. Terminal and Table */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full min-h-0">
          <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-sm p-4 overflow-y-auto custom-scrollbar relative">
             <div className="sticky top-0 bg-slate-900/90 backdrop-blur p-2 border-b border-slate-800 flex items-center justify-between z-10">
                <div className="flex items-center gap-2 text-slate-400 text-xs"><TerminalIcon size={14} /> System Console</div>
                {config.useProxy && <div className="flex items-center gap-1 text-green-500 text-[10px]"><ShieldCheck size={12} /> Proxy Active</div>}
             </div>
             <div className="mt-4 space-y-1">
               {logs.map((log, i) => (
                 <div key={i} className={`pb-1 border-b border-slate-900/50 ${log.includes('[Success]') ? 'text-green-400' : log.includes('[Error]') || log.includes('[DB Error]') ? 'text-red-400' : log.includes('[Sync]') ? 'text-blue-400' : 'text-slate-300'}`}>
                   <span className="opacity-30 mr-2 text-[10px]">{new Date().toLocaleTimeString()}</span>{log}
                 </div>
               ))}
               <div ref={logsEndRef} />
             </div>
          </div>

          <div className="h-64 bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-sm text-slate-400">
                <thead className="bg-slate-900 text-slate-200 sticky top-0">
                  <tr>
                    <th className="p-3">MC#</th>
                    <th className="p-3">Legal Name</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {scrapedData.slice().reverse().map((row, i) => (
                    <tr key={i} className="hover:bg-slate-700/50 group">
                      <td className="p-3 font-mono text-white">{row.mcNumber}</td>
                      <td className="p-3 truncate max-w-[200px]">{row.legalName}</td>
                      <td className="p-3"><CheckCircle2 size={16} className="text-green-500" /></td>
                      <td className="p-3">
                        <button onClick={() => setSelectedCarrier(row)} className="text-xs text-indigo-400 font-bold">Details</button>
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
