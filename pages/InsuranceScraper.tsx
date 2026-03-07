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

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' | 'stage' = 'info') => {
    setLogs(prev => [...prev.slice(-100), { msg, type }]); 
  };

  const processEnrichment = async (targetCarriers: CarrierData[]) => {
    if (isProcessing || targetCarriers.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;
    let localStats = { total: targetCarriers.length, insFound: 0, insFailed: 0, dbSaved: 0 };
    
    addLog(`🚀 DEBUG START: Processing ${targetCarriers.length} records`, 'stage');

    for (let i = 0; i < targetCarriers.length; i++) {
      if (!isRunningRef.current) {
        addLog("🛑 Process halted by user.", "error");
        break;
      }

      const carrier = targetCarriers[i];
      const dot = carrier.dotNumber ? String(carrier.dotNumber) : null;

      try {
        if (!dot || dot === 'UNKNOWN' || dot === 'undefined') {
          throw new Error("Missing/Invalid DOT Number");
        }

        // 1. API Fetch
        addLog(`📡 [${dot}] Fetching insurance from FMCSA...`, 'info');
        const { policies } = await fetchInsuranceData(dot);
        
        // 2. Database Sync with Verbose Debugging
        addLog(`💾 [${dot}] Attempting DB Update...`, 'info');
        const saveResult = await updateCarrierInsurance(dot, { policies });
        
        if (saveResult.success) {
          localStats.dbSaved++;
          if (policies.length > 0) {
            localStats.insFound++;
            addLog(`✨ [${dot}] Found ${policies.length} policies & Synced.`, 'success');
          } else {
            addLog(`ℹ️ [${dot}] No filings found. DB timestamp updated.`, 'info');
          }
        } else {
          // Log exact error to browser console for deep inspection
          console.error("Supabase Error Context:", { dot, saveResult });
          
          // Identify if it's an RLS issue or a "Not Found" issue
          const dbError = saveResult.error?.message || saveResult.error || "Unknown DB Error";
          throw new Error(`DB Write Failed: ${dbError}`);
        }

        // 3. UI Update
        if ((i + 1) % 5 === 0 || (i + 1) === targetCarriers.length) {
          onUpdateCarriers([...targetCarriers]);
        }

      } catch (err: any) {
        localStats.insFailed++;
        addLog(`❌ [${dot || 'ERR'}] ${err.message}`, 'error');
      }

      setProgress(Math.round(((i + 1) / targetCarriers.length) * 100));
      setStats({...localStats});

      // Avoid hitting potential rate limits
      await new Promise(r => setTimeout(r, 150));
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    addLog(`🎉 BATCH COMPLETE: ${localStats.dbSaved} synced.`, 'stage');
  };

  const handleRangeScrape = async () => {
    if (!mcRange.start || !mcRange.end) {
      addLog("⚠️ Enter MC Start and End numbers.", "error");
      return;
    }
    addLog(`🔍 Searching DB for range: ${mcRange.start} - ${mcRange.end}`, 'info');
    try {
      const carriersFromDb = await getCarriersByMCRange(mcRange.start, mcRange.end);
      if (carriersFromDb && carriersFromDb.length > 0) {
        processEnrichment(carriersFromDb);
      } else {
        addLog("⚠️ No matching MCs found in Supabase.", "error");
      }
    } catch (e: any) {
      addLog(`❌ DB Range Fetch Error: ${e.message}`, "error");
    }
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-[#0f172a] text-slate-200 overflow-hidden font-sans">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className={`h-3 w-3 rounded-full ${isProcessing ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
            <h1 className="text-2xl font-black tracking-tighter uppercase italic">Insurance Sync v2</h1>
          </div>
          <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">Supabase Enrichment Pipeline</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => isRunningRef.current = false}
            disabled={!isProcessing}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl border border-red-500/30 transition-all disabled:opacity-30"
          >
            <StopCircle size={18} /> <span className="text-xs font-bold uppercase">Stop</span>
          </button>
          <button 
            onClick={() => processEnrichment(carriers)}
            disabled={isProcessing || carriers.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
            <span className="text-xs uppercase">Sync Active View ({carriers.length})</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Progress Monitor */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl shadow-inner">
            <div className="flex justify-between items-end mb-4">
              <span className="text-[10px] font-black text-slate-500 uppercase">Engine Progress</span>
              <span className="text-xl font-black text-indigo-400 font-mono">{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mb-6 overflow-hidden">
               <div 
                 className="bg-indigo-500 h-full transition-all duration-500 ease-out" 
                 style={{ width: `${progress}%` }} 
               />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Policies</p>
                <p className="text-lg font-black text-emerald-400">{stats.insFound}</p>
              </div>
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Writes</p>
                <p className="text-lg font-black text-blue-400">{stats.dbSaved}</p>
              </div>
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Fails</p>
                <p className="text-lg font-black text-red-400">{stats.insFailed}</p>
              </div>
            </div>
          </div>

          {/* Range Scraper Tool */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <h3 className="text-xs font-black text-indigo-400 uppercase mb-4 flex items-center gap-2">
              <Hash size={14} /> MC Range Scraper
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <input 
                type="text" placeholder="1580000"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:border-indigo-500 outline-none transition-colors"
                value={mcRange.start} onChange={e => setMcRange({...mcRange, start: e.target.value})}
              />
              <ArrowRight size={16} className="text-slate-600" />
              <input 
                type="text" placeholder="1580050"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:border-indigo-500 outline-none transition-colors"
                value={mcRange.end} onChange={e => setMcRange({...mcRange, end: e.target.value})}
              />
            </div>
            <button 
              onClick={handleRangeScrape}
              disabled={isProcessing}
              className="w-full py-2.5 bg-slate-800 hover:bg-indigo-600 text-white rounded-xl text-xs font-black transition-all border border-slate-700 uppercase"
            >
              Fetch DB & Enrich
            </button>
          </div>
        </div>

        {/* Live Debug Logs */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden relative shadow-2xl">
          <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} className="text-indigo-500" /> Debug Stream
            </span>
            <button onClick={() => setLogs([])} className="text-[9px] font-bold text-slate-600 hover:text-slate-300">CLEAR LOGS</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-10">
                <Database size={60} />
                <p className="mt-2 uppercase font-black">Waiting for signal...</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 py-1 px-2 rounded ${
                log.type === 'error' ? 'text-red-400 bg-red-400/5' : 
                log.type === 'success' ? 'text-emerald-400 bg-emerald-400/5' :
                log.type === 'stage' ? 'text-indigo-300 bg-indigo-500/10 font-bold border-l-2 border-indigo-500' : 
                'text-slate-400'
              }`}>
                <span className="opacity-30 shrink-0 select-none">[{i+1}]</span>
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
