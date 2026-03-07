import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, Play, Download, Database, SearchIcon, 
  ClipboardList, Loader2, CheckCircle2, Info, AlertCircle, 
  ShieldAlert, Zap, Hash, ArrowRight, StopCircle 
} from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, getCarriersByMCRange } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  // Logic State
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'stage'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });

  // Range State
  const [mcRange, setMcRange] = useState({ start: '', end: '' });
  
  // Manual Lookup State
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[]} | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' | 'stage' = 'info') => {
    setLogs(prev => [...prev.slice(-100), { msg, type }]); // Keep last 100 logs for performance
  };

  const processEnrichment = async (targetCarriers: CarrierData[]) => {
    if (isProcessing || targetCarriers.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;
    let localStats = { total: targetCarriers.length, insFound: 0, insFailed: 0, dbSaved: 0 };
    
    addLog(`🚀 INITIALIZING: Processing ${targetCarriers.length} records`, 'stage');

    for (let i = 0; i < targetCarriers.length; i++) {
      if (!isRunningRef.current) {
        addLog("🛑 Process halted by user.", "error");
        break;
      }

      const carrier = targetCarriers[i];
      const dot = carrier.dotNumber;

      try {
        if (!dot || dot === 'UNKNOWN') throw new Error("Invalid DOT");

        // 1. API Fetch
        const { policies } = await fetchInsuranceData(dot);
        
        // 2. Database Sync (The Fix: Await and Verify)
        const saveResult = await updateCarrierInsurance(dot, { policies });
        
        if (saveResult.success) {
          localStats.dbSaved++;
          if (policies.length > 0) {
            localStats.insFound++;
            addLog(`✨ [${dot}] Found ${policies.length} policies & Synced to DB`, 'success');
          } else {
            addLog(`ℹ️ [${dot}] No active filings found. DB updated.`, 'info');
          }
        } else {
          throw new Error(saveResult.error?.message || "DB Write Failed");
        }

        // 3. Update parent state in batches of 5 to prevent UI lag
        if ((i + 1) % 5 === 0 || (i + 1) === targetCarriers.length) {
          onUpdateCarriers([...targetCarriers]);
        }

      } catch (err: any) {
        localStats.insFailed++;
        addLog(`❌ [${dot || 'ERR'}] ${err.message}`, 'error');
      }

      // Update progress and stats
      const currentProgress = Math.round(((i + 1) / targetCarriers.length) * 100);
      setProgress(currentProgress);
      setStats({...localStats});

      // Throttling: prevent rate limits on large batches (120+)
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 100));
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    addLog(`🎉 BATCH COMPLETE: ${localStats.dbSaved} records synced.`, 'stage');
  };

  const handleRangeScrape = async () => {
    addLog(`🔍 Fetching carriers in MC range: ${mcRange.start} - ${mcRange.end}`, 'info');
    try {
      const carriersFromDb = await getCarriersByMCRange(mcRange.start, mcRange.end);
      if (carriersFromDb && carriersFromDb.length > 0) {
        processEnrichment(carriersFromDb);
      } else {
        addLog("⚠️ No carriers found in that MC range.", "error");
      }
    } catch (e) {
      addLog("❌ Failed to query database range.", "error");
    }
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-[#0f172a] text-slate-200 overflow-hidden font-sans">
      {/* Header Section */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
            <h1 className="text-2xl font-black tracking-tighter uppercase">Insurance Intel Engine</h1>
          </div>
          <p className="text-slate-500 text-xs font-medium">Automated FMCSA Filing Extraction & Supabase Synchronization</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => isRunningRef.current = false}
            disabled={!isProcessing}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl border border-red-500/30 transition-all disabled:opacity-30"
          >
            <StopCircle size={18} /> <span className="text-xs font-bold">STOP</span>
          </button>
          <button 
            onClick={() => processEnrichment(carriers)}
            disabled={isProcessing || carriers.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
            <span className="text-xs uppercase">Run Active Batch ({carriers.length})</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        
        {/* Left Control Panel */}
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Progress Card */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between items-end mb-4">
              <span className="text-[10px] font-black text-slate-500 uppercase">Mission Progress</span>
              <span className="text-xl font-black text-indigo-400 font-mono">{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mb-6 overflow-hidden">
               <div 
                 className="bg-indigo-500 h-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]" 
                 style={{ width: `${progress}%` }} 
               />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Found</p>
                <p className="text-lg font-black text-emerald-400">{stats.insFound}</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Synced</p>
                <p className="text-lg font-black text-blue-400">{stats.dbSaved}</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Errors</p>
                <p className="text-lg font-black text-red-400">{stats.insFailed}</p>
              </div>
            </div>
          </div>

          {/* Range Scraper Tool */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <h3 className="text-xs font-black text-indigo-400 uppercase mb-4 flex items-center gap-2">
              <Hash size={14} /> MC Range Targeter
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <input 
                type="text" placeholder="1580000"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:border-indigo-500 outline-none"
                value={mcRange.start} onChange={e => setMcRange({...mcRange, start: e.target.value})}
              />
              <ArrowRight size={16} className="text-slate-600" />
              <input 
                type="text" placeholder="1580050"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:border-indigo-500 outline-none"
                value={mcRange.end} onChange={e => setMcRange({...mcRange, end: e.target.value})}
              />
            </div>
            <button 
              onClick={handleRangeScrape}
              disabled={isProcessing || !mcRange.start || !mcRange.end}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-700"
            >
              Fetch & Scrape Range
            </button>
          </div>

          {/* Quick Lookup */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <h3 className="text-xs font-black text-slate-400 uppercase mb-4 flex items-center gap-2">
              <SearchIcon size={14} /> Single DOT Lookup
            </h3>
            <div className="relative">
              <input 
                type="text" placeholder="USDOT #"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-2 text-sm outline-none"
                value={manualDot} onChange={e => setManualDot(e.target.value)}
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-500 hover:text-white transition-colors">
                <Play size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Right Log Stream */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
          
          <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} /> Live System Logs
            </span>
            <div className="flex gap-2">
               <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
               <span className="text-[9px] font-mono text-slate-500 uppercase">Stream Active</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20">
                <Database size={40} className="mb-2" />
                <p>Waiting for process start...</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 py-1 px-2 rounded ${
                log.type === 'error' ? 'text-red-400 bg-red-400/5' : 
                log.type === 'success' ? 'text-emerald-400 bg-emerald-400/5' :
                log.type === 'stage' ? 'text-indigo-300 bg-indigo-500/10 font-bold border-l-2 border-indigo-500' : 
                'text-slate-400'
              }`}>
                <span className="opacity-30 shrink-0 select-none">[{new Date().toLocaleTimeString([], {hour12: false})}]</span>
                <span className="break-all">{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
