
import React, { useState } from 'react';
import { Search, Eye, X, MapPin, Phone, Mail, Hash, Truck, Calendar, ShieldCheck, Download, ShieldAlert, Activity, Info, Globe, Map as MapIcon, Boxes, Shield, ExternalLink, CheckCircle2, AlertTriangle, Zap, Loader2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { CarrierData } from '../types';
import { downloadCSV } from '../services/mockService';
import { CarrierFilters } from '../services/supabaseClient';

interface CarrierSearchProps {
  carriers: CarrierData[];
  onSearch: (filters: CarrierFilters) => void;
  isLoading: boolean;
  onNavigateToInsurance: () => void;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
];

const calculateYearsInBusiness = (mcs150Date: string | undefined): number | null => {
  if (!mcs150Date || mcs150Date === 'N/A') return null;
  try {
    const date = new Date(mcs150Date);
    if (isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    const ageDate = new Date(diffMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  } catch (e) {
    return null;
  }
};

export const CarrierSearch: React.FC<CarrierSearchProps> = ({ carriers, onSearch, isLoading, onNavigateToInsurance }) => {
  const [mcSearchTerm, setMcSearchTerm] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [selectedDot, setSelectedDot] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<'inspections' | 'crashes'>('inspections');
  const [expandedInspection, setExpandedInspection] = useState<string | null>(null);

  const selectedCarrier = carriers.find(c => c.dotNumber === selectedDot);

  const handleSearch = () => {
    onSearch({
      mcNumber: mcSearchTerm.trim() || undefined,
      legalName: nameSearchTerm.trim() || undefined
    });
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative bg-slate-950">
      {/* Search Header */}
      <div className="mb-8 flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">MC Number</label>
          <div className="relative">
            <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              value={mcSearchTerm}
              onChange={(e) => setMcSearchTerm(e.target.value)}
              placeholder="Enter MC#"
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-white outline-none focus:border-indigo-500 transition-all font-mono"
            />
          </div>
        </div>
        <div className="flex-[2] space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Company Name</label>
          <div className="relative">
            <Truck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              value={nameSearchTerm}
              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Search by Legal Name..."
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-white outline-none focus:border-indigo-500 transition-all"
            />
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={isLoading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-2 transition-all active:scale-95 shadow-xl shadow-indigo-600/20"
        >
          {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
          {isLoading ? 'Searching...' : 'Search Database'}
        </button>
      </div>

      {/* Results Table */}
      <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
        <div className="overflow-y-auto flex-1 custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-900/90 backdrop-blur sticky top-0 z-10 border-b border-slate-800">
              <tr>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">MC Number</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">Legal Name</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">DOT Number</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500">Status</th>
                <th className="p-4 font-bold text-[10px] uppercase tracking-widest text-slate-500 text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {carriers.map((carrier, idx) => (
                <tr key={idx} className="hover:bg-indigo-500/5 transition-colors group cursor-pointer" onClick={() => setSelectedDot(carrier.dotNumber)}>
                  <td className="p-4 font-mono text-indigo-400 font-bold">{carrier.mcNumber}</td>
                  <td className="p-4">
                    <div className="font-bold text-white group-hover:text-indigo-200 transition-colors truncate max-w-[250px]">{carrier.legalName}</div>
                  </td>
                  <td className="p-4 font-mono text-slate-400">{carrier.dotNumber}</td>
                  <td className="p-4">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-black tracking-tight border ${carrier.status?.includes('AUTHORIZED') && !carrier.status?.includes('NOT') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                      {carrier.status?.includes('AUTHORIZED') && !carrier.status?.includes('NOT') ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <button className="p-2 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-xl transition-all shadow-lg">
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Modal Popup */}
      {selectedCarrier && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-slate-700/50 w-full max-w-7xl max-h-[95vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col relative">
            
            {/* Modal Header */}
            <div className="p-6 md:p-8 border-b border-slate-800 bg-slate-850/30 flex justify-between items-center">
              <div className="flex gap-4 items-center">
                <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
                  <Truck size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-tighter">{selectedCarrier.legalName}</h2>
                  <p className="text-sm text-slate-400">MC# {selectedCarrier.mcNumber} | DOT# {selectedCarrier.dotNumber}</p>
                </div>
              </div>
              <button onClick={() => setSelectedDot(null)} className="p-2 text-slate-500 hover:text-white transition-colors">
                <X size={28} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar space-y-8">
              
              {/* TIER 1: Identification, Contact, Compliance */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Hash size={14} className="text-indigo-400" /> Identification
                  </h3>
                  <div className="space-y-2">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">MC Number</span><span className="text-base font-black text-indigo-400 font-mono">{selectedCarrier.mcNumber}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">USDOT Number</span><span className="text-base font-black text-white font-mono">{selectedCarrier.dotNumber}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Phone size={14} className="text-indigo-400" /> Contact Info
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2"><Phone size={14} className="text-slate-500" /><span className="text-sm font-bold text-white">{selectedCarrier.phone || 'N/A'}</span></div>
                    <div className="flex items-center gap-2"><Mail size={14} className="text-slate-500" /><span className="text-sm font-bold text-indigo-300">{selectedCarrier.email || 'N/A'}</span></div>
                    <div className="flex items-center gap-2"><MapPin size={14} className="text-slate-500" /><span className="text-xs font-bold text-slate-400">{selectedCarrier.physicalAddress}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Calendar size={14} className="text-indigo-400" /> Compliance
                  </h3>
                  <div className="space-y-2">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">MCS-150 Date</span><span className="text-sm font-bold text-white">{selectedCarrier.mcs150Date || 'N/A'}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">Mileage</span><span className="text-sm font-bold text-slate-400">{selectedCarrier.mcs150Mileage || 'N/A'}</span></div>
                  </div>
                </div>
              </div>

              {/* TIER 2: Operation Information, Verified L&I Filings */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-850/60 p-8 rounded-[2rem] border border-slate-700/50 space-y-6">
                  <div className="flex items-center gap-3"><Truck size={20} className="text-indigo-400" /><h4 className="text-xl font-black text-white uppercase">Operation Information</h4></div>
                  <div className="space-y-4">
                    <div><h5 className="text-[10px] font-black text-slate-500 uppercase mb-2">Classifications</h5><p className="text-sm font-bold text-slate-200 bg-slate-900/50 p-3 rounded-xl border border-slate-800">{selectedCarrier.operationClassification?.join(', ') || 'N/A'}</p></div>
                    <div><h5 className="text-[10px] font-black text-slate-500 uppercase mb-2">Cargo Carried</h5><div className="flex flex-wrap gap-2">{selectedCarrier.cargoCarried?.map((c, i) => <span key={i} className="bg-slate-900 text-slate-400 px-3 py-1 rounded-lg text-[10px] font-bold border border-slate-800">{c}</span>)}</div></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-8 rounded-[2rem] border border-slate-700/50 space-y-6">
                  <div className="flex items-center gap-3"><ShieldCheck size={20} className="text-emerald-400" /><h4 className="text-xl font-black text-white uppercase">Verified L&I Filings</h4></div>
                  <div className="space-y-3 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                    {selectedCarrier.insurancePolicies?.map((p, i) => (
                      <div key={i} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex justify-between items-center">
                        <div><p className="text-[10px] font-black text-indigo-400 uppercase">{p.type}</p><p className="text-sm font-bold text-white truncate max-w-[200px]">{p.carrier}</p></div>
                        <div className="text-right"><p className="text-sm font-black text-white">{p.coverageAmount}</p><p className="text-[9px] text-slate-500 font-mono">EFF: {p.effectiveDate}</p></div>
                      </div>
                    )) || <p className="text-slate-500 italic text-center py-8">No filings found</p>}
                  </div>
                </div>
              </div>

              {/* TIER 3: Inspection History, Safety Information */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Inspections & Crashes Card */}
                <div className="bg-white rounded-[2rem] p-8 flex flex-col shadow-xl text-slate-900">
                  <div className="flex items-center gap-3 mb-6">
                    <Activity size={20} className="text-slate-700" />
                    <h4 className="text-xl font-black uppercase tracking-tight">Inspections & Crashes</h4>
                  </div>

                  {/* Tabs */}
                  <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
                    <button 
                      onClick={() => setActiveTab('inspections')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'inspections' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Inspections
                    </button>
                    <button 
                      onClick={() => setActiveTab('crashes')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'crashes' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Crashes
                    </button>
                  </div>

                  {/* Summary Stats */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Total</span>
                      <span className="text-xl font-black">{activeTab === 'inspections' ? selectedCarrier.inspections?.length || 0 : selectedCarrier.crashes?.length || 0}</span>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-center">
                      <span className="text-[10px] font-bold text-blue-400 uppercase block mb-1">Violations</span>
                      <span className="text-xl font-black text-blue-600">
                        {selectedCarrier.inspections?.reduce((acc, curr) => acc + (curr.violationList?.length || 0), 0) || 0}
                      </span>
                    </div>
                    <div className="bg-red-50 p-4 rounded-2xl border border-red-100 text-center">
                      <span className="text-[10px] font-bold text-red-400 uppercase block mb-1">OOS</span>
                      <span className="text-xl font-black text-red-600">
                        {selectedCarrier.inspections?.reduce((acc, curr) => acc + (curr.oosViolations || 0), 0) || 0}
                      </span>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Crashes</span>
                      <span className="text-xl font-black">{selectedCarrier.crashes?.length || 0}</span>
                    </div>
                  </div>

                  {/* List Content */}
                  <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                    {activeTab === 'inspections' ? (
                      selectedCarrier.inspections?.map((insp, i) => (
                        <div key={i} className="border border-slate-100 rounded-2xl overflow-hidden group">
                          <div 
                            className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 transition-colors"
                            onClick={() => setExpandedInspection(expandedInspection === insp.reportNumber ? null : insp.reportNumber)}
                          >
                            <div>
                              <p className="text-sm font-black">{insp.date}</p>
                              <p className="text-[11px] text-slate-500">{insp.location}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {insp.violationList?.length > 0 && (
                                <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg text-[10px] font-black">
                                  {insp.violationList.length} Violations
                                </span>
                              )}
                              {insp.oosViolations > 0 && (
                                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-lg text-[10px] font-black">OOS</span>
                              )}
                              {expandedInspection === insp.reportNumber ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                          </div>
                          
                          {expandedInspection === insp.reportNumber && (
                            <div className="px-4 pb-4 pt-4 border-t border-slate-100 bg-[#F8F9FA]">
                              <div className="grid grid-cols-3 grid-rows-2 gap-y-4 gap-x-6 mb-6">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)]">Report #:</span>
                                  <span className="text-[14px] leading-[20px] font-medium text-[oklch(0.372_0.044_257.287)]">{insp.reportNumber}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)]">Location:</span>
                                  <span className="text-[14px] leading-[20px] font-medium text-[oklch(0.372_0.044_257.287)]">{insp.location}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)]">OOS Violations:</span>
                                  <span className="text-[14px] leading-[20px] font-medium text-[oklch(0.372_0.044_257.287)]">{insp.oosViolations}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)]">Driver Violations:</span>
                                  <span className="text-[14px] leading-[20px] font-medium text-[oklch(0.372_0.044_257.287)]">{insp.driverViolations}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)]">Vehicle Violations:</span>
                                  <span className="text-[14px] leading-[20px] font-medium text-[oklch(0.372_0.044_257.287)]">{insp.vehicleViolations}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)]">Hazmat Violations:</span>
                                  <span className="text-[14px] leading-[20px] font-medium text-[oklch(0.372_0.044_257.287)]">{insp.hazmatViolations}</span>
                                </div>
                              </div>
                              {insp.violationList?.length > 0 && (
                                <div className="space-y-2 mt-4 pt-4 border-t border-slate-200">
                                  <span className="text-[12px] leading-[16px] font-normal text-[oklch(0.554_0.046_257.417)] uppercase tracking-wider">Violation Details</span>
                                  {insp.violationList.map((v: any, vi: number) => (
                                    <div key={vi} className="bg-white p-3 rounded-xl border border-slate-200 text-[11px] relative group/viol shadow-sm">
                                      <div className="flex justify-between font-bold mb-1">
                                        <span className="text-blue-600">{v.label}</span>
                                        <span className="text-slate-400">Weight: {v.weight}</span>
                                      </div>
                                      <p className="text-slate-600 leading-relaxed">{v.description}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      selectedCarrier.crashes?.map((crash, i) => (
                        <div key={i} className="p-4 border border-slate-100 rounded-2xl flex justify-between items-center">
                          <div>
                            <p className="text-sm font-black">{crash.date}</p>
                            <p className="text-[11px] text-slate-500">{crash.state} | {crash.number}</p>
                          </div>
                          <div className="flex gap-2">
                            {parseInt(crash.fatal) > 0 && <span className="bg-red-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black">FATAL</span>}
                            {parseInt(crash.injuries) > 0 && <span className="bg-orange-500 text-white px-2 py-0.5 rounded-lg text-[10px] font-black">INJURY</span>}
                          </div>
                        </div>
                      )) || <p className="text-center py-10 text-slate-400 italic">No crash records found</p>
                    )}
                  </div>
                </div>

                {/* Safety Information Card */}
                <div className="bg-slate-850/60 p-8 rounded-[2rem] border border-slate-700/50 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3"><ShieldCheck size={20} className="text-indigo-400" /><h4 className="text-xl font-black text-white uppercase">Safety Information</h4></div>
                    <a href={`https://ai.fmcsa.dot.gov/SMS/Carrier/${selectedCarrier.dotNumber}/CompleteProfile.aspx`} target="_blank" className="text-[10px] font-bold text-indigo-400 flex items-center gap-1"><ExternalLink size={12} /> Source</a>
                  </div>
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                      <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400"><CheckCircle2 size={24} /></div>
                      <div><p className="text-xs font-black text-slate-500 uppercase">Safety Rating</p><p className="text-lg font-black text-white uppercase">{selectedCarrier.safetyRating}</p></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedCarrier.oosRates?.map((oos, i) => (
                        <div key={i} className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/50">
                          <span className="text-[9px] text-slate-500 font-black uppercase block mb-1">{oos.type} OOS</span>
                          <div className="flex justify-between items-end"><span className="text-base font-black text-white">{oos.rate}</span><span className="text-[9px] text-slate-600">Avg: {oos.nationalAvg}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 md:p-8 bg-slate-950/70 border-t border-slate-800 flex justify-end gap-4">
              <button onClick={() => setSelectedDot(null)} className="px-8 py-3 bg-slate-800 text-white rounded-xl text-sm font-bold">Close View</button>
              <button className="px-8 py-3 bg-indigo-600 text-white rounded-xl text-sm font-black flex items-center gap-2"><Download size={18} /> Download Report</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
