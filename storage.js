// storage.js — persistence layer. UMD so node:test and the browser both load it.
// Takes Catalog as its one dependency, for the single rule it shares with the
// search: a part name is SAVED with straight quotes, so what the iOS keyboard
// produced ("1” EMT") and what the seed list holds ("1\" EMT") are one part and
// not two. index.html therefore loads catalog.js before this file.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.Store = factory(root.Catalog);
})(typeof self !== 'undefined' ? self : this, function (Catalog) {
  'use strict';

  const KEY = 'ce-bids';

  function uid() {
    try {
      const c = (typeof crypto !== 'undefined') ? crypto : (typeof global !== 'undefined' ? global.crypto : undefined);
      if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    } catch { /* fall through to the base36 fallback below */ }
    return Math.random().toString(36).slice(2, 10);
  }
  function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  // Returns null for anything that isn't a valid YYYY-MM-DD date, instead of
  // silently producing "Invalid Date" math. Composed from local
  // getFullYear/getMonth/getDate (not toISOString, which is UTC) so this
  // agrees with todayISO()'s local-date semantics.
  function mondayOf(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const dt = new Date(iso + 'T12:00:00');
    if (isNaN(dt.getTime())) return null;
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  // The window of weeks a job's hours can be logged in, both ends named by
  // their Monday. Pure, and the only rule about it in the app:
  //
  //   lastISO  — the week he is standing in. There are no hours yet in a week
  //              that has not happened.
  //   firstISO — the week the bid was walked in, because a job cannot have
  //              been worked before it was measured, AND NEVER LATER THAN
  //              lastISO.
  //
  // That clamp is the fix for a job that opened dead. A bid dated ahead of
  // today — he writes Monday's bid on Saturday, and the new-bid screen takes
  // the date he types — put the floor in a week that has not happened yet. The
  // screen opened on the current week, which was already BELOW its own floor,
  // so the back arrow was off (nothing older allowed) and the forward arrow
  // was off (nothing newer exists): two dead arrows on a live job. Clamping
  // says the plain thing instead — if the bid is dated this week or later,
  // this week is the only week there is.
  //
  // Returns null only if today itself is unreadable, which cannot happen from
  // todayISO(); a bid with a broken date simply floors at this week.
  function jobWeekWindow(bidDateISO, today) {
    const lastISO = mondayOf(today || todayISO());
    if (!lastISO) return null;
    const walked = mondayOf(bidDateISO);
    return { firstISO: walked && walked < lastISO ? walked : lastISO, lastISO };
  }

  // -------------------------------------------------------------------------
  // Seed data
  // -------------------------------------------------------------------------
  // WHAT A FRESH INSTALL KNOWS. Nothing here is a price: every part lands with
  // lastCostCents null and uses 0, because what a coupling costs is what the
  // supply house charged him last week and the app learns that off his own
  // walk. What the seed carries is NAMES, and it carries them SIZE-COMPLETE:
  // the reason the first list was too small was never the count, it was
  // standing under a rack with 1-1/2" in his hand and finding only 1/2"
  // through 1-1/4" in the app.
  //
  // So the families are built from their size lists rather than typed out one
  // by one. A family cannot be half a family, the trade sizes cannot drift
  // apart between EMT and its couplings, and adding a size adds it everywhere
  // it belongs. Every name is written the way Catalog.sizeKey reads a size:
  // the trade size FIRST, with its inch mark ('1-1/4" EMT', not 'EMT 1-1/4'),
  // and wire over #1 as '4/0 THHN' and never '#4/0', which would read as a #4.
  //
  // Seeds are for FRESH INSTALLS. A phone with a catalog of its own keeps it
  // and gets "Add the standard parts" in Settings, which adds only the names
  // it is missing.

  // The six trade sizes this shop actually runs. Everything conduit-shaped is
  // built from this list, and so is every fitting that has to fit it.
  const CONDUIT_SIZES = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"'];
  // PVC-coated rigid and the stainless fittings are dairy-wash-down items and
  // he does not run them in every size.
  const COATED_SIZES = ['3/4"', '1"', '1-1/4"', '1-1/2"'];
  // THHN and XHHW from the smallest he pulls to 4/0. Written '1/0' and not
  // '#1/0': Catalog.sizeKey reads a leading '#4' as a #4 wire, so '#4/0' would
  // sort a 4/0 feeder in with the #4s.
  const WIRE_SIZES = ['#14', '#12', '#10', '#8', '#6', '#4', '#2', '#1', '1/0', '2/0', '3/0', '4/0'];
  // XHHW is feeder wire here, so it starts where his feeders start.
  const XHHW_SIZES = ['#4', '#2', '1/0', '2/0', '3/0', '4/0'];

  // A family: the same part in every size it comes in.
  function sizedParts(category, sizes, suffix, unit) {
    return sizes.map((size) => [category, size + ' ' + suffix, typeof unit === 'function' ? unit(size) : unit]);
  }
  // Small wire comes off a roll, feeders come off a reel by the foot. His own
  // habit, kept from the first seed list.
  function wireUnit(size) { return ['#14', '#12', '#10'].indexOf(size) !== -1 ? 'roll' : 'ft'; }

  const SEED_CATALOG = [].concat(
    // --- CONDUIT: five materials in six sizes, plus coated rigid ------------
    sizedParts('conduit', CONDUIT_SIZES, 'EMT', 'ft'),
    sizedParts('conduit', CONDUIT_SIZES, 'rigid', 'ft'),
    sizedParts('conduit', CONDUIT_SIZES, 'S.S. conduit', 'ft'),
    sizedParts('conduit', CONDUIT_SIZES, 'PVC', 'ft'),
    sizedParts('conduit', CONDUIT_SIZES, 'seal-tight', 'ft'),
    sizedParts('conduit', COATED_SIZES, 'PVC-coated rigid', 'ft'),

    // --- WIRE: building wire, cable, cord -----------------------------------
    sizedParts('wire', WIRE_SIZES, 'THHN', wireUnit),
    sizedParts('wire', XHHW_SIZES, 'XHHW', 'ft'),
    sizedParts('wire', ['#6', '#4', '#2'], 'bare copper ground', 'ft'),
    [
      ['wire', '12/2 MC cable', 'ft'], ['wire', '12/3 MC cable', 'ft'],
      ['wire', '10/2 MC cable', 'ft'], ['wire', '10/3 MC cable', 'ft'],
      ['wire', '12/3 SOOW cord', 'ft'], ['wire', '12/4 SOOW cord', 'ft'],
      ['wire', '10/3 SOOW cord', 'ft'], ['wire', '10/4 SOOW cord', 'ft'],
      ['wire', '8/3 SOOW cord', 'ft'], ['wire', '8/4 SOOW cord', 'ft'],
      ['wire', '14/4 VFD cable', 'ft'], ['wire', '12/4 VFD cable', 'ft'],
      ['wire', '10/4 VFD cable', 'ft'], ['wire', '8/4 VFD cable', 'ft'],
      ['wire', '6/4 VFD cable', 'ft'],
      ['wire', 'Cat6', 'ft'], ['wire', 'Wire nuts, tape, crimps', 'lot'],
    ],

    // --- BOXES: the fittings that hang the pipe, and what it lands in -------
    sizedParts('boxes', CONDUIT_SIZES, 'coupling', 'ea'),
    sizedParts('boxes', CONDUIT_SIZES, 'connector', 'ea'),
    sizedParts('boxes', CONDUIT_SIZES, 'LB', 'ea'),
    sizedParts('boxes', CONDUIT_SIZES, 'hub', 'ea'),
    sizedParts('boxes', CONDUIT_SIZES, 'one-hole strap', 'ea'),
    sizedParts('boxes', COATED_SIZES, 'S.S. hub', 'ea'),
    [
      ['boxes', '1" expansion fitting', 'ea'], ['boxes', '2" expansion fitting', 'ea'],
      ['boxes', 'Strut 1-5/8"', 'ft'], ['boxes', 'Beam clamp', 'ea'],
      ['boxes', 'J-box 4x4', 'ea'], ['boxes', '4-11/16" box', 'ea'],
      ['boxes', 'FS box', 'ea'], ['boxes', 'FD box', 'ea'],
      ['boxes', 'NEMA 4X S.S. 6x6', 'ea'], ['boxes', 'NEMA 4X S.S. 8x8', 'ea'],
      ['boxes', 'NEMA 4X S.S. 10x10', 'ea'], ['boxes', 'NEMA 4X S.S. 12x12', 'ea'],
      ['boxes', 'Wireway 4x4', 'ft'], ['boxes', 'Cord grips', 'ea'],
      ['boxes', 'S.S. cord grips', 'ea'], ['boxes', 'Straps & supports', 'lot'],
    ],

    // --- LIGHTING -----------------------------------------------------------
    [
      ['lighting', 'LED high bay 100 W', 'ea'], ['lighting', 'LED high bay 150 W', 'ea'],
      ['lighting', 'LED high bay 200 W', 'ea'], ['lighting', 'LED high bay 240 W', 'ea'],
      ['lighting', 'LED vapor-tight 4 ft', 'ea'], ['lighting', 'LED vapor-tight 8 ft', 'ea'],
      ['lighting', 'LED strip 4 ft', 'ea'], ['lighting', 'LED strip 8 ft', 'ea'],
      ['lighting', 'Wall pack', 'ea'],
      ['lighting', 'Emergency light fixture', 'ea'], ['lighting', 'Exit sign', 'ea'],
      ['lighting', 'T8 LED tube', 'ea'], ['lighting', 'Occupancy sensor', 'ea'],
      ['lighting', 'Motion sensor', 'ea'], ['lighting', 'Photocell', 'ea'],
    ],

    // --- GEAR: breakers, disconnects, motor control, devices ----------------
    [
      ['gear', '15 A 1-pole breaker', 'ea'], ['gear', '20 A 1-pole breaker', 'ea'],
      ['gear', '30 A 1-pole breaker', 'ea'], ['gear', '20 A 2-pole breaker', 'ea'],
      ['gear', '30 A 2-pole breaker', 'ea'], ['gear', '60 A 2-pole breaker', 'ea'],
      ['gear', '30 A 3-pole breaker', 'ea'], ['gear', '60 A 3-pole breaker', 'ea'],
      ['gear', '100 A 3-pole breaker', 'ea'], ['gear', '200 A 3-pole breaker', 'ea'],
      ['gear', '30 A disconnect, non-fused', 'ea'], ['gear', '30 A disconnect, fused', 'ea'],
      ['gear', '60 A disconnect, non-fused', 'ea'], ['gear', '60 A disconnect, fused', 'ea'],
      ['gear', '100 A disconnect, non-fused', 'ea'], ['gear', '100 A disconnect, fused', 'ea'],
      ['gear', '200 A disconnect, fused', 'ea'],
      ['gear', '30 A disconnect, NEMA 4X S.S.', 'ea'], ['gear', '60 A disconnect, NEMA 4X S.S.', 'ea'],
      ['gear', 'Motor starter NEMA 0', 'ea'], ['gear', 'Motor starter NEMA 1', 'ea'],
      ['gear', 'Motor starter NEMA 2', 'ea'], ['gear', 'Motor starter NEMA 3', 'ea'],
      ['gear', 'Contactor 30 A', 'ea'], ['gear', 'Contactor 60 A', 'ea'],
      ['gear', 'VFD 1 HP', 'ea'], ['gear', 'VFD 3 HP', 'ea'], ['gear', 'VFD 5 HP', 'ea'],
      ['gear', 'VFD 10 HP', 'ea'], ['gear', 'VFD 20 HP', 'ea'], ['gear', 'VFD 30 HP', 'ea'],
      ['gear', 'VFD 50 HP', 'ea'],
      ['gear', 'Transformer 15 kVA', 'ea'], ['gear', 'Transformer 30 kVA', 'ea'],
      ['gear', 'Transformer 45 kVA', 'ea'], ['gear', 'Transformer 75 kVA', 'ea'],
      ['gear', 'Receptacle 20 A', 'ea'], ['gear', 'Receptacle 30 A', 'ea'], ['gear', 'Receptacle 50 A', 'ea'],
      ['gear', 'Pin & sleeve 30 A', 'ea'], ['gear', 'Pin & sleeve 60 A', 'ea'], ['gear', 'Pin & sleeve 100 A', 'ea'],
      ['gear', 'Switch 3-way', 'ea'], ['gear', 'Pilot light', 'ea'], ['gear', 'Push button', 'ea'],
      ['gear', 'E-stop button', 'ea'], ['gear', 'Terminal blocks', 'ea'],
      ['gear', 'Fuses, class J', 'ea'],
      ['gear', 'Photo eye', 'ea'], ['gear', 'Shrink tube, tape, crimps', 'lot'],
    ],

    // --- RENTALS: kept out of the material lists, offered as rental chips ---
    [
      ['rentals', 'Scissor lift 19 ft', 'day'], ['rentals', 'Scissor lift 26 ft', 'day'],
      ['rentals', 'Scissor lift 32 ft', 'day'], ['rentals', 'Boom lift 45 ft', 'day'],
      ['rentals', 'Boom lift 60 ft', 'day'], ['rentals', 'Fork lift', 'day'],
      ['rentals', 'Scaffolding', 'day'], ['rentals', 'Core drill', 'day'],
      ['rentals', 'Trencher', 'day'], ['rentals', 'Generator', 'day'],
      ['rentals', 'Dumpster', 'ea'],
    ]
  );

  // His own tools, by the job they do. A day of one bills at equipment % of
  // what it cost new, so every one of them lands with no cost on it: what a
  // bender cost in 2014 is a number only he has.
  const SEED_EQUIPMENT = [
    // Conduit
    'Hydraulic bender', 'EMT bender', 'Threader', 'Pipe vise and tripod', 'Hydraulic knockout set',
    'Band saw', 'Chop saw', 'Magnetic drill',
    // Pulling and terminating
    'Cable tugger', 'Cable puller', 'Hydraulic cutter', 'Hydraulic crimper', 'Fish tape and rodder',
    // Concrete and demo
    'Core drill', 'Concrete saw', 'Rotary hammer', 'Hammer drill', 'Demo hammer',
    // Access and lifting
    'Extension ladder', 'Platform ladder', 'Rolling scaffold', 'Chain hoist',
    // Power and site
    'Generator', 'Air compressor', 'Welder', 'Job trailer', 'Light stand',
    // Testing
    'Megger', 'Thermal camera', 'Power quality meter',
  ];

  // THE DID-YOU-FORGET LIST. Every row carries the kind of line it becomes, so
  // the walk does not have to guess from the words:
  //
  //   'rental' — money that is not material: a lift, a generator, a dumpster,
  //              a shutdown window. Opens the rental prompt (or the tool
  //              picker, for the row that is about his own gear), where days
  //              and a day rate are what the line needs.
  //   'item'   — a line in one of his areas at $0, flagged amber until he
  //              prices it. Permits, patch and paint, engineering.
  //
  // Order is the point: the ones he forgets most are the ones he reads first.
  // The list stays editable in Settings, and a row he types there is a plain
  // string that routes off its own words the way the whole list used to.
  const SEED_FORGET = [
    { name: 'Lift rental', kind: 'rental' },
    { name: 'Temporary power / generators', kind: 'rental' },
    { name: 'Shutdown windows / after-hours', kind: 'rental' },
    { name: 'Permits and inspection fees', kind: 'item' },
    { name: 'Core drilling / concrete cutting', kind: 'item' },
    { name: 'Disposal / dumpster', kind: 'rental' },
    { name: 'Scaffolding', kind: 'rental' },
    { name: 'Equipment (owned tools)', kind: 'rental' },
    { name: 'Site orientation / badging / LOTO training', kind: 'item' },
    { name: 'Hot work permit / fire watch', kind: 'item' },
    { name: 'Patch and paint', kind: 'item' },
    { name: 'Trenching / backfill', kind: 'item' },
    { name: 'Utility coordination (APS/SRP)', kind: 'item' },
    { name: 'Engineering / stamped drawings', kind: 'item' },
    { name: 'Long-lead gear (VFDs, transformers, switchgear)', kind: 'item' },
    { name: 'Startup, testing, and commissioning', kind: 'item' },
    { name: 'Washdown-rated (NEMA 4X / stainless) requirements', kind: 'item' },
    { name: 'Travel days / per diem', kind: 'item' },
    { name: 'Sub-contractor', kind: 'item' },
  ];

  // The first four are his, word for word off his own proposals. The ten under
  // them are the same voice: what is NOT in the price, said plainly, before it
  // becomes an argument on site.
  const SEED_NOTES = [
    'Prices subject to change; final pricing based on actual material.',
    'Disconnect to be supplied by customer.',
    'Does not include lift rental.',
    'Stainless supports and brackets to be installed by welders.',
    'Does not include permits or inspection fees.',
    'Does not include patching, painting, or drywall repair.',
    'Does not include trenching, backfill, or concrete work.',
    'Customer to provide clear access to the work area and panels.',
    'Work to be done during a scheduled shutdown arranged by the customer.',
    'After-hours or weekend work billed at the hourly rate.',
    'Existing wiring and equipment assumed to be in working order unless noted.',
    'Customer-supplied equipment installed as provided; no warranty on customer-supplied parts.',
    'Lift or scaffolding to be provided by customer.',
    'Material lead times may affect the schedule.',
  ];

  // The one note a new bid arrives with, on Full and Summary. It is the
  // sentence that keeps a copper spike from being his to eat, and it is the
  // only one that is true of every job he writes. Scope & price bids start
  // with none: their terms page already carries how long the price is good.
  const SEED_DEFAULT_NOTE = SEED_NOTES[0];

  // THE CLAUSE LIBRARY.
  //
  // NOT LEGAL ADVICE, AND NOT REVIEWED BY AN ATTORNEY. These are drafts in his
  // own words for his attorney to read, and the Arizona lien rights they do
  // not mention still need the separate 20-day preliminary notice.
  //
  // The eight in "always" are new. What was there before was transcribed off
  // the Consolidated Co-Ops job, and that was SUBCONTRACT language: paid when
  // the Owner pays, notice periods written for a general contractor,
  // liquidated damages, an indemnity with HIM holding the owner harmless, and
  // a workmanship clause about asphalt and drainage that came from a paving
  // contract. Nineteen of them went onto every project bid he wrote. On his
  // OWN proposal, to a plant manager, most of it says the wrong thing.
  //
  // So: eight clauses on his own paper, facing the customer, in the words he
  // would use standing in front of one. The sub-facing text is not thrown
  // away, it is moved into its own group and kept VERBATIM, for the jobs where
  // he really is under a general contractor. Trench, site, hazmat and subs are
  // unchanged.
  const SEED_CLAUSES = [
    // always (8) — his own proposal, to his own customer
    { id: 'k01', group: 'always', title: 'Scope', text: 'This price covers the work listed in this proposal and nothing else. Anything not listed is not included. If you want something added, we will price it for you and you can decide then.' },
    { id: 'k02', group: 'always', title: 'Price and material', text: 'This price is good for 30 days from the date on this proposal. Material is billed at what it costs us on the day we buy it. If material prices move between this proposal and the purchase, the difference goes on the invoice, and we will tell you before we buy.' },
    { id: 'k03', group: 'always', title: 'Payment', text: 'Payment is due within 30 days of the invoice date. On jobs over $10,000 we bill monthly for the work completed that month, and the last invoice is due 30 days after the work is finished.' },
    { id: 'k04', group: 'always', title: 'Late payment', text: 'Any amount not paid when it is due carries interest at 1.5% a month, or the highest rate Arizona law allows if that is less. The costs of collecting it, including reasonable attorneys\' fees, are added to the balance.' },
    { id: 'k05', group: 'always', title: 'Changes and concealed conditions', text: 'A price is figured on what we could see on the walk. If the job turns up something we could not see, a wall thicker than it looked, conduit that is not where the drawing puts it, or anything hidden behind or inside the building, we stop and price the change with you. Changes are priced and approved in writing before the work is done.' },
    { id: 'k06', group: 'always', title: 'Access and shutdowns', text: 'You provide clear access to the work area, the panels, and the equipment, and you schedule any power shutdowns the work needs. Time we spend standing by, and work outside normal working hours, is billed at the hourly rate.' },
    { id: 'k07', group: 'always', title: 'Warranty', text: 'Our workmanship is warranted for one year from the day the work is finished. Materials carry the manufacturer\'s warranty and no other. Equipment you supply is not covered, and neither is damage caused by others, by misuse, or by conditions outside our work.' },
    { id: 'k08', group: 'always', title: 'Governing law', text: 'This agreement is governed by the laws of Arizona. Any dispute about it is handled in Maricopa County, Arizona.' },

    // gc (12) — the subcontract language, verbatim, for jobs under a GC
    { id: 'g01', group: 'gc', title: 'Payment under a general contractor', text: 'Contractor shall be paid a monthly progress payment within 15 days after receipt of the payment by the Owner for the value of work performed. Final payment, including all retention, shall be due 15 days after the work described in the Proposal is substantially completed. No provision of this agreement shall serve to void the Contractor\'s entitlement to payment for properly performed work.' },
    { id: 'g02', group: 'gc', title: 'Continued performance', text: 'Nothing in this Contract shall require the Contractor to continue performance if timely payments are not made to Contractor for suitably performed work.' },
    { id: 'g03', group: 'gc', title: 'Back charges', text: 'No back charges or claim of the Owner for services shall be valid except by an agreement in writing by the Contractor before the work is executed, except in the case of the Contractor\'s failure to meet any requirement of the Contract. In such event, the Owner shall notify the Contractor of such default, in writing, and allow the Contractor reasonable time to correct any deficiency before incurring any cost chargeable to the Contractor.' },
    { id: 'g04', group: 'gc', title: 'Time for performance', text: 'Contractor shall be given a reasonable time in which to commence and complete the performance of the Contract. Contractor provides no assurances as to a complete date since the Work is subject to weather conditions, prior commitments, mechanical failures, and other cause beyond Contractor\'s control. Contractor shall not be responsible for delays or default where occasioned by any causes of any kind and extent beyond its control, including but not limited to: delay caused by Owner, architect and/or engineers, delays in transportation, shortages of raw materials, civil disorders, labor difficulties, vendor allocations, fires, floods, accident hazardous waste or controlled substances and acts of God. Contractor shall be entitled to equitable adjustment in the contract price for additional costs due to unanticipated project delays or accelerations. Contractor shall not be obligated to provide any labor or materials outside the scope of work unless Owner shall first agree in writing to equitably adjust the contract price to be paid Contractor.' },
    { id: 'g05', group: 'gc', title: 'Notice', text: 'Any notice or written claim required by the Contract to be submitted to the Owner, on account of charges, extras, delays, acceleration, or otherwise, shall be furnished within a time period, and in a manner to permit the Owner to satisfy the requirements of the Contract, notwithstanding any shorter time period otherwise provided.' },
    { id: 'g06', group: 'gc', title: 'Lien rights', text: 'Nothing in this Contract shall serve to void Contractor\'s right to file a lien or claim on its behalf in the event that any payment to Contractor is not timely made.' },
    { id: 'g07', group: 'gc', title: 'Labor', text: 'Contractor shall not be bound by any of Owner\'s labor agreements (in whole or in part).' },
    { id: 'g08', group: 'gc', title: 'Liquidated damages', text: 'The Owner shall make no demand for liquidated damages for delays in any sum in excess of such amounts as may be specifically named in this Contract and no liquidated damages may be assessed against Contractor for more than the amount paid by the Owner for unexcused delays to the event actually caused by the Contractor.' },
    { id: 'g09', group: 'gc', title: 'Schedule', text: 'Contractor shall submit a schedule to Owner, Owner will review and notify Contractor of any schedule conflict. If Contractor finds it necessary to change his schedule, Owner will give his best effort to meet this change in schedule. Contractor shall not be penalized for non-performance and will be paid for work performed.' },
    { id: 'g10', group: 'gc', title: 'Insurance restriction', text: 'Notwithstanding any provision to the contrary, Contractor shall maintain the types and limitations on insurance as shown on the attached certificate of insurance. Contractor is not required to waive any claims or rights of subrogation against the Owner or any others for losses and claims covered or paid by Owner\'s workers compensation or general liability insurance. Acceptance of the Certificate of Insurance constitutes acceptance of the insurance of Contractor, including any additional insured requirements. In addition, Contractor shall not provide completed operations under an additional insured requirement.' },
    { id: 'g11', group: 'gc', title: 'Indemnity, hold harmless', text: 'To the fullest extent permitted by law, Contractor agrees to protect, defend, indemnify, and hold harmless Owner from and against all liability, loss, claims, demands, damages, suits, costs, fees, fines, penalties, expenses, and causes of action to the extent caused by Contractor or any of Contractor\'s employees, agents, representatives, subcontractors, or suppliers. Any indemnification or hold harmless obligation of the Contractor shall extend only to claims resulting to bodily injury and property damage and then only to that part or proportion of any claim damage, loss or defect that results from the negligence or intentional act of Contractor or someone for whom it is responsible. Nothing in this agreement shall require the Contractor to indemnify any other party from any damages including expenses and attorneys\' fees to persons or property for any amount exceeding the degree Contractor directly caused such damages. Contractor shall not be responsible for fines or assessments made against Owner and Contractor. Contractor retains all rights of subrogation. Contractor will not indemnify anybody for any actions except for Contractor\'s own negligence and only in the proportional amount of its negligence.' },
    { id: 'g12', group: 'gc', title: 'Right to rely', text: 'Contractor shall rely on plans, drawings, specifications and other information provided by Owner, Owner, Architect or representatives of each. Contractor assumes no risk for unknown or unforeseen conditions not evident from the plans, drawings, specifications or other information provided to Contractor.' },

    // trench (3)
    { id: 'k20', group: 'trench', title: 'Soils', text: 'Contractor shall have no liability to Owner or any third-party relating to underlying soil conditions. Contractor will not sacrifice the quality or integrity by placing asphalt pavement on base course or subgrade that is unstable or subgrade containing frost, including top lifts or overlays when temperatures do not meet material specifications. Contractor\'s warranty shall be waived and have no effect should Owner direct or authorize Contractor to pave on unstable subgrade or subgrade containing frost and Owner shall be responsible for any and all resulting damage or required repairs. If Owner requests that the top lift of asphalt be placed at a later date, the cost for all clean up and remobilization is the Owner\'s responsibility.' },
    { id: 'k21', group: 'trench', title: 'Underground utilities', text: 'Cantu Electric LLC. will not be held liable for any private underground utilities not marked by Arizona 811 including electric, water, sprinkler lines, etc.' },
    { id: 'k22', group: 'trench', title: 'Drainage', text: 'Cantu Electric LLC. is not liable for drainage on projects with less than 1% fall. Due to existing conditions and matching elevations of concrete curbs, buildings and/or asphalt, we may not be able to raise or lower elevations to achieve proper slope to prevent standing water, therefore ponding of water may occur.' },
    // site (2)
    { id: 'k23', group: 'site', title: 'Engineering services', text: 'If Contractor provides subcontracted construction stakes and/or subcontracted engineering services, Owner agrees to indemnify and defend Contractor from and against any and all claims, demands, damages, costs or expenses, including attorneys\' fees, resulting from or related to these services, including drainage of water as to direction and amount, both during and after performance of the Work. Owner shall indemnify, hold harmless, and defend Contractor from and against any and all damages, claims, costs or expenses, including attorneys\' fees and costs, resulting from these services.' },
    { id: 'k24', group: 'site', title: 'Americans with Disabilities Act', text: 'Owner is solely responsible for maintaining the subject property in full compliance with the ADA and agrees to indemnify and hold Contractor harmless from and against any and all liability, claims, damages or expenses, including attorneys\' fees, relating in any way to ADA requirements or issues. Contractor recommends that Owner obtain the services of a certified ADA consultant for site evaluations and recommendations as required by Federal and State law. If directed by the Owner to obtain compliance, Owner may make recommendations for such work and additional charges may apply.' },
    // hazmat (1)
    { id: 'k25', group: 'hazmat', title: 'Hazardous waste', text: 'Contractor shall have no obligation to handle (that is, to remove, treat or transport) any substance which is considered hazardous waste or substance under state or federal law ("hazardous waste"). Handling hazardous waste shall be outside the scope of work of this Contract. Title to all hazardous waste shall remain with others and shall not be property of Contractor.' },
    // subs (1)
    { id: 'k26', group: 'subs', title: 'Subcontractor coordination', text: 'Contractor will coordinate the work of named subcontractors; each subcontractor\'s work is warranted by that subcontractor.' },
  ];

  function emptyData() {
    return { version: 1, pin: null,
      settings: {
        company: { name: 'Cantu Electric LLC', person: 'Andy Cantu', phone: '(480) 329-5548', email: 'cantuelectric@cox.net',
          address: '15708 E Chandler Heights Rd, Gilbert, AZ 85298', roc: 'AZ ROC #276507', tagline: 'Licensed, bonded, and insured',
          signName: 'Andy Cantu', plainStyle: false },
        // hidden supports soft delete: Settings can hide a crew member/piece of
        // equipment/clause instead of splicing it, so old bids that reference
        // its id by reference stay valid forever.
        crew: [{ id: 'c1', name: 'Shawn', wageCents: 3200, hidden: false }, { id: 'c2', name: 'George', wageCents: 3000, hidden: false }],
        hoursPerDay: 8, burdenPct: 25, rateCents: 8500, floorCents: 8500, marginPct: 25, markupPct: 18, consumablesPct: 3,
        truckDayCents: 9500, overheadPct: 10, cushionPct: { service: 10, project: 15 }, equipmentPct: 4, validityDays: 30,
        taxMode: 'included',
        equipment: SEED_EQUIPMENT.map((name) => ({ id: uid(), name, costCents: null, overrideDayCents: null, hidden: false })),
        forgetList: SEED_FORGET.slice(), notePhrases: SEED_NOTES.slice(), clauses: SEED_CLAUSES.map((c) => ({ ...c, hidden: false })),
        // ONE. It was seeded at 3053 — one past the last number in his paper
        // book, read off a 2021 proposal — and that was a guess about a book
        // nobody has looked in since. A wrong guess reads as a real number and
        // he would never think to check it; #1 is plainly the app's own
        // starting point and asks to be replaced. The Settings caption tells
        // him to set it to his real next invoice number on day one, and the
        // counter follows whatever he types from there.
        nextNumber: 1, backupEmail: 'adriancantu95@gmail.com',
        // Two different questions. lastBackupAt is the day a backup file last
        // left the phone and it is what the home band nags off.
        // pdfsSentThroughMs is the archive stamp of the newest PROPOSAL PDF
        // that actually left, and it is what decides which PDFs still have to
        // go. Optional on purpose: a backup written before this field existed
        // restores without it and every PDF simply reads as pending, so the
        // document version does not have to move.
        lastBackupAt: null, pdfsSentThroughMs: null },
      catalog: SEED_CATALOG.map(([category, name, unit]) => ({ id: uid(), category, name, unit, lastCostCents: null, uses: 0, hidden: false })),
      customers: [], bids: [] };
  }

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  function isIntGte0(v) { return Number.isInteger(v) && v >= 0; }
  function isIntGte0OrNull(v) { return v === null || isIntGte0(v); }
  function isPct(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100; }
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function isFiniteGte0(v) { return isFiniteNum(v) && v >= 0; }
  function isFiniteGt0(v) { return isFiniteNum(v) && v > 0; }
  function isISO(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function isStr(v) { return typeof v === 'string'; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isArr(v) { return Array.isArray(v); }
  function isBool(v) { return typeof v === 'boolean'; }
  function isIn(v, list) { return list.indexOf(v) !== -1; }
  function strArr(v) { return isArr(v) && v.every(isStr); }

  const STATUS = ['draft', 'sent', 'won', 'lost', 'complete'];
  const DETAIL = ['full', 'summary', 'scope'];
  const JOB_TYPE = ['service', 'project'];
  const LOST_REASON = ['price', 'timing', 'other', 'silence'];
  const CLAUSE_GROUP = ['always', 'gc', 'trench', 'site', 'hazmat', 'subs'];
  // What a did-you-forget row turns into when he taps "Add it": a rental line
  // or a $0 item in one of his areas.
  const FORGET_KIND = ['rental', 'item'];
  // The two answers a did-you-forget row can be in. A row with no key at all
  // is the third state — unanswered — and that is why the field is a map and
  // not a pair of arrays.
  const FORGET_ANSWER = ['no', 'added'];
  const CATALOG_CATEGORY = ['conduit', 'wire', 'boxes', 'lighting', 'gear', 'rentals'];

  // A did-you-forget row is EITHER a plain string or { name, kind }. The list
  // was strings, his phone may still hold strings, and a row he types in
  // Settings is still a string — so a string is not a legacy shape to be
  // migrated away, it is the shape a hand-written row has. Both are read
  // through forgetName/forgetKind and nothing else touches the raw entry.
  function validForgetRow(v) {
    if (isStr(v)) return true;
    if (!isObj(v) || !isStr(v.name)) return false;
    if (v.kind !== undefined && !isIn(v.kind, FORGET_KIND)) return false;
    return true;
  }
  function forgetName(row) { return isStr(row) ? row : (isObj(row) && isStr(row.name) ? row.name : ''); }
  // A row with no kind on it is read off its own words, which is the rule the
  // walk used before the kinds existed: anything that says rental or lift is a
  // rental, his own gear is the tool picker (which the rental branch handles),
  // and everything else is a line in an area.
  function forgetKind(row) {
    if (isObj(row) && isIn(row.kind, FORGET_KIND)) return row.kind;
    const key = forgetName(row).toLowerCase();
    if (key.indexOf('rental') !== -1 || key.indexOf('lift') !== -1) return 'rental';
    if (key.indexOf('equipment') !== -1) return 'rental';
    return 'item';
  }
  const TAX_MODE = ['included', 'added'];

  // -------------------------------------------------------------------------
  // Migration scaffold. No shape change has shipped yet (CURRENT_VERSION is
  // still 1), but every future one lands as a MIGRATIONS[fromVersion] step
  // instead of a rewritten validator, so old exports stay loadable forever.
  // -------------------------------------------------------------------------

  const CURRENT_VERSION = 1;
  const MIGRATIONS = {};

  // Steps the document from whatever version it claims up to CURRENT_VERSION,
  // or returns null if that isn't possible. Refuses (never overwrites) a
  // document from a *newer* version than this build understands — the
  // caller's load() has already stashed the raw text before calling this, so
  // nothing is lost by refusing.
  function migrate(d) {
    if (!isObj(d) || !Number.isInteger(d.version)) return null;
    if (d.version > CURRENT_VERSION) return null;
    let cur = d;
    while (cur.version < CURRENT_VERSION) {
      const step = MIGRATIONS[cur.version];
      if (!step) return null;
      cur = step(cur);
      if (!isObj(cur) || !Number.isInteger(cur.version)) return null;
    }
    return cur;
  }

  // Fail-closed validation: returns the parsed data only if every level of the
  // shape checks out; returns null for anything else. Must NEVER throw — this
  // guards both file imports and every app boot via load().
  function validateImport(text) {
    let d;
    try { d = JSON.parse(text); } catch { return null; }
    try {
      d = migrate(d);
      if (!d) return null;
      if (d.pin !== null && !(typeof d.pin === 'string' && /^\d{4}$/.test(d.pin))) return null;

      const s = d.settings;
      if (!isObj(s)) return null;
      for (const k of ['rateCents', 'floorCents', 'truckDayCents', 'hoursPerDay', 'nextNumber', 'validityDays']) {
        if (!isIntGte0(s[k])) return null;
      }
      for (const k of ['burdenPct', 'marginPct', 'markupPct', 'consumablesPct', 'overheadPct', 'equipmentPct']) {
        if (!isPct(s[k])) return null;
      }
      if (!isObj(s.cushionPct) || !isPct(s.cushionPct.service) || !isPct(s.cushionPct.project)) return null;
      if (!isIn(s.taxMode, TAX_MODE)) return null;

      const co = s.company;
      if (!isObj(co)) return null;
      for (const k of ['name', 'person', 'phone', 'email', 'address', 'roc', 'tagline', 'signName']) {
        if (!isStr(co[k])) return null;
      }
      if (!isBool(co.plainStyle)) return null;

      if (!isArr(s.crew)) return null;
      const crewIds = new Set();
      for (const c of s.crew) {
        if (!isObj(c) || !isStr(c.id) || c.id === '' || crewIds.has(c.id)) return null;
        crewIds.add(c.id);
        if (!isStr(c.name) || !isIntGte0(c.wageCents) || !isBool(c.hidden)) return null;
      }

      if (!isArr(s.equipment)) return null;
      const equipIds = new Set();
      for (const e of s.equipment) {
        if (!isObj(e) || !isStr(e.id) || e.id === '' || equipIds.has(e.id)) return null;
        equipIds.add(e.id);
        if (!isStr(e.name) || !isIntGte0OrNull(e.costCents) || !isIntGte0OrNull(e.overrideDayCents) || !isBool(e.hidden)) return null;
      }

      if (!isArr(s.forgetList) || !s.forgetList.every(validForgetRow)) return null;
      if (!strArr(s.notePhrases)) return null;

      if (!isArr(s.clauses)) return null;
      const clauseIds = new Set();
      for (const c of s.clauses) {
        if (!isObj(c) || !isStr(c.id) || c.id === '' || clauseIds.has(c.id)) return null;
        clauseIds.add(c.id);
        if (!isIn(c.group, CLAUSE_GROUP) || !isStr(c.title) || !isStr(c.text) || !isBool(c.hidden)) return null;
      }

      if (!isStr(s.backupEmail)) return null;
      if (s.lastBackupAt !== null && !isISO(s.lastBackupAt)) return null;
      // Absent is as good as null here — see emptyData. An old backup file
      // has no such key and must still restore.
      if (s.pdfsSentThroughMs !== undefined && s.pdfsSentThroughMs !== null
          && !isIntGte0(s.pdfsSentThroughMs)) return null;

      if (!isArr(d.catalog)) return null;
      const catalogIds = new Set();
      for (const p of d.catalog) {
        if (!isObj(p) || !isStr(p.id) || p.id === '' || catalogIds.has(p.id)) return null;
        catalogIds.add(p.id);
        if (!isIn(p.category, CATALOG_CATEGORY) || !isStr(p.name) || !isStr(p.unit)) return null;
        if (!isIntGte0OrNull(p.lastCostCents) || !isIntGte0(p.uses) || !isBool(p.hidden)) return null;
      }

      if (!isArr(d.customers)) return null;
      const customerIds = new Set();
      for (const c of d.customers) {
        if (!isObj(c) || !isStr(c.id) || c.id === '' || customerIds.has(c.id)) return null;
        customerIds.add(c.id);
        if (!isStr(c.name) || !isStr(c.contact) || !isStr(c.email) || !isStr(c.phone)) return null;
        if (!isIn(c.defaultDetail, DETAIL)) return null;
      }

      function validAreaItem(it) {
        if (!isObj(it)) return false;
        if (it.catalogId !== null && !catalogIds.has(it.catalogId)) return false;
        if (!isStr(it.name) || !isStr(it.unit) || !isFiniteGt0(it.qty)) return false;
        if (!isIntGte0(it.costCents)) return false;
        if (it.priceCents !== null && !isIntGte0(it.priceCents)) return false;
        return true;
      }
      // Area ids only need to be unique *within* the array passed in — once
      // for a bid's own top-level areas, and separately for each change
      // order's own areas — not globally across the whole document.
      function validAreas(areas) {
        if (!isArr(areas)) return false;
        const areaIds = new Set();
        for (const a of areas) {
          if (!isObj(a) || !isStr(a.id) || a.id === '' || areaIds.has(a.id)) return false;
          areaIds.add(a.id);
          if (!isStr(a.name)) return false;
          if (!isArr(a.items) || !a.items.every(validAreaItem)) return false;
          if (!strArr(a.photoIds)) return false;
        }
        return true;
      }
      function validLabor(labor) {
        if (!isObj(labor)) return false;
        if (!isArr(labor.crewIds) || !labor.crewIds.every((id) => crewIds.has(id))) return false;
        // OPTIONAL: what each man was put on this bid at. Absent means the bid
        // is older than the rule and reads Settings, which is how the v1 and
        // v2 fixtures keep pricing to the cent.
        //
        // The keys are NOT checked against the crew: a wage stamped for
        // somebody later taken off this bid and then deleted in Settings is a
        // stale key, not a broken file, and refusing it would take the whole
        // backup down over a number nothing reads.
        if (labor.wageCents !== undefined && labor.wageCents !== null) {
          if (!isObj(labor.wageCents)) return false;
          for (const k of Object.keys(labor.wageCents)) {
            if (!isIntGte0(labor.wageCents[k])) return false;
          }
        }
        if (!isFiniteGte0(labor.days)) return false;
        if (labor.tasks !== null) {
          if (!isArr(labor.tasks)) return false;
          for (const t of labor.tasks) {
            if (!isObj(t) || !isStr(t.name)) return false;
            if (!isArr(t.crewIds) || !t.crewIds.every((id) => crewIds.has(id))) return false;
            if (!isFiniteGte0(t.days)) return false;
          }
        }
        return true;
      }

      if (!isArr(d.bids)) return null;
      const bidIds = new Set();
      for (const b of d.bids) {
        if (!isObj(b) || !isStr(b.id) || b.id === '' || bidIds.has(b.id)) return null;
        bidIds.add(b.id);
        if (!isIntGte0(b.number)) return null;
        if (!customerIds.has(b.customerId)) return null;
        if (!isStr(b.title) || !isISO(b.dateISO)) return null;
        if (!isIn(b.status, STATUS) || !isIn(b.detail, DETAIL) || !isIn(b.jobType, JOB_TYPE)) return null;
        if (!validAreas(b.areas)) return null;
        if (!isObj(b.misc) || !isStr(b.misc.label) || !isIntGte0(b.misc.cents)) return null;
        if (!validLabor(b.labor)) return null;
        if (!isArr(b.rentals)) return null;
        for (const r of b.rentals) {
          if (!isObj(r) || !isStr(r.name) || !isFiniteGte0(r.days) || !isIntGte0(r.cents) || !isBool(r.markup)) return null;
        }
        if (!isArr(b.equipment)) return null;
        for (const e of b.equipment) {
          if (!isObj(e)) return null;
          if (e.equipmentId !== null && !equipIds.has(e.equipmentId)) return null;
          if (!isStr(e.name) || !isFiniteGte0(e.days) || !isIntGte0(e.dayCents)) return null;
        }
        if (!isObj(b.pricing) || !isFiniteNum(b.pricing.marginPct) || !isIntGte0(b.pricing.rateCents)) return null;
        // The cushion may be NEGATIVE. A cushion is normally hours he quotes
        // and hopes not to work, but the price screen lets him type the bid
        // hours directly, and typing FEWER hours than the job really takes is
        // a decision he is allowed to make with his eyes open (the screen says
        // so in red). BidMath.cushionForBidHours back-solves that to a
        // negative percentage, and refusing it here would bounce the save of a
        // number he can see on the glass. A widening of the old rule, so every
        // file written before it still loads and no migration is needed.
        if (!isFiniteNum(b.pricing.cushionPct) || !isFiniteGte0(b.pricing.markupPct)) return null;
        // OPTIONAL, like forgetAnswers below: "he has moved a handle on this
        // bid", written by the price screen and read only by the step strip.
        // Every file written before it exists has no such key and must still
        // load, so absent is legal and only a non-boolean is an error.
        if (b.pricing.touched !== undefined && !isBool(b.pricing.touched)) return null;
        // OPTIONAL, all five: the cost-side numbers this bid was figured at.
        // Absent is a bid written before "Settings never change an existing
        // bid" and it reads Settings, so no file anywhere stops loading.
        for (const k of ['burdenPct', 'consumablesPct', 'overheadPct']) {
          if (b.pricing[k] !== undefined && !isPct(b.pricing[k])) return null;
        }
        if (b.pricing.hoursPerDay !== undefined && !(isIntGte0(b.pricing.hoursPerDay) && b.pricing.hoursPerDay > 0)) return null;
        if (b.pricing.truckDayCents !== undefined && !isIntGte0(b.pricing.truckDayCents)) return null;
        // OPTIONAL on purpose, so no version bump and no migration: a backup
        // written before the did-you-forget answers were saved has no such key
        // and must still restore, with every row simply reading as unanswered.
        // The keys are the row names out of settings.forgetList, which he can
        // rename in Settings — so a key that matches no current row is not an
        // error, it is an answer to a question he no longer asks.
        if (b.forgetAnswers !== undefined && b.forgetAnswers !== null) {
          if (!isObj(b.forgetAnswers)) return null;
          for (const k of Object.keys(b.forgetAnswers)) {
            if (!isIn(b.forgetAnswers[k], FORGET_ANSWER)) return null;
          }
        }
        if (b.scope !== null && !strArr(b.scope)) return null;
        if (!strArr(b.notes)) return null;
        // null means he has not been asked yet — the proposal screen seeds the
        // Always group on that and only that. An empty array is an answer: he
        // looked at the library and wants none of it, and nothing re-seeds it.
        if (b.clauseIds !== null
          && (!strArr(b.clauseIds) || !b.clauseIds.every((id) => clauseIds.has(id)))) return null;
        if (!isIntGte0(b.validityDays)) return null;
        if (b.sentAt !== null && !isISO(b.sentAt)) return null;
        if (b.savedToFilesAt !== null && !isISO(b.savedToFilesAt)) return null;
        if (b.lostReason !== null && !isIn(b.lostReason, LOST_REASON)) return null;
        if (b.job !== null) {
          const j = b.job;
          if (!isObj(j)) return null;
          if (!isArr(j.weeks)) return null;
          for (const w of j.weeks) {
            if (!isObj(w) || !isISO(w.weekISO) || !isFiniteGte0(w.hours)) return null;
          }
          if (!isArr(j.surprises)) return null;
          for (const sp of j.surprises) {
            if (!isObj(sp) || !isIntGte0(sp.cents) || !isStr(sp.note) || !isISO(sp.at)) return null;
          }
          if (!isArr(j.changeOrders)) return null;
          // Ids unique within the bid, the way area ids are: the screens
          // address a change order by id (Scope, Labor, delete), and two that
          // answer to the same one is an edit landing on the wrong work.
          const coIds = new Set();
          for (const co2 of j.changeOrders) {
            if (!isObj(co2) || !isStr(co2.id) || co2.id === '' || coIds.has(co2.id)) return null;
            coIds.add(co2.id);
            if (!isStr(co2.name)) return null;
            if (!validAreas(co2.areas)) return null;
            if (!validLabor(co2.labor)) return null;
            // priceCents is no longer written or read — a change order's price
            // is derived from its own areas and labor by
            // BidMath.changeOrderPrice. Documents written before that change
            // still carry the cached number, so it is accepted when present
            // (and must still be a sane integer) and simply ignored.
            if (co2.priceCents !== undefined && !isIntGte0(co2.priceCents)) return null;
          }
          if (j.completedAt !== null && !isISO(j.completedAt)) return null;
        }
      }

      return d;
    } catch { return null; }
  }

  // -------------------------------------------------------------------------
  // Persistence (browser-only; guarded so Node tests never touch it unless a
  // test installs its own localStorage stub)
  // -------------------------------------------------------------------------

  // 'corrupt' after a load() that found data but couldn't validate it (and
  // stashed the raw text under a side key so nothing is silently lost); null
  // otherwise, including after a load() that found nothing at all.
  let lastLoadProblem = null;
  function loadProblem() { return lastLoadProblem; }

  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
      if (!raw) { lastLoadProblem = null; return emptyData(); }
      const d = validateImport(raw);
      if (d) { lastLoadProblem = null; return d; }
      try { localStorage.setItem(KEY + '-corrupt-' + Date.now(), raw); } catch { /* best effort */ }
      lastLoadProblem = 'corrupt';
      return emptyData();
    } catch {
      lastLoadProblem = null;
      return emptyData();
    }
  }

  // Never mints an unloadable document: refuses (and never writes) anything
  // that wouldn't itself pass validateImport on the next load. Returns a
  // boolean instead of throwing.
  function save(d) {
    const json = JSON.stringify(d);
    if (!validateImport(json)) return false;
    try { localStorage.setItem(KEY, json); return true; } catch { return false; }
  }

  // True if `d` would survive its own validateImport round-trip. Cheap
  // pre-flight check for UI code before it calls save().
  function check(d) { return !!validateImport(JSON.stringify(d)); }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function findOrCreateCustomer(d, name) {
    const n = name.trim(); const hit = d.customers.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit;
    const c = { id: uid(), name: n, contact: '', email: '', phone: '', defaultDetail: 'full' }; d.customers.push(c); return c;
  }
  // The handful of dollars nobody itemizes and everybody spends. ONE name for
  // it, and it lives HERE rather than in ui.js with the rest of the shared
  // wording for one reason: storage.js is loaded first and cannot read ui.js,
  // but ui.js can read Store. newBid stamps it onto every new bid, the walk
  // and the Costs & price screen fall back to it on a bid that has none, and
  // all three now read the same string. They used to be three copies, and two
  // of them said "Misc hardware" — one line reading as two things.
  const MISC_LABEL = 'Supports, anchors, and hardware';

  // -------------------------------------------------------------------------
  // SETTINGS NEVER CHANGE AN EXISTING BID
  // -------------------------------------------------------------------------
  // Every number that feeds a price is copied onto the bid the day it is
  // written, and the bid reads its own copy forever after. BidMath.bidSetting
  // and BidMath.crewWage are the reading half of the same rule; these two are
  // the writing half.
  //
  // Optional fields with a Settings fallback, so a bid written before this
  // existed prices exactly as it always did and no version has to move.
  function wageSnapshot(s, crewIds) {
    const map = {};
    crewIds.forEach((id) => {
      const c = s.crew.find((x) => x.id === id);
      if (c && Number.isInteger(c.wageCents)) map[id] = c.wageCents;
    });
    return map;
  }

  // A man joining a bid AFTER it was written gets his wage stamped on the way
  // in, on his first line: what he is paid the day he goes on this job is what
  // this job pays him, and a raise next month leaves it alone. Returns an undo
  // for persistOr, or null when there was nothing to write (he is already on
  // the bid, or the bid is too old to have a map and must keep falling back).
  function noteCrewWage(bid, crewId, settings) {
    if (!bid || !bid.labor || !crewId) return null;
    const map = bid.labor.wageCents;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    if (Object.prototype.hasOwnProperty.call(map, crewId)) return null;
    const c = settings.crew.find((x) => x.id === crewId);
    if (!c || !Number.isInteger(c.wageCents)) return null;
    map[crewId] = c.wageCents;
    return () => { delete map[crewId]; };
  }

  // The one note a new bid arrives with, and only on the bids that need it.
  // "Prices subject to change; final pricing based on actual material." is the
  // sentence that keeps a jump in copper from being his to eat, and it is true
  // of every job he writes. A Scope & price bid starts with NO notes: that
  // paper carries the terms page, and the terms page already says how long the
  // price is good for.
  //
  // The phrase is looked up in his own list rather than pushed in blind, so a
  // bid never prints a sentence that is not a chip he can tap off. If he has
  // deleted it, the first phrase he does have stands in, and an empty list
  // seeds nothing.
  function seedNotes(s, detail) {
    if (detail === 'scope') return [];
    const list = s.notePhrases || [];
    if (list.indexOf(SEED_DEFAULT_NOTE) !== -1) return [SEED_DEFAULT_NOTE];
    return list.length ? [list[0]] : [];
  }

  function newBid(d, { customerName, title, jobType, dateISO }) {
    const cust = findOrCreateCustomer(d, customerName); const s = d.settings;
    const jt = JOB_TYPE.indexOf(jobType) !== -1 ? jobType : 'service';
    const detail = DETAIL.indexOf(cust.defaultDetail) !== -1 ? cust.defaultDetail : 'full';
    const crewSeed = s.crew.filter((c) => !c.hidden).slice(0, 2).map((c) => c.id);
    const b = { id: uid(), number: s.nextNumber, customerId: cust.id, title: title || '', dateISO: dateISO || todayISO(),
      status: 'draft', detail, jobType: jt,
      areas: [], misc: { label: MISC_LABEL, cents: 0 },
      // Hidden crew are people who don't work here any more: seeding them onto
      // a new bid would put a chip on the Labor screen for someone he'd have to
      // notice and take off, and would bill their wage until he did.
      labor: { crewIds: crewSeed, days: 0, tasks: null, wageCents: wageSnapshot(s, crewSeed) },
      rentals: [], equipment: [],
      // What he has already answered on the did-you-forget checklist, by row
      // name: 'no' (not on this job) or 'added' (it is on the bid now). A row
      // that is not a key here has not been answered. These used to live in a
      // Set that died with the screen, so seven checkmarks turned back into
      // seven questions the next time he opened the bid.
      forgetAnswers: {},
      // No stored priceCents here: the sell price is always derived from the
      // (rounded) rate below, never persisted as its own independent number.
      //
      // marginPct is a SNAPSHOT of the margin at the last handle move, kept so
      // the field a bid was created with survives a round trip — it is NOT a
      // live figure. Every cost-side edit after that move (a rental, a change
      // to overhead, another day of labor) changes the real margin and leaves
      // this number exactly where it was. The live margin is always
      //
      //     BidMath.solve(stack, 'rate', pricing.rateCents).marginPct
      //
      // which is what the price screen displays. Reports must compute it that
      // way and never read this field.
      // The five cost-side numbers are snapshotted alongside the three
      // price-side ones. Settings sets what a NEW bid starts at, and stops
      // there: nothing typed in Settings tomorrow reaches this bid.
      pricing: { marginPct: s.marginPct, rateCents: s.rateCents, cushionPct: s.cushionPct[jt], markupPct: s.markupPct,
        hoursPerDay: s.hoursPerDay, burdenPct: s.burdenPct, consumablesPct: s.consumablesPct,
        truckDayCents: s.truckDayCents, overheadPct: s.overheadPct },
      // clauseIds starts null, not empty: "not chosen yet" is what lets the
      // proposal screen offer the Always group once and never argue with him
      // about it again. [] is his answer, and it sticks.
      scope: null, notes: seedNotes(s, detail), clauseIds: null, validityDays: s.validityDays,
      sentAt: null, savedToFilesAt: null, lostReason: null, job: null };
    s.nextNumber += 1; return b;
  }
  // The empty job a bid gets the moment it is Won. It lives here, not in the
  // bid screen, so the shape the screens write and the shape validateImport
  // checks are one definition.
  function newJob() { return { weeks: [], surprises: [], changeOrders: [], completedAt: null }; }

  // Has anything been logged against this job yet? The bid screen asks before
  // it offers to undo a Won: a mis-tap costs one tap to put back, but a job
  // with a week of hours or a change order in it holds work that was never
  // written down anywhere else, and no undo may throw that away. A job that is
  // finished counts as logged even if it is otherwise bare, so a completed
  // job is never mistaken for an untouched one.
  function jobIsEmpty(job) {
    // No job block at all is the emptiest a job gets: there is nothing in it
    // to lose. Anything that is not a job object is refused instead, because
    // a shape this cannot read is a shape it cannot promise is bare.
    if (job === null || job === undefined) return true;
    if (typeof job !== 'object') return false;
    if (job.completedAt !== null && job.completedAt !== undefined) return false;
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    return len(job.weeks) === 0 && len(job.surprises) === 0 && len(job.changeOrders) === 0;
  }

  // A change order is a small bid inside the job: areas and labor, nothing
  // else. Its crew is seeded the way a new bid's is — the visible crew, first
  // two — because the men already on the job are the men who do the extra.
  //
  // No stored price, for the same reason a bid has none: the sell price is
  // always BidMath.changeOrderPrice off the areas and labor below, so it
  // cannot go stale between the screen that edits the work and the paper that
  // quotes it.
  //
  // Its men are stamped onto the PARENT BID's wage snapshot rather than onto a
  // second map of its own: a change order is priced on the bid's terms, and
  // one place for "what this job pays a man" is one answer. bid is optional so
  // the older two-argument call still works.
  function newChangeOrder(d, name, bid) {
    const s = d.settings;
    const crewIds = s.crew.filter((c) => !c.hidden).slice(0, 2).map((c) => c.id);
    if (bid) crewIds.forEach((id) => noteCrewWage(bid, id, s));
    return {
      id: uid(), name: String(name || ''), areas: [],
      labor: { crewIds, days: 0, tasks: null },
    };
  }
  function duplicateBid(d, bidId, dateISO) {
    const src = d.bids.find((b) => b.id === bidId); if (!src) return null;
    const c = JSON.parse(JSON.stringify(src));
    c.id = uid(); c.number = d.settings.nextNumber; d.settings.nextNumber += 1;
    // forgetAnswers is cleared with the job and the sent flags for the same
    // reason: the copy is a bid he has not walked yet. Carrying last month's
    // "No, no permits on this one" onto a new building answers a question
    // nobody asked, and answers it wrong.
    c.dateISO = dateISO || todayISO(); c.status = 'draft'; c.sentAt = null; c.savedToFilesAt = null; c.lostReason = null; c.job = null;
    c.forgetAnswers = {};
    // Areas are re-ided so the copy's rooms are its own — and anything that
    // POINTS at an area has to follow them. A walk rental carries the area it
    // was added from; left holding the original's id it either shows in no
    // room at all or, worse, in whichever room of the original still has that
    // id. The map is built while the ids are being handed out, so there is no
    // second pass to forget to update when something else starts pointing at
    // an area.
    const areaIdMap = new Map();
    c.areas.forEach((a) => { const was = a.id; a.id = uid(); areaIdMap.set(was, a.id); a.photoIds = []; });
    (c.rentals || []).forEach((r) => {
      if (!r || typeof r.areaId !== 'string') return;
      // A rental named on the Costs & price screen has no area, and one whose
      // area was deleted points at nothing: both lose the field rather than
      // keeping a dead id.
      if (areaIdMap.has(r.areaId)) r.areaId = areaIdMap.get(r.areaId);
      else delete r.areaId;
    });
    d.bids.push(c); return c;
  }
  function addCatalogItem(d, { category, name, unit }) {
    const cat = CATALOG_CATEGORY.indexOf(category) !== -1 ? category : 'gear';
    // Straightened, never lowercased: his capitals are his, and a curly quote
    // off the phone keyboard would otherwise make a second "1” EMT" that the
    // search for 1" EMT never finds.
    const nm = Catalog.straighten(name);
    if (!nm) return null;
    const un = String(unit || '');
    const p = { id: uid(), category: cat, name: nm, unit: un, lastCostCents: null, uses: 0, hidden: false };
    d.catalog.push(p); return p;
  }
  // A tool he owns, added from Settings or from the price screen's picker.
  // Both doors build the same entry here rather than each writing the shape
  // out again: a tool that reached the file missing overrideDayCents or
  // hidden would be refused by the validator on the very next save, and the
  // save that refuses would be some later, unrelated edit.
  //
  // A cost is required and has to be real money. equipmentDayCents figures a
  // day rate as a share of it, so a tool with no cost has no rate and the
  // picker cannot quote it; zero is worse, because it quotes it at nothing.
  // Pushes onto d.settings.equipment and returns the entry, or returns null
  // and pushes nothing if the name or the cost will not do — the caller
  // reverts by splicing the entry it got back.
  function newTool(d, name, costCents) {
    const nm = String(name == null ? '' : name).trim();
    if (!nm) return null;
    if (!Number.isInteger(costCents) || !(costCents > 0)) return null;
    const t = { id: uid(), name: nm, costCents, overrideDayCents: null, hidden: false };
    d.settings.equipment.push(t);
    return t;
  }
  // A tool Settings already has under this name. Case-insensitive and blind to
  // the spaces either side of it, because the picker is a list of names and
  // "bender", "Bender " and "Bender" are one tool in his head — he added five
  // of them before this existed. Only the tools Settings still OFFERS count:
  // the picker hides put-away ones, so "already exists" has to mean "already
  // in the list you were just looking at", and typing the name of a tool he
  // put away is how he asks for it back as a new one.
  function findEquipmentByName(d, name) {
    const key = String(name == null ? '' : name).trim().toLowerCase();
    if (!key) return null;
    return d.settings.equipment.find(
      (e) => e.hidden === false && String(e.name == null ? '' : e.name).trim().toLowerCase() === key
    ) || null;
  }

  // The line for this tool that is ALREADY on this bid, if there is one. Days
  // is the quantity on an equipment line, so a second line for the same tool is
  // never the answer: two "Bender" rows on one bid bill twice, read as two
  // benders, and are exactly the mistake the Settings-side name check was
  // written for. The picker offers every tool whether or not it is on the bid,
  // and it should — he taps it to CHANGE the days as often as to add it — so
  // the check lives here, where both doors into the list can ask it.
  function bidEquipmentLine(bid, equipmentId) {
    if (!bid || !equipmentId) return null;
    return (bid.equipment || []).find((e) => e && e.equipmentId === equipmentId) || null;
  }

  // -------------------------------------------------------------------------
  // THE STANDARD LIBRARIES, ON A PHONE THAT ALREADY HAS DATA
  // -------------------------------------------------------------------------
  // A seed only ever runs on a fresh install: emptyData() is the whole of it,
  // and a phone with a catalog of its own must never have this list dropped on
  // top of what he has built. But the v2.1 libraries are three times the size
  // of the v2 ones, and a phone that has been in use for a month should not be
  // stuck with the short list forever.
  //
  // So: ADD THE MISSING NAMES, AND NOTHING ELSE. Case-insensitive and blind to
  // the spaces around a name, because "bender", "Bender " and "Bender" are one
  // tool in his head. Nothing is renamed, nothing is re-costed, nothing is
  // unhidden, and a part he hid on purpose is not quietly re-added underneath
  // him. Each returns the number of names it added, which is what the banner
  // says out loud.
  function addStandardCatalog(d) {
    const have = new Set((d.catalog || []).map((p) => Catalog.normalizeName(p.name)));
    let added = 0;
    SEED_CATALOG.forEach(([category, name, unit]) => {
      if (have.has(Catalog.normalizeName(name))) return;
      have.add(Catalog.normalizeName(name));
      d.catalog.push({ id: uid(), category, name, unit, lastCostCents: null, uses: 0, hidden: false });
      added += 1;
    });
    return added;
  }

  function lowerKey(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  function addStandardEquipment(d) {
    const list = d.settings.equipment;
    const have = new Set(list.map((e) => lowerKey(e.name)));
    let added = 0;
    SEED_EQUIPMENT.forEach((name) => {
      if (have.has(lowerKey(name))) return;
      have.add(lowerKey(name));
      list.push({ id: uid(), name, costCents: null, overrideDayCents: null, hidden: false });
      added += 1;
    });
    return added;
  }

  // The two lists of plain rows. A seeded row carries its kind; a row already
  // on his phone keeps whatever shape it has.
  function addStandardForget(d) {
    const list = d.settings.forgetList;
    const have = new Set(list.map((r) => lowerKey(forgetName(r))));
    let added = 0;
    SEED_FORGET.forEach((row) => {
      if (have.has(lowerKey(row.name))) return;
      have.add(lowerKey(row.name));
      list.push({ name: row.name, kind: row.kind });
      added += 1;
    });
    return added;
  }

  function addStandardNotes(d) {
    const list = d.settings.notePhrases;
    const have = new Set(list.map(lowerKey));
    let added = 0;
    SEED_NOTES.forEach((text) => {
      if (have.has(lowerKey(text))) return;
      have.add(lowerKey(text));
      list.push(text);
      added += 1;
    });
    return added;
  }

  // TERMS ARE NOT ADDED TO, THEY ARE REPLACED. The other four libraries grow:
  // a part he does not have is a part he might want. The clause library is the
  // opposite — the whole point of the rewrite is that the nineteen clauses
  // that used to be seeded are the WRONG paper for his own proposals, and
  // leaving them alongside the eight new ones would put both on the same
  // phone under the same heading.
  //
  // So the old ones go, except the ones a bid still names: those are hidden,
  // which is the only kind of delete this file allows for anything a bid
  // points at (DocModel drops a hidden clause off the paper, and the bid keeps
  // validating). The standard set comes in with FRESH ids, so it can never
  // collide with an id a hidden clause is still holding.
  //
  // Returns what happened, in the numbers the confirm and the banner say.
  function resetClauseLibrary(d) {
    const s = d.settings;
    const before = s.clauses;
    const kept = [];
    let hidden = 0, removed = 0;
    before.forEach((c) => {
      if (clauseInUse(d, c.id) > 0) {
        kept.push({ ...c, hidden: true });
        hidden += 1;
      } else {
        removed += 1;
      }
    });
    const fresh = SEED_CLAUSES.map((c) => ({ ...c, id: uid(), hidden: false }));
    s.clauses = kept.concat(fresh);
    return { added: fresh.length, hidden, removed };
  }

  // -------------------------------------------------------------------------
  // WHAT IS STILL POINTED AT
  // -------------------------------------------------------------------------
  // Settings soft-deletes everything because an old bid holds ids, and a bid
  // holding an id nothing answers is a bid validateImport refuses to load —
  // the whole file, not just that bid. But most of what he puts away is not on
  // a single bid: a tool he bought and never used, a clause he wrote and never
  // ticked, a part he added by mistake. Hiding those leaves a list that only
  // ever grows.
  //
  // So each of these counts the BIDS that still point at one id. Zero means
  // nothing anywhere refers to it and Settings can really delete it; anything
  // else is the number the caption says out loud ("On 2 bids, so it can be
  // hidden but not deleted"). A count rather than a boolean for exactly that
  // reason — the sentence needs the number, and two functions that had to
  // agree about the same question would be one too many.
  //
  // Change orders count. Their areas hold catalog ids and their labor holds
  // crew ids, and they are inside a bid the validator walks.
  function bidsReferencing(d, test) {
    return (d.bids || []).filter((b) => {
      try { return !!test(b); } catch (e) { return false; }
    }).length;
  }

  function changeOrdersOf(b) { return (b.job && b.job.changeOrders) || []; }

  function equipmentInUse(d, id) {
    return bidsReferencing(d, (b) => (b.equipment || []).some((e) => e.equipmentId === id));
  }

  function crewInUse(d, id) {
    const inLabor = (labor) => {
      if (!labor) return false;
      if ((labor.crewIds || []).indexOf(id) !== -1) return true;
      return (labor.tasks || []).some((t) => (t.crewIds || []).indexOf(id) !== -1);
    };
    return bidsReferencing(d, (b) => inLabor(b.labor) || changeOrdersOf(b).some((co) => inLabor(co.labor)));
  }

  function catalogInUse(d, id) {
    const inAreas = (areas) => (areas || []).some((a) => (a.items || []).some((it) => it.catalogId === id));
    return bidsReferencing(d, (b) => inAreas(b.areas) || changeOrdersOf(b).some((co) => inAreas(co.areas)));
  }

  function clauseInUse(d, id) {
    return bidsReferencing(d, (b) => (b.clauseIds || []).indexOf(id) !== -1);
  }

  function recordCatalogUse(d, id, costCents) { const p = d.catalog.find((x) => x.id === id); if (p) { p.uses += 1; p.lastCostCents = costCents; } }
  function numberInUse(d, number, exceptBidId) { return d.bids.some((b) => b.number === number && b.id !== exceptBidId); }

  return { KEY, MISC_LABEL, uid, todayISO, mondayOf, jobWeekWindow, emptyData, validateImport, load, save, check, loadProblem,
    forgetName, forgetKind, SEED_DEFAULT_NOTE,
    findOrCreateCustomer, newBid, newJob, jobIsEmpty, newChangeOrder, duplicateBid, noteCrewWage, addCatalogItem, newTool, findEquipmentByName, bidEquipmentLine, equipmentInUse, crewInUse, catalogInUse, clauseInUse,
    addStandardCatalog, addStandardEquipment, addStandardForget, addStandardNotes, resetClauseLibrary,
    recordCatalogUse, numberInUse };
});
