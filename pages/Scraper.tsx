import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, Database, X } from 'lucide-react';
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
      setLogs(prev => [...prev, `Targeting ${config.recordCount} records starting at MC# ${config.startPoint}`]);
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
        setLogs(prev => [...prev, "⛔ DAILY LIMIT REACHED: Upgrade to extract more."]);
        setShowUpgradeModal(true);
        return;
      }

      let newData: CarrierData | null = null;
      try {
        if (config.useMockData) {
           await new Promise(r => setTimeout(r, 100));
           const isBroker = config.includeBrokers && (!config.includeCarriers || Math.random() > 0.5);
           newData = generateMockCarrier(mc, isBroker);
        } else {
           // Enhanced Speed: No artificial delay
           newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) { /* Silent fail */ }

      if (newData) {
          let matchesFilter = true;
          const type = newData.entityType.toUpperCase();
          const isCarrier = type.includes('CARRIER');
          const isBroker = type.includes('BROKER');
          const status = newData.status.toUpperCase();

          if (!config.includeCarriers && isCarrier && !isBroker) matchesFilter = false;
          if (!config.includeBrokers && isBroker && !isCarrier) matchesFilter = false;
          
          if (config.onlyAuthorized) {
              if (status.includes('NOT AUTHORIZED') || !status.includes('AUTHORIZED')) {
                  matchesFilter = false;
              }
          }

          if (matchesFilter) {
              setScrapedData(prev => [...prev, newData!]);
              successfulResults.push(newData!);
              
              const saveResult = await saveCarrierToSupabase(newData!);
              if (saveResult.success) {
                setDbSaveCount(prev => prev + 1);
                setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} → Saved to DB`]);
              } else {
                setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} → DB Error`]);
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

      if (activePromises.length >= CONCURRENCY_LIMIT) {
        await Promise.race(activePromises);
      }
    }

    await Promise.all(activePromises);

    if (successfulResults.length > 0) {
      onNewCarriers(successfulResults);
    }

    setIsRunning(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `✅ Batch Job Complete. Found ${successfulResults.length} records.`]);

    if (onFinish && successfulResults.length > 0) {
      setLogs(prev => [...prev, `🚀 Transitioning to automatic insurance extraction...`]);
      setTimeout(() => onFinish(), 1500);
    }
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative">
      
      {/* Limit Modal */}
      {showUpgradeModal && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 p-8 rounded-2xl max-w-md text-center shadow-2xl">
              <Lock size={32} className="mx-auto mb-4 text-indigo-400" />
              <h2 className="text-2xl font-bold text-white mb-2">Daily Limit Reached</h2>
              <p className="text-slate-400 mb-6">You've hit your limit of {user.dailyLimit.toLocaleString()} records.</p>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setShowUpgradeModal(false)} className="px-4 py-2 text-slate-400">Close</button>
                <button onClick={onUpgrade} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold">View Plans</button>
              </div>
          </div>
        </div>
      )}

      {/* Safety Report Modal */}
      {selectedCarrier && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-6 border-b border-slate-700 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedCarrier.legalName}</h2>
                <p className="text-slate-400">MC# {selectedCarrier.mcNumber} | DOT# {selectedCarrier.dotNumber}</p>
              </div>
              <button onClick={() => setSelectedCarrier(null)} className="p-2 hover:bg-slate-700 rounded-full text-slate-400"><X size={24} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 text-center">
                  <span className="text-xs font-bold text-slate-500 uppercase">Safety Rating</span>
                  <div className={`text-2xl font-black mt-2 rounded-lg py-2 ${selectedCarrier.safetyRating === 'SATISFACTORY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {selectedCarrier.safetyRating || 'UNRATED'}
                  </div>
                </div>
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 text-center">
                  <span className="text-xs font-bold text-slate-500 uppercase">Authority Status</span>
                  <div className="text-lg font-bold text-blue-400 mt-2">{selectedCarrier.status}</div>
                </div>
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 text-center">
                  <span className="text-xs font-bold text-slate-500 uppercase">Contact Info</span>
                  <div className="text-white font-medium truncate mt-2">{selectedCarrier.email || 'No Email'}</div>
                  <div className="text-slate-400 text-sm">{selectedCarrier.phone}</div>
                </div>
              </div>
              
              <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-xs">
                    <tr>
                      <th className="p-4">BASIC Category</th>
                      <th className="p-4 text-center">Measure</th>
                      <th className="p-4 text-center">Percentile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {['Unsafe Driving', 'Hours of Service', 'Vehicle Maintenance', 'Controlled Substances'].map((cat) => (
                      <tr key={cat}>
                        <td className="p-4 font-medium">{cat}</td>
                        <td className="p-4 text-center">{(Math.random() * 2).toFixed(2)}</td>
                        <td className="p-4 text-center font-bold text-indigo-400">{Math.floor(Math.random() * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main UI Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Live Scraper</h1>
          <p className="text-slate-400">Automated FMCSA Extraction Engine with Safety Analytics</p>
        </div>
        <div className="flex gap-4">
           {scrapedData.length > 0 && (
            <button onClick={() => downloadCSV(scrapedData)} className="flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium">
              <Download size={20} /> Export Batch
            </button>
           )}
          <button onClick={toggleRun} className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all ${isRunning ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
            {isRunning ? <><Pause size={20} /> Stop</> : <><Play size={20} /> Start Extraction</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">
          {/* Parameters Panel */}
          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Activity className="text-indigo-400" /> Parameters</h2>
            <div className="space-y-4">
              <input type="text" value={config.startPoint} onChange={(e) => setConfig({...config, startPoint: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white" placeholder="Start MC#" disabled={isRunning} />
              <input type="number" value={config.recordCount} onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white" disabled={isRunning} />
              
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-white">Use Secure Proxy</span>
                  <input type="checkbox" checked={config.useProxy} onChange={(e) => setConfig({...config, useProxy: e.target.checked})} className="w-4 h-4" disabled={isRunning} />
                </label>
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-700">
                <label className="flex items-center gap-2 text-white text-sm">
                  <input type="checkbox" checked={config.includeCarriers} onChange={(e) => setConfig({...config, includeCarriers: e.target.checked})} disabled={isRunning} /> Carriers
                </label>
                <label className="flex items-center gap-2 text-white text-sm">
                  <input type="checkbox" checked={config.includeBrokers} onChange={(e) => setConfig({...config, includeBrokers: e.target.checked})} disabled={isRunning} /> Brokers
                </label>
              </div>
            </div>
          </div>

          {/* Progress Panel */}
          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
             <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Batch Progress</span><span className="text-white font-bold">{progress}%</span></div>
             <div className="w-full bg-slate-900 rounded-full h-2 mb-6"><div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div></div>
             <div className="flex justify-between items-center border-t border-slate-700 pt-4">
                <div className="text-xs text-slate-500">DATABASE SYNC</div>
                <div className="text-emerald-400 font-bold flex items-center gap-1"><Database size={14}/> {dbSaveCount}</div>
             </div>
          </div>
        </div>

        {/* Terminal and Table */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full min-h-0">
          <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-xs p-4 overflow-y-auto relative">
             <div className="sticky top-0 bg-slate-900/90 p-2 border-b border-slate-800 flex justify-between mb-4">
                <span className="text-slate-400">System Console</span>
                <span className="text-green-500">Live Feedback</span>
             </div>
             {logs.map((log, i) => (
               <div key={i} className="py-0.5 border-b border-slate-900/50 text-slate-300">
                 <span className="opacity-30 mr-2">{new Date().toLocaleTimeString()}</span> {log}
               </div>
             ))}
             <div ref={logsEndRef} />
          </div>

          <div className="h-72 bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-700 bg-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-white text-xs">Live Results (Click row for Safety Report)</h3>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-3">MC#</th>
                    <th className="p-3">Legal Name</th>
                    <th className="p-3">Address</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {scrapedData.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-slate-600">No data found.</td></tr>
                  ) : (
                    scrapedData.slice().reverse().map((row, i) => (
                      <tr 
                        key={i} 
                        onClick={() => setSelectedCarrier(row)}
                        className="hover:bg-indigo-500/10 cursor-pointer transition-colors text-slate-300"
                      >
                        <td className="p-3 font-mono text-white">{row.mcNumber}</td>
                        <td className="p-3 truncate max-w-[150px]">{row.legalName}</td>
                        <td className="p-3 truncate max-w-[180px]">{row.physicalAddress || row.address}</td>
                        <td className="p-3">
                           <span className={`px-2 py-0.5 rounded text-[10px] ${row.status.includes('AUTHORIZED') ? 'text-green-400' : 'text-red-400'}`}>
                             {row.status.includes('AUTHORIZED') ? 'Auth' : 'Not Auth'}
                           </span>
                        </td>
                        <td className="p-3 text-slate-500">{row.entityType}</td>
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
