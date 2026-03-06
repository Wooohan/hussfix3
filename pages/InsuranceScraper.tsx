import React, { useState, useRef, useEffect } from 'react';
import { ClipboardList, Loader2, Zap, ShieldCheck, Database, RotateCcw, Search, X, AlertCircle } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance, supabase } from '../services/supabaseClient';

const CONCURRENCY = 3;

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

// ── Policy Card Component ──
const PolicyCard: React.FC<{ policy: InsurancePolicy; dot: string }> = ({ policy, dot }) => {
  const typeColors: Record<string, string> = {
    'BI&PD':  'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'CARGO':  'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'BOND':   'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  const classColors: Record<string, string> = {
    'PRIMARY': 'bg-green-500/20 text-green-300',
    'EXCESS':  'bg-orange-500/20 text-orange-300',
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 hover:border-indigo-500/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate" title={policy.carrier}>
            {policy.carrier}
          </p>
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

      // Mapped to exclude Safety Ratings and BASIC scores
      const mapped = (data || []).map((row: any) => ({
        mcNumber:        row.mc_number        || row.mcNumber        || '',
        dotNumber:       row.dot_number       || row.dotNumber       || '',
        legalName:       row.legal_name       || row.legalName       || '',
        dbaName:         row.dba_name         || row.dbaName         || '',
        entityType:      row.entity_type      || row.entityType      || '',
        status:          row.status           || '',
        email:           row.email            || '',
        phone:           row.phone            || '',
        powerUnits:      row.power_units      || row.powerUnits      || '',
        drivers:         row.drivers          || '',
        physicalAddress: row.physical_address || row.physicalAddress || '',
        mailingAddress:  row.mailing_address  || row.mailingAddress  || '',
        dateScraped:     row.date_scraped     || row.dateScraped     || '',
        mcs150Date:      row.mcs150_date      || row.mcs150Date      || '',
        mcs150Mileage:   row.mcs150_mileage   || row.mcs150Mileage   || '',
        operationClassification: row.operation_classification || row.operationClassification || [],
        carrierOperation:        row.carrier_operation        || row.carrierOperation        || [],
        cargoCarried:            row.cargo_carried            || row.cargoCarried            || [],
        insurancePolicies:       row.insurance_policies       || row.insurancePolicies       || [],
      }));

      setMcRangeCarriers(mapped);
      log(`✅ Loaded ${mapped.length} carriers for insurance audit.`);
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
        completed++;
        return;
      }

      try {
        const result = await fetchInsuranceData(dot);
        const hasInsurance = result.policies.length > 0;
        
        updated[index] = { ...updated[index], insurancePolicies: result.policies };
        
        await new Promise(r => setTimeout(r, (index % 5) * 150));
        const saveResult = await updateCarrierInsurance(dot, { policies: result.policies });

        setStats(s => ({
          ...s,
          processed: s.processed + 1,
          insFound: s.insFound + (hasInsurance ? 1 : 0),
          insEmpty: s.insEmpty + (hasInsurance ? 0 : 1),
          dbSaved: s.dbSaved + (saveResult.success && hasInsurance ? result.policies.length : 0),
        }));

        if (hasInsurance) {
          log(`✅ DOT ${dot} | ${result.policies.length} Policies Found`);
        } else {
          log(`⬜ DOT ${dot} | No Active Insurance`);
        }
        onUpdateCarriers([...updated]);
      } catch (err: any) {
        log(`❌ DOT ${dot} | Error: ${err.message}`);
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
      if (activePromises.length >= CONCURRENCY) await Promise.race(activePromises);
    }
    await Promise.all(activePromises);

    setIsProcessing(false);
    isRunningRef.current = false;
    log(`🎉 Insurance Audit Complete.`);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="text-indigo-500" size={24} />
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Insurance Manager</h1>
          </div>
          <p className="text-slate-500 font-medium ml-8">
            Policy Auditing · Coverage Verification · Concurrency {CONCURRENCY}
          </p>
        </div>
        <button
          onClick={isProcessing ? () => (isRunningRef.current = false) : startScraping}
          className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all transform active:scale-95 ${
            isProcessing
              ? 'bg-red-500/10 text-red-500 border border-red-500/50'
              : 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'
          }`}
        >
          {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop</> : <><Zap size={20} /> Start Audit</>}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">
        <div className="col-span-12 lg:col-span-4 space-y-4 overflow-y-auto pr-1">
          {/* Manual Lookup */}
          <div className="bg-slate-900/50 border border-slate-700 p-5 rounded-2xl">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Search size={12} className="text-indigo-400" /> Policy Lookup
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={dotSearch}
                onChange={e => setDotSearch(e.target.value)}
                placeholder="Enter USDOT..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
              />
              <button onClick={handleDotSearch} className="px-4 py-2.5 bg-indigo-600 rounded-xl text-white font-black">
                {dotSearching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              </button>
            </div>
            {dotResult && (
              <div className="mt-4 space-y-3">
                {dotResult.policies.map((p, i) => <PolicyCard key={i} policy={p} dot={dotResult.dot} />)}
              </div>
            )}
          </div>

          {/* Stats Section */}
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Insured</span>
                <span className="text-2xl font-black text-white">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Uninsured</span>
                <span className="text-2xl font-black text-slate-400">{stats.insEmpty}</span>
              </div>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl">
                <span className="text-[10px] text-indigo-400 font-black uppercase block mb-1">Total Policies Saved</span>
                <span className="text-3xl font-black text-white">{stats.dbSaved}</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div className="bg-indigo-600 h-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        {/* Audit Console */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex justify-between">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Insurance Feed</span>
          </div>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] space-y-1">
            {logs.map((entry, i) => (
              <div key={i} className={`p-2 rounded-lg ${entry.includes('✅') ? 'text-green-400' : 'text-slate-400'}`}>
                {entry}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
