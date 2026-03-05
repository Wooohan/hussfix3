import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Pause, Activity, Terminal as TerminalIcon, AlertCircle, CheckCircle2, ShieldCheck, Zap, Lock, Database } from 'lucide-react';
import { CarrierData, ScraperConfig, User } from '../types';
import { generateMockCarrier, scrapeRealCarrier, downloadCSV } from '../services/mockService';
import { saveCarriersToSupabase } from '../services/supabaseClient';

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
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const pendingCarriersRef = useRef<CarrierData[]>([]);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // BACKGROUND DB WORKER: This is the secret to the 10s speed.
  // It saves records in the background so the scraper doesn't have to wait.
  useEffect(() => {
    const saveInterval = setInterval(() => {
      if (pendingCarriersRef.current.length > 0 && !isSavingToDb) {
        setIsSavingToDb(true);
        const batch = pendingCarriersRef.current.splice(0, 10); // Save in batches of 10
        
        saveCarriersToSupabase(batch).then(result => {
          if (result.success) {
            setDbSaveCount(prev => prev + result.saved);
          } else if (result.saved > 0) {
            setDbSaveCount(prev => prev + result.saved);
          }
          setIsSavingToDb(false);
        }).catch(() => {
          setIsSavingToDb(false);
        });
      }
    }, 1000);

    return () => clearInterval(saveInterval);
  }, [isSavingToDb]);

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
      setLogs(prev => [...prev, `💾 Supabase integration: ASYNC (Non-blocking)`]);
      setScrapedData([]);
      setProgress(0);
      setDbSaveCount(0);
      pendingCarriersRef.current = [];
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
           // No artificial delay - maximum speed
           newData = await scrapeRealCarrier(mc, config.useProxy);
        }
      } catch (e) {
        // Silent fail
      }

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
             
             // CRITICAL: Add to pending queue for async DB save (non-blocking)
             pendingCarriersRef.current.push(newData!);
             
             setLogs(prev => [...prev, `[Success] MC ${mc}: ${newData!.legalName} | Safety: ${newData!.safetyRating || 'N/A'}`]);
             
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
    setLogs(prev => [...prev, `💾 Database: Saving ${successfulResults.length} records in background...`]);

    if (onFinish && successfulResults.length > 0) {
      setLogs(prev => [...prev, `🚀 Transitioning to automatic insurance extraction...`]);
      setTimeout(() => {
        onFinish();
      }, 1500);
    }
  };

  const handleDownload = () => {
    if (scrapedData.length === 0) return;
    downloadCSV(scrapedData);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative">
      
      {showUpgradeModal && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 p-8 rounded-2xl max-w-md text-center shadow-2xl animate-in zoom-in duration-200">
              <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-400">
                 <Lock size={32} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Daily Limit Reached</h2>
              <p className="text-slate-400 mb-6">
                You've hit your limit of {user.dailyLimit.toLocaleString()} records. Upgrade your plan to extract unlimited data.
              </p>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setShowUpgradeModal(false)} className="px-4 py-2 text-slate-400 hover:text-white">Close</button>
                <button onClick={onUpgrade} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">View Plans</button>
              </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Live Scraper</h1>
          <p className="text-slate-400">FMCSA Extraction with Safety Data + Async DB Sync</p>
        </div>
        <div className="flex gap-4">
           {scrapedData.length > 0 && (
            <button 
              onClick={handleDownload}
              className="flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-all"
            >
              <Download size={20} />
              Export Batch
            </button>
           )}
          <button
            onClick={toggleRun}
            className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/25 ${
              isRunning 
              ? 'bg-red-500 hover:bg-red-600 text-white' 
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {isRunning ? <><Pause size={20} /> Stop</> : <><Play size={20} /> Start Extraction</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">
          
          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity className="text-indigo-400" /> 
              Search Parameters
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Start MC Number</label>
                <input 
                  type="text" 
                  value={config.startPoint}
                  onChange={(e) => setConfig({...config, startPoint: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. 1580000"
                  disabled={isRunning}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Number of Records</label>
                <input 
                  type="number" 
                  value={config.recordCount}
                  onChange={(e) => setConfig({...config, recordCount: parseInt(e.target.value)})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  disabled={isRunning}
                />
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={config.useMockData}
                    onChange={(e) => setConfig({...config, useMockData: e.target.checked})}
                    className="w-4 h-4"
                    disabled={isRunning}
                  />
                  <span className="text-sm text-slate-300">Use Mock Data (Testing)</span>
                </label>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={config.useProxy}
                    onChange={(e) => setConfig({...config, useProxy: e.target.checked})}
                    className="w-4 h-4"
                    disabled={isRunning}
                  />
                  <span className="text-sm text-slate-300">Use Proxy Network</span>
                </label>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={config.includeCarriers}
                    onChange={(e) => setConfig({...config, includeCarriers: e.target.checked})}
                    className="w-4 h-4"
                    disabled={isRunning}
                  />
                  <span className="text-sm text-slate-300">Include Carriers</span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={config.includeBrokers}
                    onChange={(e) => setConfig({...config, includeBrokers: e.target.checked})}
                    className="w-4 h-4"
                    disabled={isRunning}
                  />
                  <span className="text-sm text-slate-300">Include Brokers</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={config.onlyAuthorized}
                    onChange={(e) => setConfig({...config, onlyAuthorized: e.target.checked})}
                    className="w-4 h-4"
                    disabled={isRunning}
                  />
                  <span className="text-sm text-slate-300">Only Authorized</span>
                </label>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Zap className="text-yellow-400" />
              Performance
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Progress</span>
                <span className="text-white font-bold">{progress}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2">
                <div 
                  className="bg-indigo-500 h-2 rounded-full transition-all"
                  style={{width: `${progress}%`}}
                />
              </div>
              
              <div className="flex justify-between text-sm mt-4">
                <span className="text-slate-400">Records Found</span>
                <span className="text-green-400 font-bold">{scrapedData.length}</span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Saved to DB</span>
                <span className={`font-bold ${isSavingToDb ? 'text-yellow-400' : 'text-blue-400'}`}>
                  {dbSaveCount} {isSavingToDb && '(syncing...)'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col">
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 flex-1 flex flex-col overflow-hidden">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <TerminalIcon className="text-green-400" size={20} />
              Live Log
            </h2>
            
            <div className="flex-1 overflow-y-auto bg-slate-900 rounded-lg p-4 font-mono text-sm space-y-1 mb-4">
              {logs.length === 0 ? (
                <div className="text-slate-500">Logs will appear here...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="text-slate-300 break-words">
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
