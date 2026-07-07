import { offerToTemplatePayloads, _internals } from "./_offer-schedule.js";
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log("  ✅ "+m);} else {fail++;console.log("  ❌ "+m);} };

console.log("\n── Detail MS/HS: Mon+Wed 6-8pm, cap 25 ──");
const detail = { id:"off-1", title:"Training", data:{ capacity:25, classes:[
  { title:"MS / HS", consistent:"Yes", weekly_times:[ { days:["Mon","Wed"], start:"18:00", end:"20:00", location:"1079 Linbrook" } ] }
]}};
let r = offerToTemplatePayloads(detail, { clientId:"c-1", bookableProgramId:"p-1" });
console.log(JSON.stringify(r.templates[0].payload, null, 2));
ok(r.templates.length===1, "one template");
const p = r.templates[0].payload;
ok(p.recurrence_rule==="WEEKLY:MO,WE", "recurrence WEEKLY:MO,WE");
ok(p.default_start_time==="18:00" && p.default_end_time==="20:00", "times 18:00-20:00");
ok(p.default_capacity===25, "capacity 25 from offer");
ok(p.slot_type==="GROUP_CLASS", "slot_type GROUP_CLASS");
ok(p.bookable_program_id==="p-1", "program attached");
ok(p.default_location==="1079 Linbrook", "location as free text");
ok(p.name==="Training - MS / HS (Mon, Wed)", "human name: "+p.name);
ok(r.templates[0].matchKey==="WEEKLY:MO,WE|18:00|20:00", "matchKey for dedupe");

console.log("\n── Edge: no capacity set ──");
r = offerToTemplatePayloads({ id:"o", title:"T", data:{ classes:[{title:"A",consistent:"Yes",weekly_times:[{days:["Sat"],start:"10:00",end:"11:00"}]}] }}, { clientId:"c" });
ok(r.templates[0].payload.default_capacity===undefined, "no capacity -> omit (endpoint default 10)");
ok(r.warnings.some(w=>/capacity/i.test(w)), "warns about missing capacity");

console.log("\n── Edge: 12h times + multi-day ──");
r = offerToTemplatePayloads({ id:"o", title:"Elite", data:{ capacity:12, classes:[{title:"AM",consistent:"Yes",weekly_times:[{days:["Mon","Tue","Thu"],start:"6:00 AM",end:"7:30 AM"}]}] }}, { clientId:"c" });
ok(r.templates[0].payload.default_start_time==="06:00" && r.templates[0].payload.default_end_time==="07:30", "12h -> 24h (06:00-07:30)");
ok(r.templates[0].payload.recurrence_rule==="WEEKLY:MO,TU,TH", "multi-day sorted MO,TU,TH");

console.log("\n── Edge: ad-hoc class + empty times skipped ──");
r = offerToTemplatePayloads({ id:"o", title:"T", data:{ capacity:10, classes:[
  { title:"WhatsApp group", consistent:"No", schedule_info:"weekly WhatsApp" },
  { title:"Empty", consistent:"Yes", weekly_times:[] }
]}}, { clientId:"c" });
ok(r.templates.length===0, "ad-hoc + empty produce 0 templates");
ok(r.warnings.some(w=>/ad-hoc/i.test(w)) && r.warnings.some(w=>/no weekly times/i.test(w)), "warns on both");

console.log("\n── Edge: bad time / no days / dup rows ──");
r = offerToTemplatePayloads({ id:"o", title:"T", data:{ capacity:10, classes:[{title:"X",consistent:"Yes",weekly_times:[
  {days:["Mon"],start:"25:00",end:"26:00"},
  {days:[],start:"10:00",end:"11:00"},
  {days:["Wed"],start:"18:00",end:"20:00"},
  {days:["Wed"],start:"18:00",end:"20:00"}
]}] }}, { clientId:"c" });
ok(r.templates.length===1, "only the one valid, non-dup row survives");
ok(r.templates[0].payload.recurrence_rule==="WEEKLY:WE", "the valid Wed row");

console.log("\n── unit: normTime / normDay ──");
ok(_internals.normTime("18:00")==="18:00" && _internals.normTime("6:30pm")==="18:30" && _internals.normTime("12:00 AM")==="00:00" && _internals.normTime("nope")===null, "normTime cases");
ok(_internals.normDay("Monday")==="MO" && _internals.normDay("tue")==="TU" && _internals.normDay("x")===null, "normDay cases");

console.log(`\n${fail===0?"✅ ALL PASS":"❌ FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
