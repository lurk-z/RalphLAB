import test from "node:test";
import assert from "node:assert/strict";
import {applyQsarPlan} from "../src/lib/lab-room/qsar-chat-tools.ts";
import {awaitChatQsar} from "../src/lib/lab-room/wait-qsar.ts";

test("submitted QSAR receives its exact computed result or retains its last valid receipt",async()=>{
  const job={id:crypto.randomUUID(),state:"queued"},signal=new AbortController().signal;
  const wait=async()=>undefined, final={...job,state:"complete"};
  let reads=0;
  assert.deepEqual(await awaitChatQsar(job,async()=>++reads===1?{...job,state:"running"}:final,signal,wait),final);
  assert.equal(reads,2);
  assert.deepEqual(await awaitChatQsar(job,async()=>({...final,id:crypto.randomUUID()}),signal,wait),job);
  assert.deepEqual(await awaitChatQsar(job,async()=>{throw Error("offline");},signal,wait),job);
  reads=0;
  assert.deepEqual(await awaitChatQsar(job,async()=>{reads++;return job;},signal,wait),job);
  assert.equal(reads,8);
  await assert.rejects(awaitChatQsar(job,async()=>final,AbortSignal.abort(),wait),{name:"AbortError"});
});

test("uses only persisted receipt values and links to the exact QSAR job",async()=>{
  const id=crypto.randomUUID(),urls:string[]=[];
  const formula={region:"face" as const,ingredients:[{cid:753,percent:5},{cid:962,percent:95}]};
  const job={id,state:"queued",formula};
  const io={save:async(path:string,body:object)=>{urls.push(path);assert.deepEqual(body,{...formula,id});return job;},
    read:async(path:string)=>{urls.push(path);return {...job,state:"complete",result:{endpoints:{skin:{peak_score:0,confidence:"Low",in_domain:false}}}};}};
  const saved=await applyQsarPlan({tool:"run_chat_qsar",args:formula},4,id,io);
  assert.equal(saved.labLink?.id,id);assert.match(saved.text,/รอเครื่องคำนวณ/);assert.doesNotMatch(saved.text,/100/);
  const read=await applyQsarPlan({tool:"read_chat_qsar",args:{job_id:id,use_latest:false}},4,id,io);
  assert.match(read.text,/0\/100/);assert.match(read.text,/นอกขอบเขต/);
  assert.deepEqual(urls,["/api/lab/projects/4/chat-qsar","/api/lab/projects/4/chat-qsar?job="+id]);
  const latest={tool:"read_chat_qsar" as const,args:{job_id:"",use_latest:true}};
  assert.match((await applyQsarPlan(latest,4,id,{...io,read:async()=>null})).text,/ยังไม่มีงาน/);
  await assert.rejects(applyQsarPlan({tool:"read_chat_qsar",args:{job_id:id,use_latest:false}},4,id,{...io,read:async()=>({...job,id:crypto.randomUUID()})}));
});
