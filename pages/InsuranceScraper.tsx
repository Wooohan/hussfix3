import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Search, X, AlertCircle } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

const CONCURRENCY = 3;

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {

  const typeColors: Record<string, string> = {
    'BI&PD': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };

  const classColors: Record<string, string> = {
    'PRIMARY': 'bg-green-500/20 text-green-300',
    'EXCESS': 'bg-orange-500/20 text-orange-300',
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 hover:border-indigo-500/50 transition-colors">

      <div className="flex items-start justify-between gap-2">

        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">{policy.carrier}</p>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{policy.policyNumber}</p>
        </div>

        <div className="flex gap-1.5 shrink-0">

          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${typeColors[policy.type] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
            {policy.type}
          </span>

          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${classColors[policy.class] || 'bg-slate-700 text-slate-400'}`}>
            {policy.class}
          </span>

        </div>
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

      <div className="pt-1 border-t border-slate-800 flex justify-between items-center">

        <span className="text-[10px] text-slate-600 font-mono">DOT #{dot}</span>

        <span className="text-[10px] text-indigo-400 font-black">ACTIVE</span>

      </div>

    </div>
  );
};

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({
  carriers,
  onUpdateCarriers,
}) => {

  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const [stats, setStats] = useState({
    processed: 0,
    insFound: 0,
    insEmpty: 0,
    dbSaved: 0,
  });

  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const [dotSearch, setDotSearch] = useState('');
  const [dotSearching, setDotSearching] = useState(false);
  const [dotResult, setDotResult] = useState<{ dot: string; policies: InsurancePolicy[] } | null>(null);
  const [dotError, setDotError] = useState('');

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  const handleDotSearch = async () => {

    const dot = dotSearch.trim();
    if (!dot) return;

    setDotSearching(true);
    setDotResult(null);
    setDotError('');

    try {

      const result = await fetchInsuranceData(dot);

      if (result.policies.length === 0) {
        setDotError(`No insurance policies found for DOT #${dot}`);
      } else {

        setDotResult({ dot, policies: result.policies });

        await updateCarrierInsurance(dot, { policies: result.policies });

      }

    } catch (e: any) {

      setDotError(`Error fetching DOT #${dot}: ${e.message}`);

    } finally {

      setDotSearching(false);

    }

  };

  const handleMcRangeSearch = async () => {

    if (!mcRangeStart || !mcRangeEnd) return;

    log(`🔍 Loading MC ${mcRangeStart} → ${mcRangeEnd} from database...`);

    try {

      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', parseInt(mcRangeStart))
        .lte('mc_number', parseInt(mcRangeEnd))
        .order('mc_number', { ascending: true });

      if (error) throw error;

      const mapped = (data || []).map((row: any) => ({
        mcNumber: row.mc_number || '',
        dotNumber: row.dot_number || '',
        legalName: row.legal_name || '',
        status: row.status || '',
        email: row.email || '',
        phone: row.phone || '',
        insurancePolicies: row.insurance_policies || [],
      }));

      setMcRangeCarriers(mapped);

      log(`✅ Loaded ${mapped.length} carriers from DB range.`);

    } catch (err: any) {

      log(`❌ DB Error: ${err.message}`);

    }

  };

  const startScraping = async () => {

    if (isProcessing) return;

    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;

    if (targetCarriers.length === 0) {

      log('⚠️ No carriers to process.');
      return;

    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setProgress(0);
    setStats({ processed: 0, insFound: 0, insEmpty: 0, dbSaved: 0 });

    log(`🚀 Starting insurance scrape for ${targetCarriers.length} carriers...`);

    const updated = [...targetCarriers];

    let completed = 0;

    const worker = async (index: number) => {

      if (!isRunningRef.current) return;

      const carrier = updated[index];
      const dot = carrier.dotNumber;

      if (!dot) {

        log(`⚠️ MC ${carrier.mcNumber} — no DOT number`);
        completed++;
        return;

      }

      try {

        const result = await fetchInsuranceData(dot);

        const hasInsurance = result.policies.length > 0;

        updated[index] = {
          ...updated[index],
          insurancePolicies: result.policies
        };

        const saveResult = await updateCarrierInsurance(dot, {
          policies: result.policies
        });

        setStats(s => ({
          processed: s.processed + 1,
          insFound: s.insFound + (hasInsurance ? 1 : 0),
          insEmpty: s.insEmpty + (hasInsurance ? 0 : 1),
          dbSaved: s.dbSaved + (saveResult.success ? result.policies.length : 0),
        }));

        if (hasInsurance) {
          log(`✅ DOT ${dot} → ${result.policies.length} policies saved`);
        } else {
          log(`⬜ DOT ${dot} → No insurance`);
        }

        onUpdateCarriers([...updated]);

      } catch (err: any) {

        log(`❌ DOT ${dot} → ${err.message}`);

      }

      completed++;

      setProgress(Math.round((completed / targetCarriers.length) * 100));

    };

    const activePromises: Promise<void>[] = [];

    for (let i = 0; i < targetCarriers.length; i++) {

      if (!isRunningRef.current) break;

      const p = worker(i).then(() => {
        activePromises.splice(activePromises.indexOf(p), 1);
      });

      activePromises.push(p);

      if (activePromises.length >= CONCURRENCY) {
        await Promise.race(activePromises);
      }

    }

    await Promise.all(activePromises);

    setIsProcessing(false);
    isRunningRef.current = false;

    log(`🎉 Done. ${completed} carriers processed.`);

  };

  const handleStop = () => {
    isRunningRef.current = false;
    log('⚠️ Stopped by user.');
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100">

      <div className="flex justify-between items-center mb-6">

        <div>

          <h1 className="text-3xl font-black text-white flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" size={24} />
            Insurance Scraper
          </h1>

          <p className="text-slate-500 text-sm">
            Insurance only · Supabase saving
          </p>

        </div>

        <button
          onClick={isProcessing ? handleStop : startScraping}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 ${
            isProcessing
              ? 'bg-red-500/10 text-red-500 border border-red-500/50'
              : 'bg-indigo-600 text-white'
          }`}
        >

          {isProcessing
            ? <><Loader2 className="animate-spin" size={20}/> Stop</>
            : <><Zap size={20}/> Start Scrape</>
          }

        </button>

      </div>

      <div className="flex-1 overflow-y-auto bg-slate-950 rounded-2xl border border-slate-800 p-6 font-mono text-[11px] space-y-1">

        {logs.length === 0 &&
          <span className="text-slate-600 italic">
            Ready — press Start Scrape...
          </span>
        }

        {logs.map((entry, i) => (

          <div key={i} className="text-slate-400 flex gap-3">

            <span className="opacity-30">
              {new Date().toLocaleTimeString()}
            </span>

            <span>{entry}</span>

          </div>

        ))}

        <div ref={logsEndRef} />

      </div>

    </div>
  );
};
