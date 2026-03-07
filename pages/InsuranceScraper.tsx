import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Download, Database, SearchIcon, ClipboardList, Loader2, CheckCircle2, Info, AlertCircle, ShieldAlert, Zap, Hash } from 'lucide-react';
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
  const [currentStage, setCurrentStage] = useState<'IDLE' | 'RANGE' | 'INSURANCE' | 'SYNC'>('IDLE');
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });
  
  // Range State
  const [rangeStart, setRangeStart] = useState('1580000');
  const [rangeEnd, setRangeEnd] = useState('1580010');
  
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[]} | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const startEnrichmentProcess = async (mode: 'LIST' | 'RANGE') => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ total: 0, insFound: 0, insFailed: 0, dbSaved: 0 });
    setLogs(prev => [...prev, `🚀 ENGINE START: ${mode} MODE`]);

    let targetCarriers: Partial<CarrierData>[] = [];

    // --- STAGE 0: RANGE RESOLVER (New) ---
    if (mode === 'RANGE') {
      setCurrentStage('RANGE');
      const start = parseInt(rangeStart);
      const end = parseInt(rangeEnd);
      setLogs(prev => [...prev, `🔢 Resolving MC Range: ${start} to ${end}...`]);
      
      for (let mc = start; mc <= end; mc++) {
        // Logic: Add MC to list (In a real app, you'd fetch the DOT for this MC here)
        targetCarriers.push({ dotNumber: `MC${mc}`, legalName: `Carrier MC${mc}` });
      }
    } else {
      targetCarriers = [...carriers];
    }

    if (targetCarriers.length === 0) {
      setLogs(prev => [...prev, "❌ Error: No targets identified."]);
      setIsProcessing(false);
      return;
    }

    const syncPayload: { dot: string; policies: InsurancePolicy[] }[] = [];
    const updatedResults = [...carriers]; 

    // --- STAGE 1: EXTRACTION ---
    setCurrentStage('INSURANCE');
    for (let i = 0; i < targetCarriers.length; i++) {
      if (!isRunningRef.current) break;
      const dot = targetCarriers[i].dotNumber!;
      
      setLogs(prev => [...prev, `⏳ [${i+1}/${targetCarriers.length}] Extracting: ${dot}...`]);
      try {
        const { policies } = await fetchInsuranceData(dot);
        syncPayload.push({ dot, policies });
        
        if (policies.length > 0) {
          setStats(prev => ({ ...prev, insFound: prev.insFound + 1 }));
          setLogs(prev => [...prev, `✨ Data found for ${dot}`]);
        }
      } catch (err) {
        setStats(prev => ({ ...prev, insFailed: prev.insFailed + 1 }));
      }
      setProgress(Math.round(((i + 1) / targetCarriers.length) * 100));
      await new Promise(r => setTimeout(r, 800));
    }

    // --- STAGE 2: FINAL SYNC (Fixes Counter) ---
    if (syncPayload.length > 0) {
      setCurrentStage('SYNC');
      setLogs(prev => [...prev, `📂 STAGE: FINAL SYNC (${syncPayload.length} records)`]);
      
      let successfulSaves = 0;
      for (const item of syncPayload) {
        try {
          const res = await updateCarrierInsurance(item.dot, { policies: item.policies });
          // Fixed Counter logic: checks for truthy response and absence of error
          if (res && (res.success || !res.error)) {
            successfulSaves++;
            setStats(prev => ({ ...prev, dbSaved: successfulSaves }));
          }
        } catch (e) {
          setLogs(prev => [...prev, `⚠️ Failed to sync DOT: ${item.dot}`]);
        }
      }
      setLogs(prev => [...prev, `💾 Total Supabase updates: ${successfulSaves}`]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    setCurrentStage('IDLE');
    setLogs(prev => [...prev, `🎉 PROCESS COMPLETE.`]);
  };

  // ... (Keep handleManualCheck and handleExport exactly as they were)
  const handleManualCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDot) return;
    setIsManualLoading(true);
    try {
      const { policies } = await fetchInsuranceData(manualDot);
      setManualResult({ policies });
    } catch (error) { console.error(error); } 
    finally { setIsManualLoading(false); }
  };

  const handleExport = () => {
    const enrichedData = carriers.filter(c => (c.insurancePolicies && c.insurancePolicies.length > 0));
    if (enrichedData.length === 0) return;
    const headers = ["DOT", "Legal Name", "Insurance Carrier", "Coverage", "Type"];
    const rows = enrichedData.flatMap(c => (c.insurancePolicies || []).map(p => [c.dotNumber, `"${c.legalName}"`, `"${p.carrier}"`, p.coverageAmount, p.type]));
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `insurance_export.csv`;
    link.click();
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Insurance Intel Engine</h1>
          <p className="text-slate-400">Range Scraper & Bulk Supabase Sync</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess('LIST')}
            className={`px-6 py-3 rounded-2xl font-black transition-all ${isProcessing ? 'bg-red-500 text-white' : 'bg-slate-800 text-white border border-slate-700'}`}
          >
            {isProcessing ? 'Stop' : 'Run Loaded List'}
          </button>
          <button 
            onClick={() => startEnrichmentProcess('RANGE')}
            disabled={isProcessing}
            className="flex items-center gap-3 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black transition-all shadow-xl shadow-indigo-500/20"
          >
            <Zap size={20} /> Start Range Scraper
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">
          
          {/* RANGE SCRAPER UI */}
          <div className="bg-slate-850 border border-slate-700/50 p-6 rounded-3xl shadow-xl">
             <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                <Hash size={16} className="text-indigo-400" /> MC Range Config
             </h3>
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase">MC Start</label>
                  <input type="text" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase">MC End</label>
                  <input type="text" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm" />
                </div>
             </div>
          </div>

          <div className="bg-slate-850 border border-slate-700/50 p-6 rounded-3xl shadow-xl">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                <Database size={16} className="text-indigo-400" /> Engine Stats
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">Found</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">DB Saved</span>
                <span className="text-2xl font-black text-purple-400">{stats.dbSaved}</span>
              </div>
            </div>
            <div className="mt-6 w-full bg-slate-900 rounded-full h-2">
              <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800/50 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex justify-between items-center px-8">
             <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Active Pipeline Stream</span>
             <div className="text-[10px] text-slate-500 font-mono italic">{currentStage}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-xs space-y-2 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 p-2 rounded-lg transition-colors ${log.includes('✅') || log.includes('✨') ? 'bg-emerald-500/5 text-emerald-400' : 'text-slate-400'}`}>
                <span className="opacity-30 shrink-0 font-bold">[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
                <span className="leading-relaxed">{log}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
