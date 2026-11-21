import test from "node:test";
import assert from "node:assert/strict";
import {applyLabPlan,labHref} from "../src/lib/lab-room/chat-tools.ts";
test("director tools return a project link only after the correct write succeeds",async()=>{
  const id=crypto.randomUUID(), calls:{path:string;data:object}[]=[];
  const save=async(path:string,data:object)=>{calls.push({path,data});return {id};};
  const plan={tool:"schedule_observations" as const,args:{brief:"สีของเจล",metric:"สี",goal:"สังเกต",condition:"ห้อง",unit:"คะแนน",duration:48,rounds:[24],exception:"พักงาน"}};
  assert.equal(labHref((await applyLabPlan(plan,"director",7,id,save)).labLink),"/lab-room/timed?project=7&id="+id);
  assert.equal(calls[0].path,"/api/timed");assert.equal(calls.length,1);
  await assert.rejects(applyLabPlan(plan,"researcher",7,id,save));assert.equal(calls.length,1);
  await assert.rejects(applyLabPlan(plan,"director",7,id,async()=>({id:"incorrect"})));
  const protein=await applyLabPlan({tool:"protein_study",args:{model:"gfp",brief:"ดูโครงสร้าง"}},"director",7,id,save);
  assert.equal(labHref(protein.labLink),"/lab-room?project=7&order="+id);
  assert.equal(calls[1].path,"/api/lab/projects/7/studies");
  assert.equal(labHref({target:"protein",project:7,id:"https://bad.invalid"}),undefined);
  assert.equal((await applyLabPlan({answer:"ตามข้อมูลที่ระบุ"},"analyst",7,id,save)).text,"ตามข้อมูลที่ระบุ");
});
