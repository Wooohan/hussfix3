import React, { useState } from 'react';
import { Search, Eye, X, MapPin, Phone, Mail, Hash, Truck, Calendar, ShieldCheck, Download, ShieldAlert, Activity, Info, Globe, Map as MapIcon, Boxes, Shield, ExternalLink, CheckCircle2, AlertTriangle, Zap, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
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

const OPERATION_CLASSIFICATIONS = [
  'Auth. For Hire','Exempt For Hire','Private(Property)',
  'Private(Passenger)','Migrant','U.S. Mail','Federal Government',
  'State Government','Local Government','Indian Tribe'
];

const CARRIER_OPERATIONS = [
  'Interstate','Intrastate Only (HM)','Intrastate Only (Non-HM)'
];

const CARGO_TYPES = [
  'General Freight','Household Goods','Metal: Sheets, Coils, Rolls',
  'Motor Vehicles','Drive/Tow Away','Logs, Poles, Beams, Lumber',
  'Building Materials','Mobile Homes','Machinery, Large Objects',
  'Fresh Produce','Liquids/Gases','Intermodal Cont.',
  'Passengers','Oilfield Equipment','Livestock',
  'Grain, Feed, Hay','Coal/Coke','Meat',
  'Garbage/Refuse','US Mail','Chemicals',
  'Commodities Dry Bulk','Refrigerated Food','Beverages',
  'Paper Products','Utilities','Agricultural/Farm Supplies',
  'Construction','Water Well','Other'
];

const INSURANCE_REQUIRED_TYPES = ['BI&PD','CARGO','BOND'];

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

const MultiSelect: React.FC<{
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}> = ({ options, selected, onChange, placeholder = 'All' }) => {
  const [open, setOpen] = useState(false);
  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 flex items-center justify-between"
      >
        <span className={selected.length === 0 ? 'text-slate-500' : 'text-white truncate'}>
          {selected.length === 0 ? placeholder : selected.join(', ')}
        </span>
        {open ? <ChevronUp size={14} className="shrink-0 ml-1" /> : <ChevronDown size={14} className="shrink-0 ml-1" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 cursor-pointer text-sm text-slate-300">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="accent-indigo-500"
              />
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
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-black text-indigo-400 uppercase tracking-widest">
          {icon} {title}
        </span>
        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};

const FilterLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 ml-1">{children}</label>
);

const FilterSelect: React.FC<{ name: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: { value: string; label: string }[] }> = ({ name, value, onChange, options }) => (
  <select name={name} value={value} onChange={onChange} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const MinMaxInputs: React.FC<{
  nameMin: string; nameMax: string;
  valueMin: string; valueMax: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ nameMin, nameMax, valueMin, valueMax, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    <input type="number" name={nameMin} value={valueMin} onChange={onChange} placeholder="Min" min={0}
      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
    <input type="number" name={nameMax} value={valueMax} onChange={onChange} placeholder="Max" min={0}
      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
  </div>
);

export const CarrierSearch: React.FC<CarrierSearchProps> = ({ carriers, onSearch, isLoading, onNavigateToInsurance }) => {
  const [mcSearchTerm, setMcSearchTerm] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [selectedDot, setSelectedDot] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedInspectionId, setExpandedInspectionId] = useState<number | null>(null);
  const [selectedViolationDetail, setSelectedViolationDetail] = useState<any>(null);

  const [filters, setFilters] = useState({
    active: '',
    state: [] as string[],
    dot: '',
    yearsInBusinessMin: '',
    yearsInBusinessMax: '',
    hasEmail: '',
    hasBoc3: '',
    hasCompanyRep: '',
    classification: [] as string[],
    carrierOperation: [] as string[],
    hazmat: '',
    powerUnitsMin: '',
    powerUnitsMax: '',
    driversMin: '',
    driversMax: '',
    cargo: [] as string[],
    insuranceRequired: [] as string[],
    bipdMin: '',
    bipdMax: '',
    bipdOnFile: '',
    cargoOnFile: '',
    bondOnFile: '',
    oosMin: '', oosMax: '',
    crashesMin: '', crashesMax: '',
    injuriesMin: '', injuriesMax: '',
    fatalitiesMin: '', fatalitiesMax: '',
    towawayMin: '', towawayMax: '',
    inspectionsMin: '', inspectionsMax: '',
  });

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
    if (filters.hasEmail) f.hasEmail = filters.hasEmail;
    if (filters.hasBoc3) f.hasBoc3 = filters.hasBoc3;
    if (filters.hasCompanyRep) f.hasCompanyRep = filters.hasCompanyRep;
    if (filters.yearsInBusinessMin) f.yearsInBusinessMin = parseInt(filters.yearsInBusinessMin);
    if (filters.yearsInBusinessMax) f.yearsInBusinessMax = parseInt(filters.yearsInBusinessMax);
    if (filters.classification.length > 0) f.classification = filters.classification;
    if (filters.carrierOperation.length > 0) f.carrierOperation = filters.carrierOperation;
    if (filters.hazmat) f.hazmat = filters.hazmat;
    if (filters.powerUnitsMin) f.powerUnitsMin = parseInt(filters.powerUnitsMin);
    if (filters.powerUnitsMax) f.powerUnitsMax = parseInt(filters.powerUnitsMax);
    if (filters.driversMin) f.driversMin = parseInt(filters.driversMin);
    if (filters.driversMax) f.driversMax = parseInt(filters.driversMax);
    if (filters.cargo.length > 0) f.cargo = filters.cargo;
    if (filters.insuranceRequired.length > 0) f.insuranceRequired = filters.insuranceRequired;
    if (filters.bipdMin) f.bipdMin = parseInt(filters.bipdMin);
    if (filters.bipdMax) f.bipdMax = parseInt(filters.bipdMax);
    if (filters.bipdOnFile) f.bipdOnFile = filters.bipdOnFile;
    if (filters.cargoOnFile) f.cargoOnFile = filters.cargoOnFile;
    if (filters.bondOnFile) f.bondOnFile = filters.bondOnFile;
    if (filters.oosMin) f.oosMin = parseInt(filters.oosMin);
    if (filters.oosMax) f.oosMax = parseInt(filters.oosMax);
    if (filters.crashesMin) f.crashesMin = parseInt(filters.crashesMin);
    if (filters.crashesMax) f.crashesMax = parseInt(filters.crashesMax);
    if (filters.injuriesMin) f.injuriesMin = parseInt(filters.injuriesMin);
    if (filters.injuriesMax) f.injuriesMax = parseInt(filters.injuriesMax);
    if (filters.fatalitiesMin) f.fatalitiesMin = parseInt(filters.fatalitiesMin);
    if (filters.fatalitiesMax) f.fatalitiesMax = parseInt(filters.fatalitiesMax);
    if (filters.towawayMin) f.towawayMin = parseInt(filters.towawayMin);
    if (filters.towawayMax) f.towawayMax = parseInt(filters.towawayMax);
    if (filters.inspectionsMin) f.inspectionsMin = parseInt(filters.inspectionsMin);
    if (filters.inspectionsMax) f.inspectionsMax = parseInt(filters.inspectionsMax);
    return f;
  };

  const applyFilters = () => {
    onSearch(buildFilters());
  };

  const resetAll = () => {
    setMcSearchTerm('');
    setNameSearchTerm('');
    setFilters({
      active: '', state: [], dot: '', yearsInBusinessMin: '', yearsInBusinessMax: '',
      hasEmail: '', hasBoc3: '', hasCompanyRep: '',
      classification: [], carrierOperation: [], hazmat: ''
    } as any);
  };

  const selectedCarrier = selectedDot ? carriers.find(c => c.dotNumber === selectedDot) : null;

  return (
    <div className="w-full">
      {/* Search and Filter Section */}
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-800 p-6 md:p-8 sticky top-0 z-40 shadow-2xl">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase">Search by MC or Name</label>
              <div className="flex gap-2">
                <input type="text" value={mcSearchTerm} onChange={(e) => setMcSearchTerm(e.target.value)} placeholder="MC/MX Number..." className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
                <input type="text" value={nameSearchTerm} onChange={(e) => setNameSearchTerm(e.target.value)} placeholder="Company Name..." className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
              </div>
            </div>
            <div className="flex gap-2 items-end">
              <button onClick={applyFilters} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-6 py-3 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-indigo-600/20">
                <Search size={18} /> Search
              </button>
              <button onClick={() => setShowFilters(!showFilters)} className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl border border-slate-700 transition-all">
                <ChevronDown size={18} />
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <FilterGroup title="Status" icon={<CheckCircle2 size={14} />}>
                <FilterSelect name="active" value={filters.active} onChange={handleFilterChange} options={[{ value: '', label: 'All' }, { value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />
              </FilterGroup>
              <FilterGroup title="Location" icon={<MapIcon size={14} />}>
                <MultiSelect options={US_STATES} selected={filters.state} onChange={(state) => setFilters(prev => ({ ...prev, state }))} />
              </FilterGroup>
              <FilterGroup title="Fleet" icon={<Truck size={14} />}>
                <FilterLabel>Power Units</FilterLabel>
                <MinMaxInputs nameMin="powerUnitsMin" nameMax="powerUnitsMax" valueMin={filters.powerUnitsMin} valueMax={filters.powerUnitsMax} onChange={handleFilterChange} />
              </FilterGroup>
              <FilterGroup title="Safety" icon={<Shield size={14} />}>
                <FilterLabel>OOS Violations</FilterLabel>
                <MinMaxInputs nameMin="oosMin" nameMax="oosMax" valueMin={filters.oosMin} valueMax={filters.oosMax} onChange={handleFilterChange} />
              </FilterGroup>
            </div>
          )}

          <button onClick={resetAll} className="text-xs font-bold text-slate-500 hover:text-slate-300 uppercase tracking-widest">Reset All Filters</button>
        </div>
      </div>

      {/* Results Table */}
      <div className="p-6 md:p-8 bg-slate-950">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={32} className="text-indigo-400 animate-spin" /></div>
          ) : carriers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 text-center">
              <Search size={48} className="opacity-20 mb-4" />
              <p className="text-sm font-bold uppercase tracking-widest">No Results Found</p>
              <p className="text-xs text-slate-500 mt-2">Try adjusting your search criteria</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800 shadow-2xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 border-b border-slate-800">
                  <tr>
                    <th className="p-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest">Company Name</th>
                    <th className="p-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest">MC/MX</th>
                    <th className="p-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest">DOT</th>
                    <th className="p-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="p-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest">Location</th>
                    <th className="p-4 text-right text-xs font-black text-slate-400 uppercase tracking-widest">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {carriers.map((carrier, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/50 transition-colors">
                      <td className="p-4"><span className="font-bold text-white">{carrier.legalName}</span></td>
                      <td className="p-4"><span className="font-mono text-indigo-400">{carrier.mcNumber}</span></td>
                      <td className="p-4"><span className="font-mono text-slate-300">{carrier.dotNumber}</span></td>
                      <td className="p-4"><span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${carrier.status?.includes('NOT AUTHORIZED') ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>{carrier.status?.includes('NOT AUTHORIZED') ? 'Unauthorized' : 'Active'}</span></td>
                      <td className="p-4 text-slate-400">{carrier.physicalAddress?.split(',')[0]}</td>
                      <td className="p-4 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedDot(carrier.dotNumber); }}
                          className="p-2 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-xl transition-all shadow-lg active:scale-95"
                        >
                          <Eye size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>

      {selectedCarrier && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-slate-900 border-2 border-slate-700/50 w-full max-w-7xl max-h-[95vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in slide-in-from-bottom-4 duration-300">

            <div className="p-6 md:p-8 border-b border-slate-800 bg-slate-850/30 flex justify-between items-center">
              <div className="flex gap-4 md:gap-8 items-center">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-500/10">
                  <Truck size={24} className="md:w-10 md:h-10" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-4 mb-1">
                    <h2 className="text-xl md:text-3xl font-black text-white uppercase tracking-tighter truncate max-w-[300px] md:max-w-[700px] leading-tight">{selectedCarrier.legalName}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border-2 ${selectedCarrier.status?.includes('NOT AUTHORIZED') ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30'}`}>
                      {selectedCarrier.status?.includes('NOT AUTHORIZED') ? 'Unauthorized' : 'Active Authority'}
                    </span>
                  </div>
                  <p className="text-sm md:text-base text-slate-400 font-medium italic opacity-60">{selectedCarrier.dbaName || 'No Registered DBA'}</p>
                </div>
              </div>
              <button onClick={() => setSelectedDot(null)} className="p-3 text-slate-500 hover:text-white hover:bg-slate-800 rounded-2xl transition-all active:scale-75">
                <X size={28} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-slate-900/40">

              {/* FIRST TOP: Identification | Contact Info | Compliance (3 Cols) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4 shadow-lg group">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-1 group-hover:text-indigo-400 transition-colors">
                    <Hash size={14} className="text-indigo-400" /> Identification
                  </h3>
                  <div className="space-y-3">
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">MC/MX Number</span><span className="text-base font-black text-indigo-400 font-mono tracking-tight">{selectedCarrier.mcNumber}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">USDOT Number</span><span className="text-base font-black text-white font-mono tracking-tight">{selectedCarrier.dotNumber}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">DUNS Number</span><span className="text-sm font-bold text-slate-400">{selectedCarrier.dunsNumber || '--'}</span></div>
                  </div>
                </div>

                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4 shadow-lg group">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-1 group-hover:text-indigo-400 transition-colors">
                    <Phone size={14} className="text-indigo-400" /> Contact Info
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Phone size={16} className="text-indigo-400 shrink-0" />
                      <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">Phone</span><span className="text-base font-black text-white">{selectedCarrier.phone || 'N/A'}</span></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Mail size={16} className="text-indigo-400 shrink-0" />
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[9px] text-slate-500 font-black uppercase">Email</span>
                        <span className="text-sm font-black text-indigo-300 truncate">{selectedCarrier.email || 'None Registered'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <MapPin size={16} className="text-indigo-400 shrink-0" />
                      <div className="flex flex-col"><span className="text-[9px] text-slate-500 font-black uppercase">Location</span><span className="text-xs font-bold text-slate-300 leading-tight">{selectedCarrier.physicalAddress}</span></div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-850/60 p-6 rounded-3xl border border-slate-700/50 space-y-4 shadow-lg group">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-1 group-hover:text-indigo-400 transition-colors">
                    <Calendar size={14} className="text-indigo-400" /> Compliance
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800 shadow-inner">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[9px] text-slate-500 font-black uppercase">MCS-150 Form Date</span>
                        {calculateYearsInBusiness(selectedCarrier.mcs150Date) !== null && (
                          <span className="text-[10px] font-black text-emerald-400 uppercase tracking-tighter">
                            {calculateYearsInBusiness(selectedCarrier.mcs150Date)} Years in Business
                          </span>
                        )}
                      </div>
                      <span className="text-base font-black text-white">{selectedCarrier.mcs150Date || 'N/A'}</span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800 shadow-inner">
                      <span className="text-[9px] text-slate-500 font-black uppercase block mb-1">Mileage / VMT</span>
                      <span className="text-sm font-bold text-slate-300">{selectedCarrier.mcs150Mileage || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECOND ROW: Operation Information | Verified L&I Filings (2 Cols) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col gap-6 shadow-2xl">
                  <div className="flex items-center gap-3">
                    <Truck size={20} className="text-indigo-400" />
                    <h4 className="text-xl font-black text-white uppercase tracking-tight">Operation Information</h4>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Classifications</h5>
                      <p className="text-sm font-bold text-slate-200 bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                        {selectedCarrier.operationClassification?.join(', ') || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Operating Territory</h5>
                      <div className="flex flex-wrap gap-2">
                        {selectedCarrier.carrierOperation?.map((op, idx) => (
                          <span key={idx} className="bg-indigo-500/10 text-indigo-300 px-3 py-1 rounded-lg border border-indigo-500/20 font-bold text-[10px] uppercase">{op}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Cargo Carried</h5>
                      <div className="grid grid-cols-1 gap-2">
                        {selectedCarrier.cargoCarried?.map((cargo, idx) => (
                          <div key={idx} className="bg-slate-900/50 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                            <Truck size={14} className="text-slate-600" />
                            <span className="text-xs font-bold text-slate-300">{cargo}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className={`w-full py-4 rounded-2xl flex items-center justify-center font-black tracking-widest text-xs border-2 ${selectedCarrier.cargoCarried?.some(c => c.toLowerCase().includes('haz')) ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                      {selectedCarrier.cargoCarried?.some(c => c.toLowerCase().includes('haz')) ? 'HAZMAT INDICATOR: YES' : 'HAZMAT INDICATOR: NON-HAZMAT'}
                    </div>
                    <div className="h-px bg-slate-800/50 my-2" />
                    <div>
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Fleet Information</h5>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-xl flex flex-col items-center">
                          <span className="text-[9px] text-slate-500 font-black uppercase mb-1">Power Units</span>
                          <span className="text-lg font-black text-white">{selectedCarrier.powerUnits || '0'}</span>
                        </div>
                        <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-xl flex flex-col items-center">
                          <span className="text-[9px] text-slate-500 font-black uppercase mb-1">Drivers</span>
                          <span className="text-lg font-black text-white">{selectedCarrier.drivers || '0'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col shadow-2xl">
                  <div className="flex items-center gap-3 mb-8">
                    <ShieldCheck size={20} className="text-emerald-400" />
                    <h4 className="text-xl font-black text-white uppercase tracking-tight">Verified L&I Filings</h4>
                  </div>
                  <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
                    {selectedCarrier.insurancePolicies && selectedCarrier.insurancePolicies.length > 0 ? (
                      selectedCarrier.insurancePolicies.map((p: any, i: number) => (
                        <div key={i} className="bg-slate-900 p-6 rounded-[1.5rem] border border-slate-800 shadow-sm group/policy hover:border-indigo-500/30 transition-all">
                          <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{p.type || 'Insurance'}</span>
                            <span className="text-[10px] font-bold text-emerald-400 uppercase">{p.status || 'Active'}</span>
                          </div>
                          <p className="text-sm font-black text-slate-200 mb-4 truncate leading-tight group-hover/policy:text-indigo-300 transition-colors uppercase">{p.carrier}</p>
                          <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono pt-4 border-t border-slate-800/50">
                            <span className="bg-slate-850 px-2 py-1 rounded">#{p.policyNumber}</span>
                            <span className="bg-slate-850 px-2 py-1 rounded">EFF: {p.effectiveDate}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-700 text-center">
                        <Info size={48} className="opacity-10 mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">No Filings Extracted</p>
                        <p className="text-[10px] text-slate-600 max-w-[180px] leading-relaxed italic">Intelligence enrichment required for insurance verification.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* THIRD ROW: Safety Information | Inspections & Crashes (2 Cols, 50/50) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col gap-6 shadow-2xl relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ShieldCheck size={20} className="text-indigo-400" />
                      <h4 className="text-xl font-black text-white uppercase tracking-tight">Safety Information</h4>
                    </div>
                    <a href={`https://ai.fmcsa.dot.gov/SMS/Carrier/${selectedCarrier.dotNumber}/CompleteProfile.aspx`} target="_blank" className="text-[10px] font-bold text-indigo-400 flex items-center gap-1 hover:text-white transition-colors">
                      <ExternalLink size={12} /> View FMCSA Source
                    </a>
                  </div>
                  {selectedCarrier.safetyRating && selectedCarrier.safetyRating !== 'N/A' ? (
                    <div className="space-y-8 animate-in fade-in duration-500">
                      <div className="flex justify-between items-start">
                        <div className="space-y-4">
                          <h5 className="text-xs font-bold text-slate-100">Safety Rating</h5>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                              <CheckCircle2 size={24} />
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-200 leading-tight uppercase">{selectedCarrier.safetyRating}</p>
                              <p className="text-[11px] text-slate-500 font-medium font-mono">ENRICHED: {selectedCarrier.safetyRatingDate}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 max-w-[180px] space-y-4">
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-slate-100">OOS Rates</h5>
                            <p className="text-[9px] text-slate-500 font-mono tracking-tighter uppercase">Last 24 Months Activity</p>
                          </div>
                          {selectedCarrier.oosRates?.map((oos, idx) => (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between text-[10px] font-black uppercase">
                                <span className="text-slate-500 truncate mr-2">{oos.type}</span>
                                <span className="text-emerald-400">{oos.rate}</span>
                              </div>
                              <div className="w-full bg-slate-800/50 rounded-full h-1 relative overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" style={{ width: `${parseFloat(oos.rate) || 0}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="h-px bg-slate-800/50" />
                      <div className="space-y-4">
                        <h5 className="text-xs font-black text-slate-100 uppercase tracking-widest opacity-80">BASIC Performance</h5>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                          {selectedCarrier.basicScores?.map((score, idx) => (
                            <div key={idx} className="flex justify-between items-center text-xs">
                              <span className="text-slate-500 truncate max-w-[120px]">{score.category}</span>
                              <span className="text-slate-300 font-bold font-mono">{score.measure}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-700 text-center space-y-4">
                      <div className="p-6 bg-slate-800/30 rounded-full"><ShieldAlert size={48} className="opacity-20 text-indigo-500" /></div>
                      <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Record Not Enriched</p>
                      <button onClick={() => { setSelectedDot(null); onNavigateToInsurance(); }} className="text-[10px] font-black text-indigo-400 hover:text-white uppercase transition-colors bg-indigo-500/5 px-4 py-2 rounded-lg border border-indigo-500/10">Launch Pipeline now</button>
                    </div>
                  )}
                </div>

                {/* NEW: Inspections & Crashes Section with Emerald Theme */}
                <div className="bg-slate-850/40 p-8 rounded-[2rem] border border-slate-800 flex flex-col shadow-2xl">
                  <div className="flex items-center gap-3 mb-6">
                    <Activity size={20} className="text-emerald-400" />
                    <h4 className="text-xl font-black text-white uppercase tracking-tight">Inspections & Crashes</h4>
                  </div>

                  {/* Summary Stats */}
                  {selectedCarrier.inspections && selectedCarrier.inspections.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-6 pb-6 border-b border-slate-700/50">
                      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex flex-col items-center">
                        <span className="text-[9px] text-slate-500 font-black uppercase mb-1">Total</span>
                        <span className="text-lg font-black text-emerald-400">{selectedCarrier.inspections.length}</span>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex flex-col items-center">
                        <span className="text-[9px] text-slate-500 font-black uppercase mb-1">Violations</span>
                        <span className="text-lg font-black text-emerald-400">{selectedCarrier.inspections.reduce((sum, i: any) => sum + (i.oosViolations || 0), 0)}</span>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex flex-col items-center">
                        <span className="text-[9px] text-slate-500 font-black uppercase mb-1">OOS</span>
                        <span className="text-lg font-black text-emerald-400">{selectedCarrier.inspections.filter((i: any) => i.oosViolations > 0).length}</span>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex flex-col items-center">
                        <span className="text-[9px] text-slate-500 font-black uppercase mb-1">Crashes</span>
                        <span className="text-lg font-black text-emerald-400">0</span>
                      </div>
                    </div>
                  )}

                  {/* Inspection List */}
                  <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-2">
                    {selectedCarrier.inspections && selectedCarrier.inspections.length > 0 ? (
                      selectedCarrier.inspections.slice(0, 5).map((insp: any, i: number) => (
                        <div key={i} className="space-y-2">
                          <button
                            onClick={() => setExpandedInspectionId(expandedInspectionId === i ? null : i)}
                            className="w-full text-left bg-slate-900/60 hover:bg-slate-900 p-4 rounded-xl border border-slate-700/50 hover:border-emerald-500/30 transition-all group"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{insp.date}</span>
                                  <span className="text-[10px] font-bold text-slate-400">{insp.location}</span>
                                </div>
                                <p className="text-xs font-bold text-slate-300">Level III - Driver Only</p>
                              </div>
                              <div className="flex items-center gap-2">
                                {insp.oosViolations > 0 && (
                                  <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">{insp.oosViolations} Violations OOS</span>
                                )}
                                <ChevronDown size={16} className={`text-slate-500 transition-transform ${expandedInspectionId === i ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </button>

                          {/* Expanded Violation Details */}
                          {expandedInspectionId === i && insp.violationList && insp.violationList.length > 0 && (
                            <div className="bg-slate-900/40 p-4 rounded-xl border border-emerald-500/20 space-y-3 animate-in slide-in-from-top-2 duration-200">
                              <div className="flex justify-between items-center mb-3">
                                <h5 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Violation Details</h5>
                                <button
                                  onClick={() => setSelectedViolationDetail(insp)}
                                  className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 uppercase bg-emerald-500/10 px-3 py-1 rounded border border-emerald-500/20 transition-colors"
                                >
                                  More Details
                                </button>
                              </div>
                              <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {insp.violationList.map((v: any, idx: number) => (
                                  <div key={idx} className="bg-slate-800/50 p-2 rounded border border-slate-700/50 text-[9px]">
                                    <p className="font-bold text-emerald-300 mb-1">{v.label}</p>
                                    <p className="text-slate-400 line-clamp-2">{v.description}</p>
                                    <p className="text-slate-500 mt-1">Weight: {v.weight}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-700 text-center">
                        <Activity size={48} className="opacity-10 mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">No Inspections Found</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            <div className="p-6 md:p-8 bg-slate-950/70 border-t border-slate-800 flex justify-end gap-4">
              <button onClick={() => setSelectedDot(null)} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold border border-slate-700 active:scale-95 transition-all">Close View</button>
              <button className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-black shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 active:scale-95 transition-all group">
                <Download size={18} className="group-hover:-translate-y-0.5 transition-transform" /> Download Intel Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Violation Detail Modal */}
      {selectedViolationDetail && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-900 border-2 border-emerald-500/30 w-full max-w-2xl max-h-[90vh] rounded-[2rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in duration-300">
            
            <div className="p-6 border-b border-emerald-500/20 bg-gradient-to-r from-slate-900 to-slate-850 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black text-white uppercase tracking-tight mb-1">Inspection Report Details</h3>
                <p className="text-[10px] text-slate-400 font-mono">Report #{selectedViolationDetail.reportNumber}</p>
              </div>
              <button
                onClick={() => setSelectedViolationDetail(null)}
                className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all active:scale-75"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
              
              {/* Report Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-850/60 p-4 rounded-xl border border-emerald-500/20">
                  <span className="text-[9px] text-slate-500 font-black uppercase block mb-2">Report #</span>
                  <span className="text-base font-black text-emerald-400 font-mono">{selectedViolationDetail.reportNumber}</span>
                </div>
                <div className="bg-slate-850/60 p-4 rounded-xl border border-emerald-500/20">
                  <span className="text-[9px] text-slate-500 font-black uppercase block mb-2">Location</span>
                  <span className="text-base font-black text-white">{selectedViolationDetail.location}</span>
                </div>
              </div>

              {/* Violation Counts */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-slate-900/50 p-3 rounded-xl border border-emerald-500/20 flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 font-black uppercase mb-2">OOS</span>
                  <span className="text-xl font-black text-emerald-400">{selectedViolationDetail.oosViolations || 0}</span>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-xl border border-emerald-500/20 flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 font-black uppercase mb-2">Driver</span>
                  <span className="text-xl font-black text-emerald-400">{selectedViolationDetail.driverViolations || 0}</span>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-xl border border-emerald-500/20 flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 font-black uppercase mb-2">Vehicle</span>
                  <span className="text-xl font-black text-emerald-400">{selectedViolationDetail.vehicleViolations || 0}</span>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-xl border border-emerald-500/20 flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 font-black uppercase mb-2">Hazmat</span>
                  <span className="text-xl font-black text-emerald-400">{selectedViolationDetail.hazmatViolations || 0}</span>
                </div>
              </div>

              {/* Violation List */}
              <div>
                <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-4">Full Violation List</h4>
                <div className="space-y-3">
                  {selectedViolationDetail.violationList?.map((v: any, idx: number) => (
                    <div key={idx} className="bg-slate-850/60 p-4 rounded-xl border border-emerald-500/20 space-y-2">
                      <div className="flex items-start justify-between">
                        <h5 className="text-sm font-black text-emerald-400 uppercase">{v.label}</h5>
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-900/50 px-2 py-1 rounded">Weight: {v.weight}</span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed">{v.description}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div className="p-6 bg-slate-950/70 border-t border-emerald-500/20 flex justify-end">
              <button
                onClick={() => setSelectedViolationDetail(null)}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold transition-all active:scale-95"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
