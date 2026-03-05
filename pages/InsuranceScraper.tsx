import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, ClipboardList, Loader2, Zap, CheckCircle2, RotateCcw, ShieldCheck, Activity } from 'lucide-react';
import { CarrierData } from '../types';
import { fetchInsuranceData, fetchSafetyData } from '../services/mockService';
import { updateCarrierInsurance, updateCarrierSafety, supabase } from '../services/supabaseClient';

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
    safetyFound: 0,
    dbSaved: 0,
    retries: 0
  });
  
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Specialized Retry Logic for Safety N/A
  const fetchSafetyWithRetry = async (dot: string, maxRetries = 2): Promise<any> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const data = await fetchSafetyData(dot);
        if (data && data.rating !== 'N/A') return data;
        if (attempt < maxRetries) {
          setStats(s => ({ ...s, retries: s.retries + 1 }));
          await sleep(1500 * (attempt + 1)); // Exponential backoff
          continue;
        }
        return data;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await sleep(1000);
      }
    }
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    setLogs(prev => [...prev, `🔍 Searching Database for MC ${mcRangeStart} - ${mcRangeEnd}...`]);
    try {
      const { data, error } = await supabase.from('carriers').select('*').gte('mc_number', mcRangeStart).lte('mc_number', mcRangeEnd);
      if (error) throw error;
      setMcRangeCarriers(data || []);
      setLogs(prev => [...prev, `✅ Loaded ${data?.length || 0} carriers from range.`]);
    } catch (err: any) {
      setLogs(prev => [...prev, `❌ DB Error: ${err.message}`]);
    }
  };

  const startPairedEnrichment = async () => {
    if (isProcessing) return;
    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 STARTING PAIRED STREAM: Processing ${targetCarriers.length} records...`]);
    
    const updated = [...targetCarriers];

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;
      
      const carrier = updated[i];
      setLogs(prev => [...prev, `📡 [${i + 1}/${updated.length}] Querying DOT: ${carrier.dotNumber}...`]);

      try {
        // STEP 1: Execute both requests at the same time
        const [insResult, safeResult] = await Promise.all([
          fetchInsuranceData(carrier.dotNumber),
          fetchSafetyWithRetry(carrier.dotNumber)
        ]);

        // STEP 2: Update Data Object
        updated[i] = { 
          ...updated[i], 
          insurancePolicies: insResult.policies,
          safetyRating: safeResult.rating,
          basicScores: safeResult.basicScores
        };

        // STEP 3: Sync to Supabase
        const [insSave, safeSave] = await Promise.all([
          updateCarrierInsurance(carrier.dotNumber, { policies: insResult.policies }),
          updateCarrierSafety(carrier.dotNumber, safeResult)
        ]);

        // STEP 4: Update Stats & UI
        setStats(s => ({ 
          ...s, 
          insFound: s.insFound + (insResult.policies.length > 0 ? 1 : 0),
          safetyFound: s.safetyFound + (safeResult.rating !== 'N/A' ? 1 : 0),
          dbSaved: s.dbSaved + (insSave.success ? 1 : 0) + (safeSave.success ? 1 : 0)
        }));

        setLogs(prev => [...prev, `✨ INS: ${insResult.policies.length} | 🛡️ SAFE: ${safeResult.rating} (${safeResult.basicScores?.vehicleMaint || 0}%)`]);
        
        // Push update to the main list
        onUpdateCarriers([...updated]);

      } catch (err) {
        setLogs(prev => [...prev, `❌ Error processing DOT ${carrier.dotNumber}`]);
      }

      // STEP 5: THE 1-SECOND DELAY (Ensures we don't get blocked)
      setProgress(Math.round(((i + 1) / updated.length) * 100));
      if (i < updated.length - 1) {
        await sleep(1000); 
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    setLogs(prev => [...prev, `🎉 PAIRED STREAM COMPLETE.`]);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <div className="flex justify-between items-center mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="text-indigo-500 animate-pulse" size={24} />
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Paired Enrichment Engine</h1>
          </div>
          <p className="text-slate-500 font-medium ml-8">Concurrent Insurance & Safety Scrapes with 1s Staggered Delay</p>
        </div>
        <button 
          onClick={() => isProcessing ? (isRunningRef.current = false) : startPairedEnrichment()} 
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all transform active:scale-95 ${
            isProcessing ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Terminate</> : <><Zap size={20} /> Start Paired Stream</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Range Controls */}
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-[2rem] backdrop-blur-sm">
             <div className="flex items-center justify-between mb-6">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Database size={14} className="text-indigo-400" /> Database Range
                </span>
                <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-colors ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                  {mcRangeMode ? 'ACTIVE' : 'OFF'}
                </button>
             </div>
             {mcRangeMode && (
               <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                  <div className="flex gap-2">
                    <input type="text" value={mcRangeStart} onChange={(e) => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500" />
                    <input type="text" value={mcRangeEnd} onChange={(e) => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500" />
                  </div>
                  <button onClick={handleMcRangeSearch} className="w-full bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-xs font-black uppercase tracking-tighter transition-all">Load Carriers</button>
               </div>
             )}
          </div>

          {/* Live Monitor */}
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-[2rem] space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-2">Insurance</span>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-indigo-400" size={16} />
                  <span className="text-2xl font-black text-white">{stats.insFound}</span>
                </div>
              </div>
              <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-2">Retries</span>
                <div className="flex items-center gap-2">
                  <RotateCcw className="text-amber-400" size={16} />
                  <span className="text-2xl font-black text-white">{stats.retries}</span>
                </div>
              </div>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-5 rounded-3xl flex justify-between items-center">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">Total DB Updates</span>
                <span className="text-3xl font-black text-white">{stats.dbSaved}</span>
              </div>
              <div className="h-12 w-12 rounded-full border-4 border-indigo-500/30 border-t-indigo-500 animate-spin" style={{ animationDuration: '3s' }}></div>
            </div>
            <div className="px-1">
              <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div className="bg-gradient-to-r from-indigo-600 to-indigo-400 h-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Console Panel */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden shadow-2xl relative">
          <div className="bg-slate-900/80 p-5 border-b border-slate-800 flex justify-between items-center px-8">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} /> Intelligence Pipeline Console
            </span>
            <div className="flex items-center gap-4 text-[10px] font-mono text-slate-600">
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> Concurrent</span>
              <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Staggered</span>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] space-y-2 custom-scrollbar bg-[radial-gradient(circle_at_top_right,rgba(30,41,59,0.2),transparent)]">
            {logs.map((log, i) => (
              <div key={i} className={`group flex gap-4 p-2.5 rounded-xl border border-transparent transition-all hover:bg-slate-900/50 hover:border-slate-800/50 ${log.includes('🔄') ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                <span className="opacity-20 shrink-0 font-bold group-hover:opacity-40">[{new Date().toLocaleTimeString()}]</span>
                <span className={log.includes('✨') || log.includes('🛡️') ? 'text-slate-200' : ''}>{log}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
