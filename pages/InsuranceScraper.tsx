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
  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'stage'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, dbSaved: 0, failed: 0 });

  // Range & Manual State
  const [mcRange, setMcRange] = useState({ start: '', end: '' });
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[]} | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-Start Logic
  useEffect(() => {
    if (autoStart && carriers.length > 0 && !isProcessing && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startEnrichmentProcess(carriers);
    }
  }, [autoStart, carriers]);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' | 'stage' = 'info') => {
    setLogs(prev => [...prev.slice(-100), { msg, type }]);
  };

  /**
   * CORE ENGINE: Processes a list of carriers sequentially.
   * Ensures API fetch and DB save are successful before proceeding.
   */
  const startEnrichmentProcess = async (targetList: CarrierData[]) => {
    if (isProcessing || targetList.length === 0) {
      addLog("❌ No carriers available to process", "error");
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setProgress(0);
    setStats({ total: targetList.length, insFound: 0, dbSaved: 0, failed: 0 });
    
    addLog(`🚀 ENGINE INITIALIZED: Targeting ${targetList.length} records`, 'stage');
    
    const updatedCarriers = [...targetList];
    let localStats = { total: targetList.length, insFound: 0, dbSaved: 0, failed: 0 };

    for (let i = 0; i < targetList.length; i++) {
      if (!isRunningRef.current) {
        addLog("🛑 Sequence interrupted by user.", "error");
        break;
      }

      const carrier = targetList[i];
      const dot = carrier.dotNumber;

      try {
        if (!dot || dot === 'UNKNOWN' || dot === '') throw new Error("Missing USDOT");

        // 1. Fetch from FMCSA/External API
        const { policies } = await fetchInsuranceData(dot);
        
        // 2. Sync to Supabase (Await response to ensure data persistence)
        const syncResponse = await updateCarrierInsurance(dot, { policies });
        
        if (syncResponse.success) {
          localStats.dbSaved++;
          if (policies.length > 0) localStats.insFound++;
          
          updatedCarriers[i] = { ...carrier, insurancePolicies: policies };
          addLog(`✅ [${dot}] Extracted ${policies.length} policies & Synced to DB`, 'success');
        } else {
          throw new Error(syncResponse.error || "DB Sync Failed");
        }

      } catch (err: any) {
        localStats.failed++;
        addLog(`❌ [${dot || 'ERR'}] ${err.message}`, 'error');
      }

      // Update progress and stats UI
      const currentPct = Math.round(((i + 1) / targetList.length) * 100);
      setProgress(currentPct);
      setStats({ ...localStats });

      // Partial parent update every 5 items to keep the UI responsive
      if ((i + 1) % 5 === 0 || i === targetList.length - 1) {
        onUpdateCarriers([...updatedCarriers]);
      }

      // Throttling to prevent Supabase connection exhaustion
      if (i % 15 === 0) await new Promise(res => setTimeout(res, 250));
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    addLog(`🎉 ENRICHMENT COMPLETE: ${localStats.dbSaved} records synced.`, 'stage');
  };

  const handleRangeScrape = async () => {
    if (!mcRange.start || !mcRange.end) return;
    addLog(`📡 Fetching carriers for MC range ${mcRange.start} - ${mcRange.end}...`, 'info');
    
    const rangeData = await getCarriersByMCRange(mcRange.start, mcRange.end);
    if (rangeData.length > 0) {
      startEnrichmentProcess(rangeData);
    } else {
      addLog("⚠️ No records found for the specified MC range.", "error");
    }
  };

  const handleManualCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDot) return;
    setIsManualLoading(true);
    setManualResult(null);
    try {
      const { policies } = await fetchInsuranceData(manualDot);
      setManualResult({ policies });
    } catch (error) {
      addLog(`❌ Manual lookup failed for ${manualDot}`, 'error');
    } finally {
      setIsManualLoading(false);
    }
  };

  const handleExport = () => {
    const enriched = carriers.filter(c => c.insurancePolicies?.length);
    if (enriched.length === 0) return;
    
    const escape = (v: any) => `"${String(v).replace(/"/g, '""')}"`;
    const headers = ["DOT", "Legal Name", "Carrier", "Amount", "Type"];
    const rows = enriched.flatMap(c => 
      (c.insurancePolicies || []).map(p => [
        c.dotNumber, escape(c.legalName), escape(p.carrier), escape(p.coverageAmount), escape(p.type)
      ].join(','))
    );

    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insurance_sync_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-[#0f172a] text-slate-200 overflow-hidden font-sans">
      
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tighter uppercase flex items-center gap-3">
            <ShieldCheck className="text-indigo-500" />
            Insurance Intelligence Center
          </h1>
          <p className="text-slate-500 text-xs font-bold tracking-widest uppercase mt-1">
            Batch FMCSA Enrichment & Supabase Persistence
          </p>
        </div>
        
        <div className="flex gap-3">
          {isProcessing && (
            <button 
              onClick={() => isRunningRef.current = false}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
            >
              <StopCircle size={16} /> STOP
            </button>
          )}
          <button 
            onClick={() => startEnrichmentProcess(carriers)}
            disabled={isProcessing || carriers.length === 0}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            RUN BATCH ({carriers.length})
          </button>
          <button 
            onClick={handleExport}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition-all"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        
        {/* Sidebar */}
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Progress Card */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl shadow-xl">
            <div className="flex justify-between items-end mb-4">
              <span className="text-[10px] font-black text-slate-500 uppercase">Sync Progress</span>
              <span className="text-xl font-black text-indigo-400 font-mono">{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mb-6 overflow-hidden">
               <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Fetched</p>
                <p className="text-lg font-black text-indigo-400">{stats.insFound}</p>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Saved</p>
                <p className="text-lg font-black text-emerald-400">{stats.dbSaved}</p>
              </div>
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Failed</p>
                <p className="text-lg font-black text-red-400">{stats.failed}</p>
              </div>
            </div>
          </div>

          {/* MC Range Targeting */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl shadow-xl">
            <h3 className="text-xs font-black text-indigo-400 uppercase mb-4 flex items-center gap-2">
              <Hash size={14} /> MC Range Targeting
            </h3>
            <div className="flex items-center gap-3 mb-4">
              <input 
                type="text" placeholder="Start MC"
                value={mcRange.start} onChange={e => setMcRange({...mcRange, start: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:border-indigo-500 outline-none"
              />
              <ArrowRight size={16} className="text-slate-600" />
              <input 
                type="text" placeholder="End MC"
                value={mcRange.end} onChange={e => setMcRange({...mcRange, end: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:border-indigo-500 outline-none"
              />
            </div>
            <button 
              onClick={handleRangeScrape}
              disabled={isProcessing || !mcRange.start || !mcRange.end}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all border border-slate-700"
            >
              Fetch & Scrape MC Range
            </button>
          </div>

          {/* Manual Lookup */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl shadow-xl">
            <h3 className="text-xs font-black text-slate-400 uppercase mb-4 flex items-center gap-2">
              <SearchIcon size={14} /> Quick Policy Lookup
            </h3>
            <form onSubmit={handleManualCheck} className="relative">
              <input 
                type="text" placeholder="Enter USDOT#"
                value={manualDot} onChange={e => setManualDot(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-2 text-sm outline-none"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-500 hover:text-white transition-colors">
                {isManualLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              </button>
            </form>
            {manualResult && (
              <div className="mt-4 space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                {manualResult.policies.map((p, i) => (
                  <div key={i} className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[9px] font-black text-indigo-400 uppercase">{p.type}</span>
                      <span className="text-xs font-bold text-white">{p.coverageAmount}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 truncate">{p.carrier}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Log Area */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden relative shadow-2xl">
          <div className="bg-slate-900/40 p-4 border-b border-slate-800 flex justify-between items-center px-6">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} /> Intelligence Pipeline
            </span>
            <div className="flex gap-2">
               <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
               <span className="text-[9px] font-mono text-slate-600 uppercase">Live Stream</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1 custom-scrollbar">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20">
                <Database size={40} className="mb-2" />
                <p className="uppercase tracking-widest text-xs">Waiting for sequence...</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 py-1 px-2 rounded-lg transition-all ${
                log.type === 'error' ? 'text-red-400 bg-red-400/5' : 
                log.type === 'success' ? 'text-emerald-400 bg-emerald-400/5' :
                log.type === 'stage' ? 'text-indigo-300 bg-indigo-500/10 font-bold border-l-2 border-indigo-500' : 
                'text-slate-500'
              }`}>
                <span className="opacity-30 shrink-0">[{new Date().toLocaleTimeString([], {hour12: false})}]</span>
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
