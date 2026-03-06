import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Search, X, AlertCircle, Hourglass } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { supabase } from '../services/supabaseClient';

// Configuration
const CONCURRENCY = 3; 
const BATCH_SIZE = 1000; 
const COOLDOWN_MS = 60000; // 60 seconds

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

// ── Policy Card Component ──
const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 hover:border-indigo-500/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">{policy.carrier}</p>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{policy.policyNumber}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${typeColors[policy.type] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
          {policy.type}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/60 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Coverage</p>
          <p className="text-white font-bold text-sm">{policy.coverageAmount}</p>
        </div>
        <div className="bg-slate-800/60 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Effective</p>
          <p className="text-white font-bold text-sm">{policy.effectiveDate}</p>
        </div>
      </div>
    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });

  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const pendingSavesRef = useRef<{ dot_number: string; insurance_policies: any[]; date_scraped: string }[]>([]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  // ── Database Sync Logic ──
  const flushSaves = async () => {
    if (pendingSavesRef.current.length === 0) return;
    
    const batchData = [...pendingSavesRef.current];
    pendingSavesRef.current = []; // Clear immediately to prevent double-save
    
    log(`💾 Syncing batch of ${batchData.length} to Supabase...`);
    
    try {
      // Using .upsert with onConflict handles updates and inserts automatically
      const { error } = await supabase
        .from('carriers')
        .upsert(batchData, { onConflict: 'dot_number' });

      if (error) throw error;

      setStats(s => ({ ...s, dbSaved: s.dbSaved + batchData.length }));
      log(`✅ DB Sync Successful: ${batchData.length} records updated.`);
    } catch (err: any) {
      log(`❌ DB Sync Error: ${err.message}`);
    }
  };

  // ── Load MC Range ──
  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    log(`🔍 Loading MC Range ${mcRangeStart} - ${mcRangeEnd}...`);
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('mc_number, dot_number, legal_name')
        .gte('mc_number', parseInt(mcRangeStart))
        .lte('mc_number', parseInt(mcRangeEnd));

      if (error) throw error;
      setMcRangeCarriers(data.map(row => ({
        mcNumber: row.mc_number,
        dotNumber: row.dot_number,
        legalName: row.legal_name,
        insurancePolicies: []
      })));
      log(`✅ Loaded ${data.length} carriers.`);
    } catch (err: any) { log(`❌ Error: ${err.message}`); }
  };

  // ── Scraper Engine ──
  const startScraping = async () => {
    if (isProcessing) return;
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    if (target.length === 0) return log('⚠️ No carriers to process.');

    setIsProcessing(true);
    isRunningRef.current = true;
    setStats({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });
    log(`🚀 Starting Scrape. Batching every ${BATCH_SIZE} USDOTs...`);

    const updated = [...target];
    let completed = 0;

    const worker = async (index: number) => {
      if (!isRunningRef.current) return;
      const carrier = updated[index];
      if (!carrier.dotNumber) { completed++; return; }

      try {
        const result = await fetchInsuranceData(carrier.dotNumber);
        const hasIns = result.policies.length > 0;

        // Push to pending buffer
        pendingSavesRef.current.push({
          dot_number: carrier.dotNumber,
          insurance_policies: result.policies,
          date_scraped: new Date().toISOString()
        });

        setStats(s => ({
          ...s,
          processed: s.processed + 1,
          insFound: s.insFound + (hasIns ? 1 : 0),
          insEmpty: s.insEmpty + (hasIns ? 0 : 1),
        }));

        // Batch trigger
        if (pendingSavesRef.current.length >= BATCH_SIZE) {
          await flushSaves();
          log(`🕒 Pause active: 60s cooldown...`);
          setIsPaused(true);
          await new Promise(r => setTimeout(r, COOLDOWN_MS));
          setIsPaused(false);
          log(`▶️ Resuming...`);
        }
      } catch (e: any) { log(`❌ Error DOT ${carrier.dotNumber}: ${e.message}`); }
      
      completed++;
      setProgress(Math.round((completed / target.length) * 100));
    };

    // Concurrency Pool
    const active = [];
    for (let i = 0; i < target.length; i++) {
      if (!isRunningRef.current) break;
      const p = worker(i);
      active.push(p);
      if (active.length >= CONCURRENCY) await Promise.race(active);
    }

    await Promise.all(active);
    await flushSaves(); // Final leftovers
    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Scrape process completed.`);
  };

  const handleStop = async () => {
    isRunningRef.current = false;
    log('🛑 Stopping... Syncing data before exit.');
    await flushSaves();
    setIsProcessing(false);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" /> Insurance Scraper
          </h1>
          <p className="text-slate-500 font-medium ml-8 italic">Batch Save: {BATCH_SIZE} | Pause: 60s</p>
        </div>
        <button
          onClick={isProcessing ? handleStop : startScraping}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all ${
            isProcessing ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-indigo-600 text-white'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop</> : <><Zap size={20} /> Start</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto">
          {isPaused && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-center gap-3 text-amber-400 animate-pulse">
              <Hourglass size={18} />
              <span className="text-xs font-black uppercase">Cooldown Active - 60s Remaining</span>
            </div>
          )}

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <span>MC Range Loader</span>
              <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-2 py-1 rounded ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800'}`}>
                {mcRangeMode ? 'ON' : 'OFF'}
              </button>
            </div>
            {mcRangeMode && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={mcRangeStart} onChange={e => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
                  <input value={mcRangeEnd} onChange={e => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <button onClick={handleMcRangeSearch} className="w-full bg-slate-800 hover:bg-slate-700 py-2 rounded-xl text-xs font-black uppercase">Load Carriers</button>
              </div>
            )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-black block mb-1">Found Insurance</span>
                <span className="text-2xl font-black text-green-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-black block mb-1">Queue (Not Saved)</span>
                <span className="text-2xl font-black text-indigo-400">{pendingSavesRef.current.length}</span>
              </div>
            </div>
            <div className="bg-indigo-500/10 p-4 rounded-2xl border border-indigo-500/20 flex justify-between">
              <div>
                <p className="text-[10px] text-indigo-400 font-black uppercase">DB Records Updated</p>
                <p className="text-3xl font-black">{stats.dbSaved}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500 font-black uppercase">Progress</p>
                <p className="text-3xl font-black text-slate-400">{progress}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Console */}
        <div className="col-span-12 lg:col-span-8 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <ClipboardList size={14} /> Pipeline Console
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 ${log.includes('✅') ? 'text-green-400' : log.includes('❌') ? 'text-red-400' : 'text-slate-400'}`}>
                <span className="opacity-20">{new Date().toLocaleTimeString()}</span>
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
