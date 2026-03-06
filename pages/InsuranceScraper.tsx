import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Download, Database, SearchIcon, ClipboardList, Loader2, CheckCircle2, Info, AlertCircle, ShieldAlert, Zap } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData } from '../services/mockService';
import { updateCarrierInsurance } from '../services/supabaseClient';

const BATCH_SIZE = 1000;
const PAUSE_TIME = 60000;

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

  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ policies: InsurancePolicy[] } | null>(null);

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
      setLogs(prev => [...prev, "❌ No carriers loaded"]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;

    setLogs(prev => [...prev, `🚀 Insurance Extraction Started`]);
    setLogs(prev => [...prev, `🔍 Processing ${carriers.length} USDOT records`]);

    const updatedCarriers = [...carriers];

    let insFound = 0;
    let insFailed = 0;
    let dbSaved = 0;
    let batchCounter = 0;

    const batchResults: { dot: string, policies: InsurancePolicy[] }[] = [];

    const saveBatch = async () => {

      if (batchResults.length === 0) return;

      setLogs(prev => [...prev, `💾 Saving batch of ${batchResults.length}`]);

      for (const item of batchResults) {

        try {

          const res = await updateCarrierInsurance(item.dot, { policies: item.policies });

          if (res.success) dbSaved++;

        } catch {}

      }

      batchResults.length = 0;

      setStats(prev => ({
        ...prev,
        dbSaved
      }));

      setLogs(prev => [...prev, `✅ Batch saved`]);

    };

    for (let i = 0; i < updatedCarriers.length; i++) {

      if (!isRunningRef.current) break;

      const dot = updatedCarriers[i].dotNumber;

      setLogs(prev => [...prev, `⏳ [${i + 1}/${updatedCarriers.length}] Checking DOT ${dot}`]);

      try {

        if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error("Invalid DOT");

        const { policies } = await fetchInsuranceData(dot);

        updatedCarriers[i] = {
          ...updatedCarriers[i],
          insurancePolicies: policies
        };

        batchResults.push({ dot, policies });

        batchCounter++;

        if (policies.length > 0) {

          insFound++;

          setLogs(prev => [...prev, `✨ ${dot} → ${policies.length} policies found`]);

        } else {

          setLogs(prev => [...prev, `⚠️ ${dot} → No insurance found`]);

        }

      } catch {

        insFailed++;

        setLogs(prev => [...prev, `❌ ${dot} insurance failed`]);

      }

      setProgress(Math.round(((i + 1) / updatedCarriers.length) * 100));

      setStats({
        total: updatedCarriers.length,
        insFound,
        insFailed,
        dbSaved
      });

      if ((i + 1) % 3 === 0 || i === updatedCarriers.length - 1) {
        onUpdateCarriers([...updatedCarriers]);
      }

      if (batchCounter >= BATCH_SIZE) {

        await saveBatch();

        setLogs(prev => [...prev, `⏸ Cooling down 60 seconds`]);

        await new Promise(r => setTimeout(r, PAUSE_TIME));

        batchCounter = 0;

      }

    }

    await saveBatch();

    setLogs(prev => [...prev, `🎉 Insurance scraping complete`]);
    setLogs(prev => [...prev, `💾 Total DB updates: ${dbSaved}`]);

    setIsProcessing(false);
    isRunningRef.current = false;

  };

  const handleManualCheck = async (e: React.FormEvent) => {

    e.preventDefault();

    if (!manualDot) return;

    setIsManualLoading(true);
    setManualResult(null);

    try {

      const { policies } = await fetchInsuranceData(manualDot);

      setManualResult({ policies });

    } catch {}

    setIsManualLoading(false);

  };

  const handleExport = () => {

    const enriched = carriers.filter(c => c.insurancePolicies && c.insurancePolicies.length > 0);

    if (enriched.length === 0) return;

    const headers = ["DOT", "Legal Name", "Insurance Carrier", "Coverage", "Type"];

    const rows = enriched.flatMap(c =>
      c.insurancePolicies.map(p => [
        c.dotNumber,
        `"${c.legalName}"`,
        `"${p.carrier}"`,
        p.coverageAmount,
        p.type
      ])
    );

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;

    link.download = `insurance_export_${Date.now()}.csv`;

    link.click();

  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden">

      <div className="flex justify-between mb-6">

        <button
          onClick={() => isProcessing ? isRunningRef.current = false : startEnrichmentProcess()}
          className={`px-8 py-3 rounded-xl font-bold ${isProcessing ? 'bg-red-600' : 'bg-indigo-600'}`}
        >
          {isProcessing ? "Stop Scraping" : "Start Insurance Scraper"}
        </button>

        <button
          onClick={handleExport}
          className="px-6 py-3 bg-slate-800 rounded-xl"
        >
          Export CSV
        </button>

      </div>

      <div className="flex gap-4 mb-6">

        <input
          value={manualDot}
          onChange={e => setManualDot(e.target.value)}
          placeholder="Manual DOT lookup"
          className="bg-slate-900 px-4 py-2 rounded"
        />

        <button
          onClick={handleManualCheck}
          className="bg-indigo-600 px-4 py-2 rounded"
        >
          Check
        </button>

      </div>

      <div className="mb-4">

        <div>Total: {stats.total}</div>
        <div>Insurance Found: {stats.insFound}</div>
        <div>Failed: {stats.insFailed}</div>
        <div>DB Saved: {stats.dbSaved}</div>
        <div>Progress: {progress}%</div>

      </div>

      <div className="flex-1 bg-black p-4 overflow-y-auto text-xs font-mono rounded">

        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}

        <div ref={logsEndRef}></div>

      </div>

    </div>
  );
};
