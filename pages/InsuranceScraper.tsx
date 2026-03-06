import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Download, Database, SearchIcon, ClipboardList, Loader2, CheckCircle2, Info, AlertCircle, ShieldAlert, Zap } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ 
    total: 0, 
    insFound: 0, 
    insFailed: 0,
    dbSaved: 0
  });
  
  // Manual Lookup State
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[]} | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (autoStart && carriers.length > 0 && !isProcessing && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startEnrichmentProcess();
    }
  }, [autoStart, carriers]);

  const startEnrichmentProcess = async () => {
    if (isProcessing) return;
    if (carriers.length === 0) {
      setLogs(prev => [...prev, "❌ Error: No carriers found. Load carriers first."]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 ENGINE INITIALIZED: Insurance Enrichment Mode`]);
    setLogs(prev => [...prev, `🔍 Targeting: ${carriers.length} USDOT records`]);
    
    const updatedCarriers = [...carriers];
    let dbSaved = 0;
    let insFound = 0;
    let insFailed = 0;

    setLogs(prev => [...prev, `📂 STAGE 1: Insurance Extraction (SearchCarriers API)`]);
    
    for (let i = 0; i < updatedCarriers.length; i++) {
      if (!isRunningRef.current) break;
      const dot = updatedCarriers[i].dotNumber;
      
      setLogs(prev => [...prev, `⏳ [${i+1}/${updatedCarriers.length}] Querying DOT: ${dot}...`]);
      
      try {
        if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error("Invalid DOT");
        const { policies } = await fetchInsuranceData(dot);
        updatedCarriers[i] = { ...updatedCarriers[i], insurancePolicies: policies };
        
        const saveResult = await updateCarrierInsurance(dot, { policies });
        if (saveResult.success) {
          dbSaved++;
        }
        
        if (policies.length > 0) {
          insFound++;
          setLogs(prev => [...prev, `✨ Success: Extracted ${policies.length} filings for ${dot}`]);
        } else {
          setLogs(prev => [...prev, `⚠️ Info: No active insurance found for ${dot}`]);
        }
      } catch (err) {
        insFailed++;
        setLogs(prev => [...prev, `❌ Fail: Insurance timeout for DOT ${dot}`]);
      }

      setProgress(Math.round(((i + 1) / updatedCarriers.length) * 100));
      setStats(prev => ({ ...prev, total: updatedCarriers.length, insFound, insFailed, dbSaved }));
      
      if ((i + 1) % 3 === 0 || (i + 1) === updatedCarriers.length) {
          onUpdateCarriers([...updatedCarriers]);
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `🎉 INSURANCE ENRICHMENT COMPLETE.`]);
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
      console.error("Manual check failed", error);
    } finally {
      setIsManualLoading(false);
    }
  };

  const handleExport = () => {
    const enrichedData = carriers.filter(c => c.insurancePolicies && c.insurancePolicies.length > 0);
    if (enrichedData.length === 0) return;
    
    const headers = ["DOT", "Legal Name", "Insurance Carrier", "Coverage", "Type"];
    const rows = enrichedData.flatMap(c => {
      return (c.insurancePolicies || []).map(p => [
        c.dotNumber,
        `"${c.legalName}"`,
        `"${p.carrier}"`,
        p.coverageAmount,
        p.type
      ]);
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `insurance_data_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative selection:bg-indigo-500/20">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Insurance Intel Center</h1>
          <p className="text-slate-400">Targeted extraction of active insurance filings and policy limits</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
            className={`flex items-center gap-3 px-8 py-3 rounded-2xl font-black transition-all shadow-2xl shadow-indigo-500/20 ${
                isProcessing ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop Scraper</> : <><Zap size={20} /> Run Insurance Scraper</>}
          </button>
          <button 
            disabled={stats.insFound === 0}
            onClick={handleExport}
            className="flex items-center gap-3 px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-2xl font-bold transition-all border border-slate-700"
          >
            <Download size={20} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {isProcessing && (
            <div className="p-4 rounded-2xl border flex items-center gap-3 animate-in slide-in-from-top-4 duration-500 bg-indigo-500/10 border-indigo-500/30 text-indigo-400">
               <Loader2 className="animate-spin" size={20} />
               <span className="text-xs font-black uppercase tracking-widest">Scanning Carrier Policies...</span>
            </div>
          )}

          <div className="bg-slate-850 border border-slate-700/50 p-6 rounded-3xl shadow-xl">
             <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                <SearchIcon size={16} className="text-indigo-400" />
                Quick DOT Lookup
             </h3>
             <form onSubmit={handleManualCheck} className="space-y-4">
                <div className="relative">
                  <input 
                    type="text" 
                    value={manualDot}
                    onChange={(e) => setManualDot(e.target.value)}
                    placeholder="Enter USDOT..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-4 pr-12 py-3 text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-400 hover:text-white">
                    {isManualLoading ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
                  </button>
                </div>
             </form>

             {manualResult && (
               <div className="mt-6 space-y-2">
                    {manualResult.policies.length === 0 ? (
                      <div className="p-4 bg-slate-900/50 rounded-2xl text-[10px] text-slate-500 italic text-center">No filings found.</div>
                    ) : (
                      manualResult.policies.map((p, idx) => (
                        <div key={idx} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                           <div className="flex justify-between items-start mb-1">
                              <span className="text-[9px] font-black text-indigo-400 uppercase">{p.type}</span>
                              <span className="text-sm font-black text-white">{p.coverageAmount}</span>
                           </div>
                           <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{p.carrier}</p>
                        </div>
                      ))
                    )}
               </div>
             )}
          </div>

          <div className="bg-slate-850 border border-slate-700/50 p-6 rounded-3xl shadow-xl">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                <Database size={16} className="text-indigo-400" />
                Live Counters
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">Policies Found</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">DB Sync Status</span>
                <span className="text-2xl font-black text-purple-400">{stats.dbSaved} Updates</span>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                <span>Progress</span>
                <span className="text-white">{progress}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2">
                <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800/50 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex justify-between items-center px-8">
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Insurance Stream</span>
            <div className="text-[10px] text-slate-500 font-mono">ENGINE_INSURANCE_v1.0</div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-xs space-y-2 custom-scrollbar">
            {logs.length === 0 && <span className="text-slate-700 italic block text-center py-20">Awaiting DOT input for insurance extraction...</span>}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 p-2 rounded-lg ${log.includes('❌') ? 'text-red-400' : log.includes('✨') ? 'text-emerald-400' : 'text-slate-400'}`}>
                <span className="opacity-30">[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
                <span>{log}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
