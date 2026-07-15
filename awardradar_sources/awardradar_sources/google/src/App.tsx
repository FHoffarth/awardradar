import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles, Activity, ShieldCheck, ChevronRight, Check, ShieldAlert, Fingerprint, Info, AlertTriangle } from 'lucide-react';

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(dateStr: string): boolean {
  if (!DATE_PARAM_PATTERN.test(dateStr)) return false;
  const date = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Start of today
  return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr) && date >= now;
}

function getTripParam(name: string): string {
  try {
    const value = new URLSearchParams(window.location.search).get(name);
    return value?.trim() ?? '';
  } catch {
    return '';
  }
}

const SearchInstrument = ({ onAnalyze, status, validationError }: { onAnalyze: (origin: string, dest: string, date: string) => void, status: string, validationError: string | null }) => {
  const origin = getTripParam('from');
  const destination = getTripParam('to');
  const dateParam = getTripParam('date');

  const originDisplay = origin || 'Origin';
  const destinationDisplay = destination || 'Destination';
  const dateLabel = dateParam && isValidDateString(dateParam) ? dateParam : 'Date not selected';

  const handleAnalyzeClick = () => {
    onAnalyze(origin, destination, dateParam);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: "easeOut" }}
      className="w-full mb-16 lg:mb-24"
    >
      <div className="text-[9px] tracking-[0.3em] text-zinc-600 uppercase mb-4 ml-1">Decision Workspace</div>

      {validationError && (
        <div className="text-red-400 text-xs mb-3 flex items-center gap-2" data-testid="validation-error">
           <AlertTriangle className="w-3 h-3" /> {validationError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row border border-zinc-800/80 bg-[#060608] rounded-sm overflow-hidden">
        {/* From */}
        <div className="flex-1 p-5 sm:border-r border-b sm:border-b-0 border-zinc-800/80 relative group">
          <div className="absolute top-0 left-5 w-8 h-[1px] bg-amber-500/80"></div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">From</div>
          <div className="flex items-center gap-2">
            <div className="border border-zinc-700/60 rounded-full px-3 py-1 bg-zinc-800/20 text-sm text-zinc-200 whitespace-nowrap">
              {originDisplay}
            </div>
          </div>
        </div>

        {/* To */}
        <div className="flex-1 p-5 sm:border-r border-b sm:border-b-0 border-zinc-800/80 relative">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">To</div>
          <div className="flex items-center gap-2">
            <div className="border border-zinc-700/60 rounded-full px-3 py-1 bg-zinc-800/20 text-sm text-zinc-200 whitespace-nowrap">
              {destinationDisplay}
            </div>
          </div>
        </div>

        {/* Date */}
        <div className="flex-1 p-5 sm:border-r border-b sm:border-b-0 border-zinc-800/80 relative">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">Date</div>
          <div className="text-sm text-zinc-300 mt-2 py-1">{dateLabel}</div>
        </div>

        {/* Action */}
        <button
          onClick={handleAnalyzeClick}
          disabled={status === 'loading'}
          data-testid="analyze-button"
          className="w-full sm:w-32 flex sm:flex-col items-center justify-center gap-3 sm:gap-4 p-5 sm:p-0 bg-amber-500/10 hover:bg-amber-500/20 border-l border-amber-500/20 transition-colors group cursor-pointer disabled:opacity-50"
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-amber-500/90 transition-colors">
            {status === 'loading' ? 'Analyzing...' : 'Analyze this route'}
          </span>
          <Activity className={`w-4 h-4 text-amber-500/90 ${status === 'loading' ? 'animate-pulse' : ''}`} />
        </button>
      </div>
    </motion.div>
  );
};

const DecisionSummary = ({ result, decision, programs, cashEur, hasLive }: any) => {
  const signalMap: Record<string, string> = {
    'exceptional_miles_value': 'Exceptional Award Value',
    'strong_miles_value': 'Strong Award Value',
    'solid_miles_value': 'Solid Award Value',
    'cash_strongly_preferred': 'Cash Offers Better Value',
    'cash_preferred': 'Cash Offers Better Value',
    'low_miles_value': 'Low Award Value',
    'unknown': 'More Evidence Required'
  };

  const whyMap: Record<string, string> = {
    'exceptional_miles_value': 'This option delivers exceptional value for the requested dates based on the estimated cash fare vs miles cost.',
    'strong_miles_value': 'This option delivers strong value for the requested dates based on the estimated cash fare vs miles cost.',
    'solid_miles_value': 'This represents a solid use of miles, providing reasonable value compared to paying cash.',
    'cash_strongly_preferred': 'The estimated cash fare is significantly lower than the value typically extracted from miles on this route. Paying cash preserves your points for better redemptions.',
    'cash_preferred': 'The estimated cash fare is lower than the value typically extracted from miles on this route.',
    'low_miles_value': 'The required miles and surcharges do not provide good value compared to the cash alternative.',
    'unknown': 'Insufficient data is available to make a definitive recommendation between cash and miles.'
  };

  const verdict = signalMap[decision.signal] || signalMap['unknown'];
  const why = whyMap[decision.signal] || whyMap['unknown'];

  const bestProgram = programs && programs.length > 0 ? programs[0] : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      data-testid="decision-summary"
    >
      <div className="flex items-center gap-4 mb-12">
        <div className="h-[1px] w-6 bg-amber-500/80"></div>
        <h2 className="text-[10px] uppercase tracking-[0.25em] text-amber-500/90 font-medium">Decision Summary</h2>
      </div>

      <div className="bg-[#070709]/60 backdrop-blur-2xl p-10 sm:p-16 relative overflow-hidden group shadow-2xl shadow-black/50">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col h-full">
          <div>
            <div className="text-amber-500/90 text-[9px] tracking-[0.3em] mb-6 uppercase">Our Recommendation</div>
            <h3 className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tight text-white mb-4 leading-[1.05]" data-testid="decision-verdict">
              {verdict}
            </h3>

            <div className="flex items-center gap-4 text-zinc-500 text-sm tracking-[0.15em] mb-16 uppercase font-light">
               <span>{result.origin}</span>
               <span>•</span>
               <span>{result.dest}</span>
               <span>•</span>
               <span>{result.date}</span>
            </div>

            <div className="mb-16 max-w-3xl">
               <h4 className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-6">
                 Why this recommendation exists
               </h4>
               <p className="text-zinc-200 leading-[2.2] text-lg sm:text-xl font-light" data-testid="decision-why">
                 {why}
               </p>
            </div>

            <div className="flex flex-wrap gap-x-24 gap-y-12">
               {bestProgram && (
                 <>
                   <div data-testid="award-candidate">
                     <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Best Award Candidate</div>
                     <div className="flex items-baseline gap-2">
                       <div className="text-3xl font-light text-white tracking-tight tabular-nums">{bestProgram.miles.toLocaleString()}</div>
                       <div className="text-zinc-500/80 text-[10px] tracking-[0.25em] uppercase">pts</div>
                     </div>
                   </div>
                   <div>
                     <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Surcharges</div>
                     <div className="text-2xl font-light text-white tracking-tight tabular-nums">€{bestProgram.surcharge}</div>
                   </div>
                   <div>
                     <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Program</div>
                     <div className="text-lg font-light text-white tracking-wide">{bestProgram.program}</div>
                   </div>
                 </>
               )}
               {cashEur && (
                 <div data-testid="cash-comparison">
                   <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Cash Comparison Value</div>
                   <div className="text-2xl font-light text-white tracking-tight tabular-nums">€{cashEur}</div>
                 </div>
               )}
            </div>
            {(!result.verified_identical_routing) && (
              <div className="mt-8 text-xs text-amber-500/70 tracking-wide border-t border-white/[0.05] pt-4" data-testid="routing-disclosure">
                 Note: Cash comparison value may be for a different itinerary or carrier. Award routing may differ.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
};

const ConfidenceAndVerification = ({ decision, hasLive }: any) => {
  const isHigh = decision.confidence === 'high' || decision.confidence === 'very_high';
  return (
    <motion.section
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
    >
      <div className="bg-[#070709]/40 backdrop-blur-2xl shadow-2xl shadow-black/30 p-10 sm:p-16">
         <div className="flex flex-col md:flex-row gap-20 md:gap-32">
           <div className="md:w-1/2">
             <div className="flex flex-col gap-6">
               <div className="text-5xl sm:text-6xl text-white font-light tracking-tighter leading-none uppercase" data-testid="decision-confidence">
                 {decision.confidence || 'Medium'}
               </div>
               <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 ml-1">Decision Confidence</div>
             </div>
           </div>

           <div className="flex-1 md:pl-8">
             <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-12">Next Verification Action</div>
             <div className="flex flex-col gap-8">
               <div className="flex items-center gap-5 text-sm text-zinc-300 font-light tracking-wide">
                 <ArrowRight className="w-4 h-4 text-amber-500/80" />
                 {hasLive ? 'Verify availability directly on official program site' : 'Check manual availability via official program site'}
               </div>
             </div>
           </div>
         </div>
      </div>
    </motion.section>
  );
};

export default function App() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'empty'>('idle');
  const [data, setData] = useState<any>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleAnalyze = async (origin: string, dest: string, date: string) => {
    // Validate inputs
    if (!origin) { setValidationError("Origin is required."); return; }
    if (!dest) { setValidationError("Destination is required."); return; }
    if (origin.toUpperCase() === dest.toUpperCase()) { setValidationError("Origin and destination must be different."); return; }
    if (!isValidDateString(date)) { setValidationError("A valid future date (YYYY-MM-DD) is required."); return; }

    setValidationError(null);
    setStatus('loading');

    const requestPayload = {
      lang: 'en',
      origin: origin,
      dest: dest,
      date: date,
      oneWay: true,
      returnDate: '',
      direct: false,
      mmOnly: false,
      currency: 'eur',
      cabin: 'Economy',
      cabins: ['Economy'],
      flexDays: 0
    };

    try {
      const res = await fetch('/api/awards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setStatus('error');
        setData(json);
        return;
      }

      if (!json.results || json.results.length === 0) {
        setStatus('empty');
        setData(json);
        return;
      }

      setData(json);
      setStatus('success');
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  };

  const result = data?.results?.[0];

  return (
    <div className="min-h-screen bg-[#05050A] text-zinc-200 font-sans selection:bg-amber-500/30 overflow-x-hidden">
      {/* Background layer */}
      <div className="fixed inset-0 z-0 pointer-events-none" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}>
         <div className="flex w-full h-full">
            <div className="w-full md:w-1/2 h-full bg-[#05050A] z-10 md:z-0"></div>
            <div className="absolute md:relative w-full md:w-1/2 h-full top-0 right-0">
               <img
                 src={`${import.meta.env.BASE_URL}earth-bg.jpg`}
                 alt="Earth from space"
                 className="w-full h-full object-cover opacity-[0.10] md:opacity-[0.30] mix-blend-screen scale-105"
               />
               <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-[#05050A] via-[#05050A]/80 md:via-[#05050A]/40 to-transparent"></div>
            </div>
         </div>
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="flex justify-between items-center px-6 py-8 md:px-16 md:py-12 w-full">
           <div className="font-bold tracking-[0.15em] text-[11px]">
              <span className="text-white">AWARD</span><span className="text-amber-500">RADAR</span>
           </div>
        </header>

        <main className="flex-1 flex w-full">
          <div className="w-full md:w-1/2 px-6 md:px-16 pb-24 md:pb-32 flex flex-col pt-4 md:pt-8">
             <SearchInstrument onAnalyze={handleAnalyze} status={status} validationError={validationError} />

             {status === 'loading' && (
               <div className="text-zinc-500 text-sm animate-pulse tracking-wide uppercase" data-testid="loading-state">
                 Fetching Decision Data...
               </div>
             )}

             {status === 'error' && (
               <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-sm" data-testid="error-state">
                 <h3 className="text-red-400 font-medium mb-2">Analysis Failed</h3>
                 <p className="text-zinc-400 text-sm">We could not complete the decision analysis. Please try again later.</p>
               </div>
             )}

             {status === 'empty' && (
               <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-sm" data-testid="empty-state">
                 <h3 className="text-white font-medium mb-2">No Inventory Found</h3>
                 <p className="text-zinc-400 text-sm">There is no reliable cash or award data available for this route on this date.</p>
               </div>
             )}

             {status === 'success' && result && (
               <div className="flex flex-col gap-20 md:gap-32">
                 <div className="flex flex-col gap-6">
                   <DecisionSummary
                      result={result}
                      decision={result.decision}
                      programs={result.programs}
                      cashEur={result.cash_eur}
                      hasLive={result.has_live_data}
                   />
                   <ConfidenceAndVerification
                      decision={result.decision}
                      hasLive={result.has_live_data}
                   />
                 </div>
               </div>
             )}
          </div>
        </main>
      </div>
    </div>
  );
}
