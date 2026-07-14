import { motion } from 'motion/react';
import { ArrowRight, Sparkles, Activity, ShieldCheck, ChevronRight, Check, ShieldAlert, Fingerprint } from 'lucide-react';

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getTripParam(name: string): string {
  try {
    const value = new URLSearchParams(window.location.search).get(name);
    return value?.trim() ?? '';
  } catch {
    return '';
  }
}

const SearchInstrument = () => {
  const origin = getTripParam('from') || 'Origin';
  const destination = getTripParam('to') || 'Destination';
  const dateParam = getTripParam('date');
  const dateLabel = DATE_PARAM_PATTERN.test(dateParam) ? dateParam : 'Date not selected';

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, ease: "easeOut" }}
      className="w-full mb-16 lg:mb-24"
    >
      <div className="text-[9px] tracking-[0.3em] text-zinc-600 uppercase mb-4 ml-1">Decision Workspace</div>
      <div className="flex flex-col sm:flex-row border border-zinc-800/80 bg-[#060608] rounded-sm overflow-hidden">
        {/* From */}
        <div className="flex-1 p-5 sm:border-r border-b sm:border-b-0 border-zinc-800/80 relative group">
          <div className="absolute top-0 left-5 w-8 h-[1px] bg-amber-500/80"></div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">From</div>
          <div className="flex items-center gap-2">
            <div className="border border-zinc-700/60 rounded-full px-3 py-1 bg-zinc-800/20 text-sm text-zinc-200 whitespace-nowrap">
              {origin}
            </div>
          </div>
        </div>

        {/* To */}
        <div className="flex-1 p-5 sm:border-r border-b sm:border-b-0 border-zinc-800/80 relative">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">To</div>
          <div className="flex items-center gap-2">
            <div className="border border-zinc-700/60 rounded-full px-3 py-1 bg-zinc-800/20 text-sm text-zinc-200 whitespace-nowrap">
              {destination}
            </div>
          </div>
        </div>

        {/* Date */}
        <div className="flex-1 p-5 sm:border-r border-b sm:border-b-0 border-zinc-800/80 relative">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">Date</div>
          <div className="text-sm text-zinc-300 mt-2 py-1">{dateLabel}</div>
        </div>

        {/* Action */}
        <div className="w-full sm:w-28 flex sm:flex-col items-center justify-center gap-3 sm:gap-4 p-5 sm:p-0 bg-[#09090C] transition-colors group cursor-default">
          <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-600 transition-colors">Active</span>
          <Activity className="w-4 h-4 text-zinc-600" />
        </div>
      </div>
    </motion.div>
  );
};

const DecisionSummary = () => (
  <motion.section 
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
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
          <h3 className="text-5xl sm:text-6xl md:text-7xl font-light tracking-tight text-white mb-4 leading-[1.05]">
            Singapore Airlines Suites
          </h3>
          <div className="text-xl sm:text-2xl text-zinc-300 font-light mb-10 max-w-3xl leading-relaxed">
            The best premium balance for your requested journey.
          </div>

          <div className="flex items-center gap-4 text-zinc-500 text-sm tracking-[0.15em] mb-16 uppercase font-light">
             <span>Direct</span>
             <span>•</span>
             <span>8h 45m</span>
          </div>

          <div className="mb-16 max-w-3xl">
             <h4 className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-6">
               Why this recommendation exists
             </h4>
             <p className="text-zinc-200 leading-[2.2] text-lg sm:text-xl font-light">
               This option delivers exceptional value for the requested dates while maintaining the shortest premium itinerary, confirmed award availability, and comparatively low surcharges. It represents the optimal balance of capital deployment and travel experience.
             </p>
          </div>

          <div className="flex flex-wrap gap-x-24 gap-y-12">
             <div>
               <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Requirement</div>
               <div className="flex items-baseline gap-2">
                 <div className="text-3xl font-light text-white tracking-tight tabular-nums">86,000</div>
                 <div className="text-zinc-500/80 text-[10px] tracking-[0.25em] uppercase">pts</div>
               </div>
             </div>
             <div>
               <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Surcharges</div>
               <div className="text-2xl font-light text-white tracking-tight tabular-nums">$142</div>
             </div>
             <div>
               <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Program</div>
               <div className="text-lg font-light text-white tracking-wide">KrisFlyer</div>
             </div>
             <div>
               <div className="text-[10px] text-zinc-500/80 uppercase tracking-[0.25em] mb-4">Availability</div>
               <div className="text-lg font-light text-white tracking-wide">2 Seats</div>
               <div className="text-[10px] text-amber-500/80 mt-2 uppercase tracking-[0.25em]">Confirmed</div>
             </div>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-[9px] text-zinc-600 uppercase tracking-[0.25em]">
           <span>Decision Summary</span>
           <span>Generated by AwardRadar Intelligence</span>
        </div>
      </div>
    </div>
  </motion.section>
);

const ConfidenceAndVerification = () => (
  <motion.section 
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
  >
    <div className="bg-[#070709]/40 backdrop-blur-2xl shadow-2xl shadow-black/30 p-10 sm:p-16">
       <div className="flex flex-col md:flex-row gap-20 md:gap-32">
         <div className="md:w-1/2">
           <div className="flex flex-col gap-6">
             <div className="text-7xl sm:text-8xl lg:text-9xl text-white font-light tracking-tighter leading-none">
               HIGH
             </div>
             <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 ml-1">Decision Confidence</div>
             <p className="text-sm text-zinc-400 leading-relaxed font-light max-w-sm mt-4">
               Data points corroborate with primary carrier inventory. Ghost availability risk assessed as minimal.
             </p>
           </div>
         </div>

         <div className="flex-1 md:pl-8">
           <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-12">Verification Protocol</div>
           <div className="flex flex-col gap-8">
             <div className="flex items-center gap-5 text-sm text-zinc-300 font-light tracking-wide">
               <Check className="w-4 h-4 text-amber-500/80" />
               Live award availability verified
             </div>
             <div className="flex items-center gap-5 text-sm text-zinc-300 font-light tracking-wide">
               <Check className="w-4 h-4 text-amber-500/80" />
               Direct airline confirmation
             </div>
             <div className="flex items-center gap-5 text-sm text-zinc-300 font-light tracking-wide">
               <Check className="w-4 h-4 text-amber-500/80" />
               Updated 2 min ago
             </div>
           </div>
         </div>
       </div>
    </div>
  </motion.section>
);

const AlternativePathways = () => (
  <motion.section 
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
  >
    <div className="flex items-center gap-4 mb-16">
      <div className="h-[1px] w-6 bg-zinc-800"></div>
      <h2 className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-medium">Alternative Pathways</h2>
    </div>

    <div className="flex flex-col">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-y-2 gap-x-4 sm:items-baseline py-8 border-b border-white/[0.02]">
         <div className="col-span-3">
            <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em]">Cash Alternative</div>
         </div>
         <div className="col-span-6">
            <div className="text-base text-zinc-300 font-light tracking-wide">Lufthansa Business</div>
            <div className="text-xs text-zinc-600 mt-2 font-light">Direct • Cash Fare • LH400</div>
         </div>
         <div className="col-span-3 sm:text-right mt-2 sm:mt-0">
            <div className="text-sm text-zinc-500 font-light tracking-wide tabular-nums">$2,840</div>
            <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em] mt-2">Worth Considering</div>
         </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-y-2 gap-x-4 sm:items-baseline py-8 border-b border-white/[0.02]">
         <div className="col-span-3">
            <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em]">Award Alternative</div>
         </div>
         <div className="col-span-6">
            <div className="text-base text-zinc-300 font-light tracking-wide">Condor Premium</div>
            <div className="text-xs text-zinc-600 mt-2 font-light">Direct • Alaska Mileage Plan</div>
         </div>
         <div className="col-span-3 sm:text-right mt-2 sm:mt-0">
            <div className="text-sm text-zinc-500 font-light tracking-wide flex items-baseline sm:justify-end gap-1.5 tabular-nums">
              55,000 <span className="text-[9px] text-zinc-600 uppercase tracking-[0.25em]">pts</span>
            </div>
            <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em] mt-2">Review Availability</div>
         </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-y-2 gap-x-4 sm:items-baseline py-8">
         <div className="col-span-3 flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-amber-500/70" />
            <div className="text-[9px] text-amber-500/70 uppercase tracking-[0.25em]">Hidden Opportunity</div>
         </div>
         <div className="col-span-6">
            <div className="text-base text-zinc-300 font-light tracking-wide">Virgin Atlantic Upper Class</div>
            <div className="text-xs text-zinc-600 mt-2 font-light">1 Stop (LHR) • Air France Flying Blue</div>
         </div>
         <div className="col-span-3 sm:text-right mt-2 sm:mt-0">
            <div className="text-sm text-zinc-400 font-light tracking-wide flex items-baseline sm:justify-end gap-1.5 tabular-nums">
              61,000 <span className="text-[9px] text-zinc-600 uppercase tracking-[0.25em]">pts</span>
            </div>
            <div className="text-[9px] text-amber-500/60 uppercase tracking-[0.25em] mt-2">Strong Value</div>
         </div>
      </div>
    </div>
  </motion.section>
);

const ExecutionWorkspace = () => (
  <motion.section 
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
  >
    <div className="flex items-center gap-4 mb-16">
      <div className="h-[1px] w-6 bg-zinc-800"></div>
      <h2 className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-medium">Execution</h2>
    </div>

    <div className="bg-[#070709]/40 backdrop-blur-2xl p-10 sm:p-16 border border-white/[0.01]">
      <h3 className="text-2xl sm:text-3xl text-white font-light mb-16 tracking-wide">How to secure this itinerary</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
         <div className="border-l border-zinc-800/40 pl-8">
            <div className="text-base text-white font-light mb-3">Initiate Transfer</div>
            <div className="text-sm text-zinc-400 font-light leading-relaxed">Move 86,000 points to your KrisFlyer account.</div>
         </div>
         <div className="border-l border-zinc-800/40 pl-8">
            <div className="text-base text-white font-light mb-3">Wait for Clearance</div>
            <div className="text-sm text-zinc-400 font-light leading-relaxed">Most transfers from major bank partners clear instantly.</div>
         </div>
         <div className="border-l border-zinc-800/40 pl-8">
            <div className="text-base text-white font-light mb-3">Confirm Booking</div>
            <div className="text-sm text-zinc-400 font-light leading-relaxed">Secure your itinerary directly on the carrier's platform.</div>
         </div>
      </div>
      <div className="mt-20 flex flex-col sm:flex-row items-start sm:items-center justify-between pt-10 gap-8 border-t border-white/[0.02]">
        <div className="text-sm text-zinc-400 font-light tracking-wide">
          Intelligence verified. Ready to execute?
        </div>
        <button className="flex items-center gap-4 text-xs uppercase tracking-[0.25em] text-white hover:text-amber-500 transition-colors">
          Proceed to Transfer <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  </motion.section>
);

const DecisionClosure = () => (
  <motion.section 
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
    className="mt-8 pt-20 border-t border-white/[0.02]"
  >
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-2">
         <div className="text-xl sm:text-2xl text-white font-light tracking-wide">Decision complete</div>
         <div className="text-sm text-zinc-500 font-light tracking-wide">Recommendation generated by AwardRadar Intelligence</div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-8">
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em] mb-4">Last Verified</div>
          <div className="text-sm text-zinc-300 font-light tracking-wide tabular-nums">18:42 UTC</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em] mb-4">Data Freshness</div>
          <div className="text-sm text-zinc-300 font-light tracking-wide">2 minutes</div>
        </div>
        <div className="col-span-2">
          <div className="text-[9px] text-zinc-600 uppercase tracking-[0.25em] mb-4">Sources</div>
          <div className="flex flex-col gap-2">
            <div className="text-sm text-zinc-300 font-light tracking-wide">Seats.aero</div>
            <div className="text-sm text-zinc-300 font-light tracking-wide">Direct Airline</div>
            <div className="text-sm text-zinc-300 font-light tracking-wide">Cash Provider</div>
          </div>
        </div>
      </div>
    </div>
  </motion.section>
);

export default function App() {
  return (
    <div className="min-h-screen bg-[#05050A] text-zinc-200 font-sans selection:bg-amber-500/30 overflow-x-hidden">
      {/* Split Background */}
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
               <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent to-[#05050A]/70 hidden md:block"></div>
            </div>
         </div>
      </div>

      {/* Main Content Layer */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex justify-between items-center px-6 py-8 md:px-16 md:py-12 w-full">
           <div className="font-bold tracking-[0.15em] text-[11px]">
              <span className="text-white">AWARD</span><span className="text-amber-500">RADAR</span>
           </div>
           <nav className="hidden md:flex gap-10 text-[10px] uppercase tracking-widest font-medium text-zinc-500">
             <a href="#" className="hover:text-white transition-colors">About</a>
             <a href="#" className="hover:text-white transition-colors">Methodology</a>
             <a href="#" className="hover:text-white transition-colors">Sign in</a>
           </nav>
        </header>

        {/* Content Grid */}
        <main className="flex-1 flex w-full">
          {/* Left Panel - Decision Workspace */}
          <div className="w-full md:w-1/2 px-6 md:px-16 pb-24 md:pb-32 flex flex-col pt-4 md:pt-8">
             <SearchInstrument />

             <div className="flex flex-col gap-20 md:gap-32">
               <div className="flex flex-col gap-6">
                 <DecisionSummary />
                 <ConfidenceAndVerification />
               </div>
               <AlternativePathways />
               <ExecutionWorkspace />
               <DecisionClosure />
             </div>
          </div>
        </main>
        
        {/* Footer */}
        <footer className="w-full px-6 py-8 md:px-16 md:py-12 flex justify-between items-center text-[10px] uppercase tracking-widest text-zinc-600">
           <div className="flex gap-6">
              <a href="/privacy" className="hover:text-zinc-500 transition-colors">Privacy</a>
              <a href="/impressum" className="hover:text-zinc-500 transition-colors">Imprint</a>
              <a href="/about" className="hover:text-zinc-500 transition-colors">Accessibility</a>
           </div>
           <div className="hidden md:block tracking-widest text-zinc-700">
             51°N 0°E - 35,786 KM
           </div>
        </footer>
      </div>
    </div>
  );
}

