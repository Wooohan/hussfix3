import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  ClipboardList,
  Loader2,
  Zap,
  RotateCcw,
  ShieldCheck,
  Activity
} from 'lucide-react';

import { CarrierData } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({
  carriers,
  onUpdateCarriers,
  autoStart
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const [stats, setStats] = useState({
    total: 0,
    insFound: 0,
    dbSaved: 0
  });

  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const sleep = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;

    setLogs(prev => [
      ...prev,
      `🔍 Searching Database for MC ${mcRangeStart} - ${mcRangeEnd}...`
    ]);

    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd);

      if (error) throw error;

      setMcRangeCarriers(data || []);

      setLogs(prev => [
        ...prev,
        `✅ Loaded ${data?.length || 0} carriers from range.`
      ]);
    } catch (err: any) {
      setLogs(prev => [...prev, `❌ DB Error: ${err.message}`]);
    }
  };

  const startInsuranceScraping = async () => {
    if (isProcessing) return;

    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;

    if (targetCarriers.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;

    setLogs(prev => [
      ...prev,
      `🚀 STARTING INSURANCE SCRAPER: Processing ${targetCarriers.length} carriers`
    ]);

    const updated = [...targetCarriers];

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;

      const carrier = updated[i];

      setLogs(prev => [
        ...prev,
        `📡 [${i + 1}/${updated.length}] Fetching Insurance for DOT ${carrier.dotNumber}`
      ]);

      try {
        const insResult = await fetchInsuranceData(carrier.dotNumber);

        updated[i] = {
          ...updated[i],
          insurancePolicies: insResult.policies
        };

        const insSave = await updateCarrierInsurance(
          carrier.dotNumber,
          { policies: insResult.policies }
        );

        setStats(s => ({
          ...s,
          insFound: s.insFound + (insResult.policies.length > 0 ? 1 : 0),
          dbSaved: s.dbSaved + (insSave.success ? 1 : 0)
        }));

        setLogs(prev => [
          ...prev,
          `✨ Insurance Policies Found: ${insResult.policies.length}`
        ]);

        onUpdateCarriers([...updated]);
      } catch (err) {
        setLogs(prev => [
          ...prev,
          `❌ Error processing DOT ${carrier.dotNumber}`
        ]);
      }

      setProgress(Math.round(((i + 1) / updated.length) * 100));

      if (i < updated.length - 1) {
        await sleep(1000);
      }
    }

    setIsProcessing(false);
    isRunningRef.current = false;

    setLogs(prev => [...prev, `🎉 INSURANCE SCRAPING COMPLETE.`]);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">
      
      <div className="flex justify-between items-center mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="text-indigo-500 animate-pulse" size={24} />
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">
              Insurance Scraper Engine
            </h1>
          </div>
          <p className="text-slate-500 font-medium ml-8">
            Automated FMCSA Insurance Policy Scraper
          </p>
        </div>

        <button
          onClick={() =>
            isProcessing
              ? (isRunningRef.current = false)
              : startInsuranceScraping()
          }
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all transform active:scale-95 ${
            isProcessing
              ? 'bg-red-500/10 text-red-500 border border-red-500/50'
              : 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'
          }`}
        >
          {isProcessing ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              Stop
            </>
          ) : (
            <>
              <Zap size={20} />
              Start Scraping
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">

        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2">

          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-[2rem]">
            <div className="flex items-center justify-between mb-6">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Database size={14} className="text-indigo-400" />
                Database Range
              </span>

              <button
                onClick={() => setMcRangeMode(!mcRangeMode)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-black ${
                  mcRangeMode
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {mcRangeMode ? 'ACTIVE' : 'OFF'}
              </button>
            </div>

            {mcRangeMode && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mcRangeStart}
                    onChange={e => setMcRangeStart(e.target.value)}
                    placeholder="Start MC"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm"
                  />

                  <input
                    type="text"
                    value={mcRangeEnd}
                    onChange={e => setMcRangeEnd(e.target.value)}
                    placeholder="End MC"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm"
                  />
                </div>

                <button
                  onClick={handleMcRangeSearch}
                  className="w-full bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-xs font-black uppercase"
                >
                  Load Carriers
                </button>
              </div>
            )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-[2rem] space-y-4">
            <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800/50">
              <span className="text-[10px] text-slate-500 font-black uppercase block mb-2">
                Insurance Found
              </span>

              <div className="flex items-center gap-2">
                <ShieldCheck className="text-indigo-400" size={16} />
                <span className="text-2xl font-black text-white">
                  {stats.insFound}
                </span>
              </div>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 p-5 rounded-3xl flex justify-between items-center">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">
                  Total DB Updates
                </span>
                <span className="text-3xl font-black text-white">
                  {stats.dbSaved}
                </span>
              </div>

              <div className="h-12 w-12 rounded-full border-4 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
            </div>

            <div className="px-1">
              <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>

              <div className="w-full bg-slate-950 rounded-full h-2 border border-slate-800">
                <div
                  className="bg-gradient-to-r from-indigo-600 to-indigo-400 h-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden">
          <div className="bg-slate-900/80 p-5 border-b border-slate-800 flex justify-between items-center px-8">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} />
              Scraper Console
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] space-y-2">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-4 p-2.5 rounded-xl text-slate-400">
                <span className="opacity-20 shrink-0 font-bold">
                  [{new Date().toLocaleTimeString()}]
                </span>
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
