// storage.js — persistence layer. UMD so node:test and the browser both load it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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

  // -------------------------------------------------------------------------
  // Seed data
  // -------------------------------------------------------------------------

  const SEED_CATALOG = [
    ['conduit','1/2" EMT','ft'],['conduit','3/4" EMT','ft'],['conduit','1" EMT','ft'],['conduit','1-1/4" EMT','ft'],
    ['conduit','3/4" rigid','ft'],['conduit','1" rigid','ft'],['conduit','3/4" S.S. conduit','ft'],['conduit','1" S.S. conduit','ft'],
    ['conduit','3/4" seal-tight','ft'],['conduit','1" seal-tight','ft'],['conduit','3/4" PVC','ft'],['conduit','1" PVC','ft'],
    ['wire','#12 THHN','roll'],['wire','#10 THHN','roll'],['wire','#8 THHN','ft'],['wire','#6 THHN','ft'],['wire','#4 THHN','ft'],
    ['wire','#2 THHN','ft'],['wire','10/4 SO cord','ft'],['wire','12/4 SO cord','ft'],['wire','10/4 VFD cable','ft'],['wire','Cat6','ft'],
    ['boxes','3/4" hubs','ea'],['boxes','1" hubs','ea'],['boxes','3/4" S.S. hubs','ea'],['boxes','LB 3/4"','ea'],['boxes','LB 1"','ea'],
    ['boxes','3/4" couplings','ea'],['boxes','3/4" connectors','ea'],['boxes','J-box 4x4','ea'],['boxes','J-box 8x8x4','ea'],
    ['boxes','J-box 10x10x6','ea'],['boxes','Cord grips','ea'],['boxes','S.S. cord grips','ea'],['boxes','Straps & supports','lot'],
    ['lighting','LED high bay','ea'],['lighting','LED strip 4 ft','ea'],['lighting','Emergency light fixture','ea'],['lighting','Exit sign','ea'],
    ['lighting','T8 LED tube','ea'],['lighting','T5 bulb','ea'],['lighting','Motion sensor','ea'],['lighting','Photocell','ea'],['lighting','Wall pack','ea'],
    ['gear','20 A breaker','ea'],['gear','30 A breaker','ea'],['gear','3-pole 480 V breaker','ea'],['gear','3-pole disconnect','ea'],
    ['gear','30 A disconnect','ea'],['gear','60 A disconnect','ea'],['gear','Contactor','ea'],['gear','Motor starter','ea'],['gear','VFD','ea'],
    ['gear','Pin & sleeve','ea'],['gear','Receptacle 20 A','ea'],['gear','Switch 3-way','ea'],['gear','Photo eye','ea'],['gear','Shrink tube, tape, crimps','lot'],
    ['rentals','Boom lift','day'],['rentals','Scissor lift','day'],['rentals','Trencher','day'],['rentals','Dumpster','ea'],
  ];
  const SEED_EQUIPMENT = ['Threader', 'Generator', 'Tugger', 'Concrete saw', 'Core drill', 'Bender'];
  const SEED_FORGET = ['Lift rental', 'Equipment', 'Permits', 'Disposal', 'Trenching', 'Travel days', 'Sub-contractor'];
  const SEED_NOTES = ['Prices subject to change; final pricing based on actual material.',
    'Disconnect to be supplied by customer.', 'Does not include lift rental.', 'Stainless supports and brackets to be installed by welders.'];

  // Clause library, transcribed verbatim from the owner's own past proposal
  // (Cantu Electric LLC. Addendum Terms and Conditions, numbered clauses
  // 1-23, plus two clauses lifted from that same proposal's page-1 "Notes"
  // bullets, plus one new one-sentence clause for subcontractor jobs).
  // NOTE FOR REVIEW: this library has not been reviewed by an
  // attorney/accountant. "provided by Owner, Owner, Architect" in clause 18
  // (Right to rely) repeats "Owner" as written in the source document — left
  // verbatim since it is not an unambiguous OCR-style error.
  const SEED_CLAUSES = [
    // always (19)
    { id: 'k01', group: 'always', title: 'Work', text: 'Contractor will furnish all necessary labor, materials, and equipment to complete the work specified in the Contract (the "Work"). All surfaces to which material is to be applied shall be in a condition similar to the condition at the time the project was bid. Owner shall specify one representative to represent the Owner who has authority to accept the Work and authorize changes to the Work. Owner shall provide reasonable access to a water supply source. Owner grants Contractor permission to utilize photos and videos of the Work and the project site in the promotion of Contractor\'s business services.' },
    { id: 'k02', group: 'always', title: 'Payment', text: 'Contractor shall be paid a monthly progress payment within 15 days after receipt of the payment by the Owner for the value of work performed. Final payment, including all retention, shall be due 15 days after the work described in the Proposal is substantially completed. No provision of this agreement shall serve to void the Contractor\'s entitlement to payment for properly performed work.' },
    { id: 'k03', group: 'always', title: 'Interest and expenses', text: 'All sums not paid when due shall bear an interest rate of 1 1/2% per month or the maximum legal rate permitted by law, whichever is less, and all costs of collection, including a reasonable attorneys\' fee, shall be paid by Owner.' },
    { id: 'k04', group: 'always', title: "Attorneys' fees", text: 'In the event of litigation regarding the Contract or collection efforts by Contractor, the prevailing party shall be awarded its reasonable attorneys\' fees and costs, which shall include all costs that would normally be passed through to the client, specifically but not limited to research charges, travel costs, expert witness costs, copying costs, mailing costs, facsimile costs, hand-delivery costs, Federal Express or Express Mail costs, taxable costs and disbursements.' },
    { id: 'k05', group: 'always', title: 'Continued performance', text: 'Nothing in this Contract shall require the Contractor to continue performance if timely payments are not made to Contractor for suitably performed work.' },
    { id: 'k06', group: 'always', title: 'Back charges', text: 'No back charges or claim of the Owner for services shall be valid except by an agreement in writing by the Contractor before the work is executed, except in the case of the Contractor\'s failure to meet any requirement of the Contract. In such event, the Owner shall notify the Contractor of such default, in writing, and allow the Contractor reasonable time to correct any deficiency before incurring any cost chargeable to the Contractor.' },
    { id: 'k07', group: 'always', title: 'Work areas', text: 'Owner is to prepare all work areas so as to be acceptable for Contractor to perform its work under the Contract. Owner shall notify Contractor in advance when the site will be ready for Contractor to perform its work and shall provide Contractor with free and unobstructed access so that the work can be commenced promptly and completed without delay. Contractor will not be called upon to start work until sufficient areas are ready to insure continued work.' },
    { id: 'k08', group: 'always', title: 'Time for performance', text: 'Contractor shall be given a reasonable time in which to commence and complete the performance of the Contract. Contractor provides no assurances as to a complete date since the Work is subject to weather conditions, prior commitments, mechanical failures, and other cause beyond Contractor\'s control. Contractor shall not be responsible for delays or default where occasioned by any causes of any kind and extent beyond its control, including but not limited to: delay caused by Owner, architect and/or engineers, delays in transportation, shortages of raw materials, civil disorders, labor difficulties, vendor allocations, fires, floods, accident hazardous waste or controlled substances and acts of God. Contractor shall be entitled to equitable adjustment in the contract price for additional costs due to unanticipated project delays or accelerations. Contractor shall not be obligated to provide any labor or materials outside the scope of work unless Owner shall first agree in writing to equitably adjust the contract price to be paid Contractor.' },
    { id: 'k09', group: 'always', title: 'Workmanship', text: 'All workmanship and materials are guaranteed against defects for a period of one (1) year from the date of substantial completion of installation. This warranty is in lieu of all other warranties, express or implied, including any warranties of merchantability or fitness for a particular purpose. The exclusive remedy shall be that Contractor will replace or repair any part of its work which is found to be defective. Contractor shall not be responsible for special, incidental or consequential damages. Contractor shall not be responsible for damage to its work by other parties or for improper use of equipment by other industry standard practices and will override strict compliance and strict performance. Contractor makes no warranty regarding drainage where the slope provided or allowable is less than two percent (2%). Contractor\'s warranty does not extend to or cover settlement or cracking of asphalt or pavement due to expansive soils, improperly compacted utility trenches, or for failures caused by the inadequate compaction of the subgrade.' },
    { id: 'k10', group: 'always', title: 'Work hours', text: 'Work called for herein is to be performed during Contractor\'s regular working hours as agreed to by the Owner and the Contractor.' },
    { id: 'k11', group: 'always', title: 'Notice', text: 'Any notice or written claim required by the Contract to be submitted to the Owner, on account of charges, extras, delays, acceleration, or otherwise, shall be furnished within a time period, and in a manner to permit the Owner to satisfy the requirements of the Contract, notwithstanding any shorter time period otherwise provided.' },
    { id: 'k12', group: 'always', title: 'Lien rights', text: 'Nothing in this Contract shall serve to void Contractor\'s right to file a lien or claim on its behalf in the event that any payment to Contractor is not timely made.' },
    { id: 'k13', group: 'always', title: 'Labor', text: 'Contractor shall not be bound by any of Owner\'s labor agreements (in whole or in part).' },
    { id: 'k14', group: 'always', title: 'Liquidated damages', text: 'The Owner shall make no demand for liquidated damages for delays in any sum in excess of such amounts as may be specifically named in this Contract and no liquidated damages may be assessed against Contractor for more than the amount paid by the Owner for unexcused delays to the event actually caused by the Contractor.' },
    { id: 'k15', group: 'always', title: 'Schedule', text: 'Contractor shall submit a schedule to Owner, Owner will review and notify Contractor of any schedule conflict. If Contractor finds it necessary to change his schedule, Owner will give his best effort to meet this change in schedule. Contractor shall not be penalized for non-performance and will be paid for work performed.' },
    { id: 'k16', group: 'always', title: 'Insurance restriction', text: 'Notwithstanding any provision to the contrary, Contractor shall maintain the types and limitations on insurance as shown on the attached certificate of insurance. Contractor is not required to waive any claims or rights of subrogation against the Owner or any others for losses and claims covered or paid by Owner\'s workers compensation or general liability insurance. Acceptance of the Certificate of Insurance constitutes acceptance of the insurance of Contractor, including any additional insured requirements. In addition, Contractor shall not provide completed operations under an additional insured requirement.' },
    { id: 'k17', group: 'always', title: 'Indemnity, hold harmless', text: 'To the fullest extent permitted by law, Contractor agrees to protect, defend, indemnify, and hold harmless Owner from and against all liability, loss, claims, demands, damages, suits, costs, fees, fines, penalties, expenses, and causes of action to the extent caused by Contractor or any of Contractor\'s employees, agents, representatives, subcontractors, or suppliers. Any indemnification or hold harmless obligation of the Contractor shall extend only to claims resulting to bodily injury and property damage and then only to that part or proportion of any claim damage, loss or defect that results from the negligence or intentional act of Contractor or someone for whom it is responsible. Nothing in this agreement shall require the Contractor to indemnify any other party from any damages including expenses and attorneys\' fees to persons or property for any amount exceeding the degree Contractor directly caused such damages. Contractor shall not be responsible for fines or assessments made against Owner and Contractor. Contractor retains all rights of subrogation. Contractor will not indemnify anybody for any actions except for Contractor\'s own negligence and only in the proportional amount of its negligence.' },
    { id: 'k18', group: 'always', title: 'Right to rely', text: 'Contractor shall rely on plans, drawings, specifications and other information provided by Owner, Owner, Architect or representatives of each. Contractor assumes no risk for unknown or unforeseen conditions not evident from the plans, drawings, specifications or other information provided to Contractor.' },
    { id: 'k19', group: 'always', title: 'Dispute resolution', text: 'Final determination of contract compliance and all dispute resolutions shall be handled in the jurisdiction and venue of Maricopa County, Arizona, and be governed by the laws of Arizona.' },
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
        hoursPerDay: 8, burdenPct: 25, rateCents: 6500, floorCents: 6500, marginPct: 25, markupPct: 18, consumablesPct: 3,
        truckDayCents: 9500, overheadPct: 10, cushionPct: { service: 10, project: 15 }, equipmentPct: 4, validityDays: 30,
        taxMode: 'included',
        equipment: SEED_EQUIPMENT.map((name) => ({ id: uid(), name, costCents: null, overrideDayCents: null, hidden: false })),
        forgetList: SEED_FORGET.slice(), notePhrases: SEED_NOTES.slice(), clauses: SEED_CLAUSES.map((c) => ({ ...c, hidden: false })),
        // Seeded past his real bids rather than at 1: his paper book is at
        // #3052, and a fresh install handing out #1 would put a bid number on
        // a customer's desk that collides with one he wrote by hand years ago.
        // Settings has the field, and its caption tells him to set it to his
        // real next invoice number on day one.
        nextNumber: 3053, backupEmail: 'adriancantu95@gmail.com',
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
  const CLAUSE_GROUP = ['always', 'trench', 'site', 'hazmat', 'subs'];
  const CATALOG_CATEGORY = ['conduit', 'wire', 'boxes', 'lighting', 'gear', 'rentals'];
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

      if (!strArr(s.forgetList) || !strArr(s.notePhrases)) return null;

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
        if (!isFiniteGte0(b.pricing.cushionPct) || !isFiniteGte0(b.pricing.markupPct)) return null;
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
  function newBid(d, { customerName, title, jobType, dateISO }) {
    const cust = findOrCreateCustomer(d, customerName); const s = d.settings;
    const jt = JOB_TYPE.indexOf(jobType) !== -1 ? jobType : 'service';
    const detail = DETAIL.indexOf(cust.defaultDetail) !== -1 ? cust.defaultDetail : 'full';
    const b = { id: uid(), number: s.nextNumber, customerId: cust.id, title: title || '', dateISO: dateISO || todayISO(),
      status: 'draft', detail, jobType: jt,
      areas: [], misc: { label: 'Supports, anchors, and hardware', cents: 0 },
      // Hidden crew are people who don't work here any more: seeding them onto
      // a new bid would put a chip on the Labor screen for someone he'd have to
      // notice and take off, and would bill their wage until he did.
      labor: { crewIds: s.crew.filter((c) => !c.hidden).slice(0, 2).map((c) => c.id), days: 0, tasks: null },
      rentals: [], equipment: [],
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
      pricing: { marginPct: s.marginPct, rateCents: s.rateCents, cushionPct: s.cushionPct[jt], markupPct: s.markupPct },
      // clauseIds starts null, not empty: "not chosen yet" is what lets the
      // proposal screen offer the Always group once and never argue with him
      // about it again. [] is his answer, and it sticks.
      scope: null, notes: s.notePhrases.length ? [s.notePhrases[0]] : [], clauseIds: null, validityDays: s.validityDays,
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
  function newChangeOrder(d, name) {
    const s = d.settings;
    return {
      id: uid(), name: String(name || ''), areas: [],
      labor: { crewIds: s.crew.filter((c) => !c.hidden).slice(0, 2).map((c) => c.id), days: 0, tasks: null },
    };
  }
  function duplicateBid(d, bidId, dateISO) {
    const src = d.bids.find((b) => b.id === bidId); if (!src) return null;
    const c = JSON.parse(JSON.stringify(src));
    c.id = uid(); c.number = d.settings.nextNumber; d.settings.nextNumber += 1;
    c.dateISO = dateISO || todayISO(); c.status = 'draft'; c.sentAt = null; c.savedToFilesAt = null; c.lostReason = null; c.job = null;
    c.areas.forEach((a) => { a.id = uid(); a.photoIds = []; });
    d.bids.push(c); return c;
  }
  function addCatalogItem(d, { category, name, unit }) {
    const cat = CATALOG_CATEGORY.indexOf(category) !== -1 ? category : 'gear';
    const nm = String(name || '');
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
  function recordCatalogUse(d, id, costCents) { const p = d.catalog.find((x) => x.id === id); if (p) { p.uses += 1; p.lastCostCents = costCents; } }
  function numberInUse(d, number, exceptBidId) { return d.bids.some((b) => b.number === number && b.id !== exceptBidId); }

  return { KEY, uid, todayISO, mondayOf, emptyData, validateImport, load, save, check, loadProblem,
    findOrCreateCustomer, newBid, newJob, jobIsEmpty, newChangeOrder, duplicateBid, addCatalogItem, newTool, recordCatalogUse, numberInUse };
});
