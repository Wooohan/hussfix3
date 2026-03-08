import React, { useState } from 'react';
import { Search, Eye, X, MapPin, Phone, Mail, Hash, Truck, Calendar, ShieldCheck, Download, ShieldAlert, Activity, Info, ExternalLink, CheckCircle2, Zap, Loader2, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { CarrierData } from '../types';
import { downloadCSV } from '../services/mockService';
import { CarrierFilters } from '../services/supabaseClient';

interface CarrierSearchProps {
  carriers: CarrierData[];
  onSearch: (filters: CarrierFilters) => void;
  isLoading: boolean;
  onNavigateToInsurance: () => void;
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const OPERATION_CLASSIFICATIONS = ['Auth. For Hire','Exempt For Hire','Private(Property)','Private(Passenger)','Migrant','U.S. Mail','Federal Government','State Government','Local Government','Indian Tribe'];
const CARRIER_OPERATIONS = ['Interstate','Intrastate Only (HM)','Intrastate Only (Non-HM)'];
const CARGO_TYPES = ['General Freight','Household Goods','Metal: Sheets, Coils, Rolls','Motor Vehicles','Drive/Tow Away','Logs, Poles, Beams, Lumber','Building Materials','Mobile Homes','Machinery, Large Objects','Fresh Produce','Liquids/Gases','Intermodal Cont.','Passengers','Oilfield Equipment','Livestock','Grain, Feed, Hay','Coal/Coke','Meat','Garbage/Refuse','US Mail','Chemicals','Commodities Dry Bulk','Refrigerated Food','Beverages','Paper Products','Utilities','Agricultural/Farm Supplies','Construction','Water Well','Other'];
const INSURANCE_REQUIRED_TYPES = ['BI&PD','CARGO','BOND'];

const calculateYearsInBusiness = (mcs150Date: string | undefined): number | null => {
  if (!mcs150Date || mcs150Date === 'N/A') return null;
  try {
    const date = new Date(mcs150Date);
    if (isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    const ageDate = new Date(diffMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  } catch (e) { return null; }
};

const MultiSelect: React.FC<{ options: string[]; selected: string[]; onChange: (vals: string[]) => void; placeholder?: string; }> = ({ options, selected, onChange, placeholder = 'All' }) => {
  const [open, setOpen] = useState(false);
  const toggle = (val: string) => onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none flex items-center justify-between">
        <span className={selected.length === 0 ? 'text-slate-500' : 'text-white truncate'}>{selected.length === 0 ? placeholder : selected.join(', ')}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-sm text-slate-300">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-indigo-500" />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const FilterGroup: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-xs font-black text-indigo-400 uppercase tracking-widest">{icon} {title}</span>
        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};

const FilterLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => ( <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 ml-1">{children}</label> );

const FilterSelect: React.FC<{ name: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: { value: string; label: string }[] }> = ({ name, value, onChange, options }) => (
  <select name={name} value={value} onChange={onChange} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none">
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const MinMaxInputs: React.FC<{ nameMin: string; nameMax: string; valueMin: string; valueMax: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; }> = ({ nameMin, nameMax, valueMin, valueMax, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    <input type="number" name={nameMin} value={valueMin} onChange={onChange} placeholder="Min" min={0} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
    <input type="number" name={nameMax} value={valueMax} onChange={onChange} placeholder="Max" min={0} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
  </div>
);

export const CarrierSearch: React.FC<CarrierSearchProps> = ({ carriers, onSearch, isLoading, onNavigateToInsurance }) => {
  const [mcSearchTerm, setMcSearchTerm] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [selectedDot, setSelectedDot] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'inspections' | 'crashes'>('inspections');
  const [expandedInspection, setExpandedInspection] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    active: '', state: [] as string[], dot: '', yearsInBusinessMin: '', yearsInBusinessMax: '',
    hasEmail: '', hasBoc3: '', hasCompanyRep: '', classification: [] as string[], carrierOperation: [] as string[],
    hazmat: '', powerUnitsMin: '', powerUnitsMax: '', driversMin: '', driversMax: '', cargo: [] as string[],
    insuranceRequired: [] as string[], bipdMin: '', bipdMax: '', bipdOnFile: '', cargoOnFile: '', bondOnFile: '',
    oosMin: '', oosMax: '', crashesMin: '', crashesMax: '', injuriesMin: '', injuriesMax: '',
    fatalitiesMin: '', fatalitiesMax: '', towawayMin: '', towawayMax: '', inspectionsMin: '', inspectionsMax: '',
  });

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const buildFilters = (): CarrierFilters => {
    const f: CarrierFilters = {};
    if (mcSearchTerm.trim()) f.mcNumber = mcSearchTerm.trim();
    if (nameSearchTerm.trim()) f.legalName = nameSearchTerm.trim();
    if (filters.dot.trim()) f.dotNumber = filters.dot.trim();
    if (filters.active) f.active = filters.active;
    if (filters.state.length > 0) f.state = filters.state.join('|'); 
    
    // SAFETY & NUMERIC LOGIC FIX: use !== '' to ensure '0' is passed to the search engine
    const numFields = [
      'yearsInBusinessMin', 'yearsInBusinessMax', 'powerUnitsMin', 'powerUnitsMax', 
      'driversMin', 'driversMax', 'bipdMin', 'bipdMax', 'oosMin', 'oosMax', 
      'crashesMin', 'crashesMax', 'injuriesMin', 'injuriesMax', 'fatalitiesMin', 
      'fatalitiesMax', 'towawayMin', 'towawayMax', 'inspectionsMin', 'inspectionsMax'
    ];
    
    numFields.forEach(field => {
      if (filters[field as keyof typeof filters] !== '') {
        f[field as keyof CarrierFilters] = parseInt(filters[field as keyof typeof filters] as string) as any;
      }
    });

    if (filters.hasEmail) f.hasEmail = filters.hasEmail;
    if (filters.hasBoc3) f.hasBoc3 = filters.hasBoc3;
    if (filters.hasCompanyRep) f.hasCompanyRep = filters.hasCompanyRep;
    if (filters.classification.length > 0) f.classification = filters.classification;
    if (filters.carrierOperation.length > 0) f.carrierOperation = filters.carrierOperation;
    if (filters.hazmat) f.hazmat = filters.hazmat;
    if (filters.cargo.length > 0) f.cargo = filters.cargo;
    if (filters.insuranceRequired.length > 0) f.insuranceRequired = filters.insuranceRequired;
    if (filters.bipdOnFile) f.bipdOnFile = filters.bipdOnFile;
    if (filters.cargoOnFile) f.cargoOnFile = filters.cargoOnFile;
    if (filters.bondOnFile) f.bondOnFile = filters.bondOnFile;
    
    return f;
  };

  const applyFilters = () => onSearch(buildFilters());
  const resetAll = () => {
    setMcSearchTerm(''); setNameSearchTerm('');
    setFilters({
      active: '', state: [], dot: '', yearsInBusinessMin: '', yearsInBusinessMax: '', hasEmail: '', hasBoc3: '', hasCompanyRep: '',
      classification: [], carrierOperation: [], hazmat: '', powerUnitsMin: '', powerUnitsMax: '', driversMin: '', driversMax: '',
      cargo: [], insuranceRequired: [], bipdMin: '', bipdMax: '', bipdOnFile: '', cargoOnFile: '', bondOnFile: '',
      oosMin: '', oosMax: '', crashesMin: '', crashesMax: '', injuriesMin: '', injuriesMax: '', fatalitiesMin: '', fatalitiesMax: '',
      towawayMin: '', towawayMax: '', inspectionsMin: '', inspectionsMax: '',
    });
    onSearch({});
  };

  const selectedCarrier = selectedDot ? carriers.find(c => c.dotNumber === selectedDot) : null;
  const yesNoOptions = [{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
  const yesNoNumOptions = [{ value: '', label: 'Any' }, { value: '1', label: 'Yes' }, { value: '0', label: 'No' }];

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col overflow-hidden relative selection:bg-indigo-500/30">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-1 tracking-tight">Carrier Database</h1>
          <p className="text-slate-400 text-sm">Showing <span className="text-indigo-400 font-bold">{carriers.length}</span> records</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button onClick={onNavigateToInsurance} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg active:scale-95"><ShieldAlert size={16} /> Batch Enrichment Pipeline</button>
          <button onClick={() => downloadCSV(carriers)} disabled={carriers.length === 0} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all border border-slate-700 active:scale-95"><Download size={16} /> Export CSV</button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative group w-52 shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400"><Hash size={16} /></div>
          <input type="text" placeholder="Search MC#..." className="w-full bg-slate-850/80 border border-slate-700/50 rounded-2xl pl-9 pr-3 py-3 text-white text-sm focus:border-indigo-500 outline-none" value={mcSearchTerm} onChange={(e) => setMcSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        </div>
        <div className="flex-1 relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400"><Search size={18} /></div>
          <input type="text" placeholder="Search by Business Name..." className="w-full bg-slate-850/80 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-white text-sm focus:border-indigo-500 outline-none" value={nameSearchTerm} onChange={(e) => setNameSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className={`px-5 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 border text-sm ${showFilters ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}><Zap size={16} />{showFilters ? 'Hide Filters' : 'Advanced Filters'}</button>
        <button onClick={applyFilters} disabled={isLoading} className="px-7 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-lg flex items-center gap-2 text-sm">{isLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}</button>
      </div>

      {showFilters && (
        <div className="mb-4 p-4 bg-slate-950/80 border border-slate-700/50 rounded-3xl overflow-y-auto max-h-[55vh] custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <FilterGroup title="Motor Carrier" icon={<Truck size={12} />}>
              <div><FilterLabel>Active</FilterLabel><FilterSelect name="active" value={filters.active} onChange={handleFilterChange} options={yesNoOptions} /></div>
              <div><FilterLabel>State</FilterLabel><MultiSelect options={US_STATES} selected={filters.state} onChange={v => setFilters(p => ({ ...p, state: v }))} /></div>
              <div><FilterLabel>DOT Number</FilterLabel><input type="number" name="dot" value={filters.dot} onChange={handleFilterChange} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white" /></div>
              <div><FilterLabel>Years in Business</FilterLabel><MinMaxInputs nameMin="yearsInBusinessMin" nameMax="yearsInBusinessMax" valueMin={filters.yearsInBusinessMin} valueMax={filters.yearsInBusinessMax} onChange={handleFilterChange} /></div>
            </FilterGroup>
            <FilterGroup title="Carrier Operation" icon={<Activity size={12} />}>
              <div><FilterLabel>Classification</FilterLabel><MultiSelect options={OPERATION_CLASSIFICATIONS} selected={filters.classification} onChange={v => setFilters(p => ({ ...p, classification: v }))} /></div>
              <div><FilterLabel>Power Units</FilterLabel><MinMaxInputs nameMin="powerUnitsMin" nameMax="powerUnitsMax" valueMin={filters.powerUnitsMin} valueMax={filters.powerUnitsMax} onChange={handleFilterChange} /></div>
              <div><FilterLabel>Drivers</FilterLabel><MinMaxInputs nameMin="driversMin" nameMax="driversMax" valueMin={filters.driversMin} valueMax={filters.driversMax} onChange={handleFilterChange} /></div>
            </FilterGroup>
            <FilterGroup title="Insurance Policy" icon={<Shield size={12} />}>
              <div><FilterLabel>Required BIPD</FilterLabel><MinMaxInputs nameMin="bipdMin" nameMax="bipdMax" valueMin={filters.bipdMin} valueMax={filters.bipdMax} onChange={handleFilterChange} /></div>
              <div><FilterLabel>Has Cargo Insurance</FilterLabel><FilterSelect name="cargoOnFile" value={filters.cargoOnFile} onChange={handleFilterChange} options={yesNoNumOptions} /></div>
            </FilterGroup>
            <FilterGroup title="Safety" icon={<ShieldCheck size={12} />}>
              <div><FilterLabel>OOS Violations</FilterLabel><MinMaxInputs nameMin="oosMin" nameMax="oosMax" valueMin={filters.oosMin} valueMax={filters.oosMax} onChange={handleFilterChange} /></div>
              <div><FilterLabel>Crashes</FilterLabel><MinMaxInputs nameMin="crashesMin" nameMax="crashesMax" valueMin={filters.crashesMin} valueMax={filters.crashesMax} onChange={handleFilterChange} /></div>
              <div><FilterLabel>Inspections</FilterLabel><MinMaxInputs nameMin="inspectionsMin" nameMax="inspectionsMax" valueMin={filters.inspectionsMin} valueMax={filters.inspectionsMax} onChange={handleFilterChange} /></div>
            </FilterGroup>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-slate-800">
            <button onClick={resetAll} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-bold border border-slate-700">Reset All</button>
            <button onClick={applyFilters} className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold shadow-lg">Apply Filters</button>
          </div>
        </div>
      )}

      <div className="flex-1 bg-slate-900/40 border border-slate-700/50 rounded-3xl overflow-hidden flex flex-col shadow-inner min-h-0">
        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/90 sticky top-0 z-10 border-b border-slate-800">
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
                  <td className="p-4 font-bold text-white group-hover:text-indigo-200 truncate max-w-[250px]">{carrier.legalName}</td>
                  <td className="p-4 font-mono text-slate-400">{carrier.dotNumber}</td>
                  <td className="p-4">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-black border ${carrier.status?.includes('AUTHORIZED') && !carrier.status?.includes('NOT') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                      {carrier.status?.includes('AUTHORIZED') && !carrier.status?.includes('NOT') ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="p-4 text-right"><button className="p-2 bg-slate-800 hover:bg-indigo-600 text-slate-300 rounded-xl transition-all"><Eye size={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCarrier && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-slate-700/50 w-full max-w-7xl max-h-[95vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col relative">

            {/* HEADER: Height reduced by ~30% and Badges updated to Emerald Green */}
            <div className="p-4 md:p-5 border-b border-slate-800 bg-slate-850/30 flex justify-between items-start">
              <div className="flex gap-4 md:gap-6 items-center">
                <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-500/10">
                  <Truck size={22} className="md:w-8 md:h-8" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-1">
                    <h2 className="text-lg md:text-2xl font-black text-white uppercase tracking-tighter truncate max-w-[300px] md:max-w-[700px] leading-tight">{selectedCarrier.legalName}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border-2 ${selectedCarrier.status?.includes('NOT AUTHORIZED') ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30'}`}>
                      {selectedCarrier.status?.includes('NOT AUTHORIZED') ? 'Unauthorized' : 'Active Authority'}
                    </span>
                  </div>
                  
                  {/* EMERALD BADGE ROW */}
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => handleCopy(selectedCarrier.dotNumber, 'dot')} className="bg-[#10B981] hover:bg-[#059669] text-white rounded-lg px-3 py-1.5 flex items-center gap-2 transition-all active:scale-95 shadow-md">
                      <span className="font-black text-[10px] md:text-xs tracking-wide uppercase">DOT {selectedCarrier.dotNumber}</span>
                      {copiedField === 'dot' ? <Check size={12} className="text-white" /> : <Copy size={12} className="text-white/60" />}
                    </button>
                    <button onClick={() => handleCopy(selectedCarrier.mcNumber || '', 'mc')} className="bg-[#10B981] hover:bg-[#059669] text-white rounded-lg px-3 py-1.5 flex items-center gap-2 transition-all active:scale-95 shadow-md">
                      <span className="font-black text-[10px] md:text-xs tracking-wide uppercase">MC {selectedCarrier.mcNumber}</span>
                      {copiedField === 'mc' ? <Check size={12} className="text-white" /> : <Copy size={12} className="text-white/60" />}
                    </button>
                    <div className="bg-[#10B981] text-white rounded-lg px-3 py-1.5 shadow-md">
                      <span className="font-black text-[10px] md:text-xs uppercase tracking-wide">
                        {selectedCarrier.operationClassification?.some(c => c.toLowerCase().includes('broker')) ? 'Entity: Broker' : 'Entity: Carrier'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedDot(null)} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-slate-900/40">
              {/* OPERATION AND SAFETY DATA GRID (NO UI CHANGE) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4 group">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-1 group-hover:text-indigo-400 transition-colors"><Hash size={14} className="text-indigo-400" /> Identification</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">MC/MX Number</span><span className="text-base font-black text-indigo-400 font-mono">{selectedCarrier.mcNumber}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">USDOT Number</span><span className="text-base font-black text-white font-mono">{selectedCarrier.dotNumber}</span></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4 group">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-1 group-hover:text-indigo-400 transition-colors"><Phone size={14} className="text-indigo-400" /> Contact Info</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3"><Phone size={16} className="text-indigo-400" /><div><span className="text-[9px] text-slate-500 font-black uppercase">Phone</span><span className="text-base font-black text-white block">{selectedCarrier.phone || 'N/A'}</span></div></div>
                    <div className="flex items-center gap-3"><Mail size={16} className="text-indigo-400" /><div><span className="text-[9px] text-slate-500 font-black uppercase">Email</span><span className="text-sm font-black text-indigo-300 block">{selectedCarrier.email || 'None Registered'}</span></div></div>
                  </div>
                </div>
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4 group">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-1 group-hover:text-indigo-400 transition-colors"><Calendar size={14} className="text-indigo-400" /> Compliance</h3>
                  <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800"><span className="text-[9px] text-slate-500 font-black uppercase block">MCS-150 Form Date</span><span className="text-base font-black text-white">{selectedCarrier.mcs150Date || 'N/A'}</span></div>
                </div>
              </div>
            </div>

            {/* FOOTER: Height reduced, Download Intel removed */}
            <div className="p-4 md:p-5 bg-slate-950/85 border-t border-slate-800 flex justify-end items-center">
              <button onClick={() => setSelectedDot(null)} className="px-8 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold border border-slate-700 active:scale-95 transition-all">Close View</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
