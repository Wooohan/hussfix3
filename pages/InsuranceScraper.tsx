import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Database, SearchIcon, ClipboardList, Loader2, Zap, Hash, ArrowRight, XCircle, CheckCircle2 } from 'lucide-material';
import { CarrierData } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, getCarriersByMCRange } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'error'}[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, dbSaved: 0 });
  const [mcRange, setMcRange] = useState({ start: '', end: '' });
  
  const isRunningRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }]);
  };

  const processBatch = async (targetList: any[]) => {
    if (isProcessing || targetList.length === 0) {
      addLog("⚠️ No carriers to process.", "error");
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: targetList.length, insFound: 0, dbSaved: 0 });
    addLog(`🚀 STARTING SYNC: ${targetList.length} records...`, "info");

    const updatedList = [...targetList];

    for (let i = 0; i < targetList.length; i++) {
      if (!isRunningRef.current) {
        addLog("🛑 Process stopped by user.", "error");
        break;
      }

      const carrier = targetList[i];
      const dot = carrier.dotNumber;

      if (!dot) {
        addLog(`⏩ Skipping MC ${carrier.mcNumber}: No DOT found.`, "error");
        continue;
      }

      try {
        addLog(`⏳ Fetching Insurance for DOT: ${dot}...`);
        
        // 1. Fetch from FMCSA via your Proxy logic
        const { policies } = await fetchInsuranceData(dot);
        
        // 2. Update Supabase TEXT column
        const result = await updateCarrierInsurance(dot, { policies });

        if (result.success) {
          updatedList[i] = { ...carrier, insurancePolicies: policies };
          setStats(prev => ({ 
            ...prev, 
            dbSaved: prev.dbSaved + 1,
            insFound: policies.length > 0 ? prev.insFound + 1 : prev.insFound
          }));
          addLog(`✅ Saved ${policies.length} policies for DOT ${dot}`, "success");
        } else {
          addLog(`❌ DB Error for ${dot}: ${result.error}`, "error");
        }
      } catch (err: any) {
        addLog(`❌ Proxy/Network Error for ${dot}: ${err.message}`, "error");
      }

      setProgress(Math.round(((i + 1) / targetList.length) * 100));
      
      // Real-time UI Update (Every 2 records)
      if ((i + 1) % 2 === 0 || i === targetList.length - 1) {
        onUpdateCarriers([...updatedList]);
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    addLog(`🎉 BATCH COMPLETE. Total Processed: ${targetList.length}`, "success");
  };

  const handleRangeFetch = async () => {
    if (!mcRange.start || !mcRange.end) {
      addLog("⚠️ Please enter both Start and End MC numbers.", "error");
      return;
    }
    
    addLog(`📡 Searching Database for MC ${mcRange.start} to ${mcRange.end}...`, "info");
    const results = await getCarriersByMCRange(mcRange.start, mcRange.end);
    
    if (results.length > 0) {
      addLog(`✨ Found ${results.length} carriers in database. Starting Sync...`, "success");
      processBatch(results);
    } else {
      addLog(`⚠️ No records found in that MC range.`, "error");
    }
  };

  return (
    <div className="p-6 h-full flex flex-col bg-slate-950 text-slate-200 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" /> Insurance Sync Engine
          </h2>
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Database Enrichment Pipeline</p>
        </div>
        
        <button 
          onClick={() => isProcessing ? (isRunningRef.current = false) : processBatch(carriers)}
          disabled={carriers.length === 0 && !isProcessing}
          className={`px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all ${
            isProcessing 
            ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white' 
            : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
          }`}
        >
          {isProcessing ? <><XCircle size={18} /> Stop Sync</> : <><Play size={18} /> Sync Current Table</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Controls & Stats */}
        <div className="col-span-4 space-y-4">
          
          {/* MC Range Tool */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-xl">
            <h3 className="text-xs font-black text-indigo-400 uppercase mb-4 flex items-center gap-2">
              <Hash size={14} /> MC Range Scraper
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <input 
                type="text" placeholder="MC Start" value={mcRange.start}
                onChange={e => setMcRange({...mcRange, start: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
              />
              <ArrowRight size={16} className="text-slate-600" />
              <input 
                type="text" placeholder="MC End" value={mcRange.end}
                onChange={e => setMcRange({...mcRange, end: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <button 
              onClick={handleRangeFetch}
              disabled={isProcessing}
              className="w-full py-2.5 bg-slate-800 hover:bg-indigo-600 rounded-lg text-xs font-bold border border-slate-700 hover:border-indigo-400 transition-all uppercase tracking-wider flex items-center justify-center gap-2"
            >
              <Database size={14} /> Pull & Sync From DB
            </button>
          </div>

          {/* Stats Display */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
             <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Policies Found</p>
                  <p className="text-xl font-black text-indigo-400">{stats.insFound}</p>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">DB Updates</p>
                  <p className="text-xl font-black text-emerald-400">{stats.dbSaved}</p>
                </div>
             </div>
             
             <div className="space-y-2">
               <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                 <span>Sync Progress</span>
                 <span>{progress}%</span>
               </div>
               <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                 <div 
                   className="bg-indigo-500 h-full transition-all duration-500" 
                   style={{ width: `${progress}%` }} 
                 />
               </div>
             </div>
          </div>
        </div>

        {/* Console Logs */}
        <div className="col-span-8 flex flex-col bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-3 border-b border-slate-800 flex justify-between items-center px-5">
            <span className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2">
              <ClipboardList size={14} className="text-indigo-500" /> Live System Logs
            </span>
            <button onClick={() => setLogs([])} className="text-[9px] text-slate-500 hover:text-white uppercase font-bold">Clear</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 font-mono text-[11px] leading-relaxed space-y-1">
            {logs.length === 0 && <div className="text-slate-700 italic">Waiting for process start...</div>}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-2 ${
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'success' ? 'text-emerald-400' : 
                'text-slate-400'
              }`}>
                <span className="opacity-30 shrink-0 select-none">[{i+1}]</span>
                <span>{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
