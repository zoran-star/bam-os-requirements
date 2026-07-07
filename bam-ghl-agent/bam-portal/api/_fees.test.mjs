import { parseFee, applyFee, feeLabel } from "./_fees.js";
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:fail++;console.log((c?"  ✅ ":"  ❌ ")+m);};
// screenshot case: $499 + 13% HST = $563.87
let f=parseFee("+13% HST");
ok(f.kind==="percent"&&f.pct===13, '"+13% HST" -> percent 13');
ok(feeLabel(f)==="13% HST", 'label "13% HST"');
ok(applyFee(49900,f)===56387, '$499 + 13% HST = $563.87 (56387c)');
// no fee -> base unchanged (US academy, the whole point)
ok(parseFee("")===null && parseFee(null)===null && parseFee("HST")===null, "empty/no-number -> null");
ok(applyFee(49900,null)===49900, "no fee -> base unchanged");
// flat
f=parseFee("$25"); ok(f.kind==="flat"&&f.cents===2500&&applyFee(20000,f)===22500, '"$25" -> +2500c');
f=parseFee("25");  ok(f.kind==="flat"&&f.cents===2500, '"25" -> $25');
f=parseFee("$25 admin"); ok(f.label==="$25 admin", 'label "$25 admin"');
f=parseFee("13%"); ok(f.pct===13&&f.label==="13%", '"13%" -> 13% no suffix');
console.log(`\n${fail?"❌":"✅ ALL PASS"}: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
