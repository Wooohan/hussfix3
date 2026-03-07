import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Download, Database, SearchIcon, ClipboardList, Loader2, Zap, Hash, ArrowRight } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, getCarriersByMCRange } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, dbSaved: 0 });
  const [mcRange, setMcRange] = useState({ start: '', end: '' });
  
  const isRunningRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`]);
  };

  const processBatch = async (targetList: CarrierData[]) => {
    if (isProcessing || targetList.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: targetList.length, insFound: 0, dbSaved: 0 });
    addLog(`🚀 STARTING BATCH: ${targetList.length} records`);

    const updatedList = [...targetList];

    for (let i = 0; i < targetList.length; i++) {
      if (!isRunningRef.current) break;

      const carrier = targetList[i];
      const dot = carrier.dotNumber;

      try {
        addLog(`⏳ Processing DOT: ${dot}...`);
        
        // 1. Fetch via your Proxy (Fixes "Failed to Fetch")
        const { policies } = await fetchInsuranceData(dot);
        
        // 2. Update Supabase
        const result = await updateCarrierInsurance(dot, { policies });

        if (result.success) {
          updatedList[i] = { ...carrier, insurancePolicies: policies };
          setStats(prev => ({ 
            ...prev, 
            dbSaved: prev.dbSaved + 1,
            insFound: policies.length > 0 ? prev.insFound + 1 : prev.insFound
          }));
          addLog(`✅ Saved ${policies.length} policies for ${dot}`);
        } else {
          addLog(`❌ DB Error for ${dot}: ${result.error?.message}`);
        }
      } catch (err) {
        addLog(`❌ Fatal Error for ${dot}`);
      }

      setProgress(Math.round(((i + 1) / targetList.length) * 100));
      
      // Update the main table UI every 3 items
      if ((i + 1) % 3 === 0 || i === targetList.length - 1) {
        onUpdateCarriers([...updatedList]);
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    addLog(`🎉 BATCH FINISHED.`);
  };

  const handleRangeFetch = async () => {
    addLog(`📡 Searching DB for MC ${mcRange.start} to ${mcRange.end}...`);
    try {
      const results = await getCarriersByMCRange(mcRange.start, mcRange.end);
      if (results.length > 0) {
        addLog(`✨ Found ${results.length} carriers in range.`);
        processBatch(results);
      } else {
        addLog(`⚠️ No carriers found in that range.`);
      }
    } catch (e) {
      addLog(`❌ Range query failed.`);
    }
  };

  return (
    <div className="p-8 h-screen flex flex-col bg-[#0f172a] text-white">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase">Insurance Intelligence</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">FMCSA Proxy Sync Engine</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => isProcessing ? (isRunningRef.current = false) : processBatch(carriers)}
            className={`px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 ${isProcessing ? 'bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {isProcessing ? <><Loader2 className="animate-spin" size={18} /> Stop</> : <><Zap size={18} /> Run Sync</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-4 space-y-6">
          {/* Range Tool */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl">
            <h3 className="text-xs font-black text-indigo-400 uppercase mb-4 flex items-center gap-2">
              <Hash size={14} /> MC Range Scraper
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <input 
                type="text" placeholder="Start" value={mcRange.start}
                onChange={e => setMcRange({...mcRange, start: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <ArrowRight size={16} className="text-slate-600" />
              <input 
                type="text" placeholder="End" value={mcRange.end}
                onChange={e => setMcRange({...mcRange, end: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <button 
              onClick={handleRangeFetch}
              disabled={isProcessing}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold border border-slate-700 transition-all"
            >
              Fetch & Sync Range
            </button>
          </div>

          {/* Stats */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
             <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Policies Found</p>
                  <p className="text-2xl font-black text-indigo-400">{stats.insFound}</p>
                </div>
                <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <p className="text-[10px] text-slate-500 font-bold uppercase">DB Updates</p>
                  <p className="text-2xl font-black text-emerald-400">{stats.dbSaved}</p>
                </div>
             </div>
             <div className="mt-6">
               <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-2">
                 <span>Progress</span>
                 <span>{progress}%</span>
               </div>
               <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                 <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${progress}%` }} />
               </div>
             </div>
          </div>
        </div>

        {/* Logs */}
        <div className="col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="bg-slate-900/50 p-4 border-b border-slate-800 flex justify-between items-center px-6">
            <span className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">
              <ClipboardList size={14} /> System Pipeline
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className={`py-1 ${log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-emerald-400' : 'text-slate-400'}`}>
                {log}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
