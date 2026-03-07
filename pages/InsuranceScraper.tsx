import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, Loader2, Zap, Hash, ArrowRight, StopCircle, ClipboardList 
} from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService'; // Your real logic lives here
import { updateCarrierInsurance, getCarriersByMCRange } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'stage'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });
  const [mcRange, setMcRange] = useState({ start: '', end: '' });

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
    
    addLog(`🚀 STARTING BATCH: ${targetCarriers.length} Carriers`, 'stage');

    for (let i = 0; i < targetCarriers.length; i++) {
      if (!isRunningRef.current) {
        addLog("🛑 PROCESS HALTED BY USER", "error");
        break;
      }

      const carrier = targetCarriers[i];
      // Use snake_case dot_number if available, otherwise camelCase
      const dot = carrier.dot_number || carrier.dotNumber;

      try {
        if (!dot || dot === 'UNKNOWN') throw new Error("Invalid DOT Number");

        // 1. Fetch from your Service (searchcarriers.com)
        addLog(`📡 [${dot}] Fetching filings...`, 'info');
        const { policies } = await fetchInsuranceData(String(dot));
        
        // 2. Sync to Supabase - PASSING policies directly as an array
        addLog(`💾 [${dot}] Updating Supabase...`, 'info');
        const saveResult = await updateCarrierInsurance(String(dot), policies);
        
        if (saveResult.success) {
          if (saveResult.data && saveResult.data.length > 0) {
            localStats.dbSaved++;
            localStats.insFound += policies.length > 0 ? 1 : 0;
            addLog(`✅ [${dot}] Success: ${policies.length} policies saved.`, 'success');
          } else {
            addLog(`⚠️ [${dot}] Warning: DOT not found in your 'carriers' table.`, 'error');
          }
        } else {
          // VERBOSE ERROR LOGGING (Like the Python Console)
          const err = saveResult.error;
          const errorMsg = `❌ [${dot}] DB ERROR: ${err.message} (Code: ${err.code})`;
          addLog(errorMsg, 'error');
          console.error("Detailed DB Failure:", err);
        }

      } catch (err: any) {
        localStats.insFailed++;
        addLog(`🚨 [${dot || 'ERR'}] System Error: ${err.message}`, 'error');
      }

      setProgress(Math.round(((i + 1) / targetCarriers.length) * 100));
      setStats({...localStats});

      // Avoid rate limits
      await new Promise(r => setTimeout(r, 250));
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    addLog(`🎉 BATCH FINISHED: ${localStats.dbSaved} synced successfully.`, 'stage');
  };

  const handleRangeScrape = async () => {
    if (!mcRange.start || !mcRange.end) {
      addLog("⚠️ Missing MC Start/End range.", "error");
      return;
    }
    addLog(`🔍 Querying DB for MC Range: ${mcRange.start} - ${mcRange.end}`, 'info');
    try {
      const carriersFromDb = await getCarriersByMCRange(mcRange.start, mcRange.end);
      if (carriersFromDb && carriersFromDb.length > 0) {
        processEnrichment(carriersFromDb);
      } else {
        addLog("❓ No carriers found in database for that range.", "error");
      }
    } catch (e: any) {
      addLog(`❌ Fetch Error: ${e.message}`, "error");
    }
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-[#0f172a] text-slate-200 font-sans">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tighter">Insurance Sync v2.1</h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">PostgreSQL / JSONB Pipeline</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => isRunningRef.current = false}
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl border border-red-500/30 font-bold text-xs uppercase"
          >
            Stop Engine
          </button>
          <button 
            onClick={() => processEnrichment(carriers)}
            disabled={isProcessing}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold uppercase text-xs shadow-lg disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="animate-spin inline mr-2" size={14} /> : <Zap className="inline mr-2" size={14} />}
            Sync Visible View
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Controls Column */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between items-end mb-4">
              <span className="text-[10px] font-black text-slate-500 uppercase">Progress Tracker</span>
              <span className="text-xl font-black text-indigo-400">{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mb-6">
              <div className="bg-indigo-500 h-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-black/40 p-3 rounded-xl border border-slate-800 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Synced</p>
                <p className="text-lg font-black text-emerald-400">{stats.dbSaved}</p>
              </div>
              <div className="bg-black/40 p-3 rounded-xl border border-slate-800 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Errors</p>
                <p className="text-lg font-black text-red-400">{stats.insFailed}</p>
              </div>
              <div className="bg-black/40 p-3 rounded-xl border border-slate-800 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Batch</p>
                <p className="text-lg font-black text-indigo-400">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <h3 className="text-xs font-black text-indigo-400 uppercase mb-4 flex items-center gap-2">
              <Hash size={14} /> MC Sync Range
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <input 
                type="text" placeholder="Start MC"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm outline-none"
                value={mcRange.start} onChange={e => setMcRange({...mcRange, start: e.target.value})}
              />
              <ArrowRight size={16} className="text-slate-600" />
              <input 
                type="text" placeholder="End MC"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm outline-none"
                value={mcRange.end} onChange={e => setMcRange({...mcRange, end: e.target.value})}
              />
            </div>
            <button 
              onClick={handleRangeScrape}
              className="w-full py-3 bg-slate-800 hover:bg-indigo-600 text-white rounded-xl text-xs font-black uppercase transition-all"
            >
              Run Range Enrichment
            </button>
          </div>
        </div>

        {/* Console Column */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">
              <ClipboardList size={14} className="text-indigo-500" /> Real-Time Sync Console
            </span>
            <button onClick={() => setLogs([])} className="text-[9px] font-bold text-slate-600 hover:text-white">CLEAR</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 py-1 px-2 rounded ${
                log.type === 'error' ? 'text-red-400 bg-red-400/5' : 
                log.type === 'success' ? 'text-emerald-400 bg-emerald-400/5' :
                log.type === 'stage' ? 'text-indigo-300 bg-indigo-500/10 font-bold border-l-2 border-indigo-500' : 'text-slate-400'
              }`}>
                <span className="opacity-30 shrink-0">[{i+1}]</span>
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
