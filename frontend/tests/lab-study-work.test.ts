import assert from "node:assert/strict";
import test from "node:test";
import {applyWorkPlan,type WorkPlan} from "../src/lib/lab-room/work-tools.ts";

test("study and timed chat receipts refer to the persisted record and the original user message", async()=>{
  const id=crypto.randomUUID(),turn=crypto.randomUUID();
  const create:WorkPlan={tool:"create_study_record",args:{discipline:"stability",brief:"ติดตามสีของเจล",reaction_steps:null,
    parallel:false,start_date:"2026-01-31",months:[0,1,3]}};
  const receipt=await applyWorkPlan(create,9,id,{save:async(path,data)=>{
    assert.equal(path,"/api/lab/projects/9/studies");
    assert.deepEqual(data,{id,brief:"ติดตามสีของเจล",discipline:"stability",start_date:"2026-01-31",months:[0,1,3]});
    return {id,stages:[{id:"M0",role:"analyst",status:"ready",title:"เดือน 0"}]};
  }});
  assert.deepEqual(receipt.labLink,{target:"orders",project:9,id});
  const observation:WorkPlan={tool:"update_timed_study",args:{study_id:id,version:2,action:"observe",observed_at:"now",value:5.7,
    unit:"pH",source:"lab-note-2",note:"วัดซ้ำ",hours:null}};
  const timed=await applyWorkPlan(observation,9,turn,{save:async(path,data)=>{
    assert.equal(path,"/api/timed/"+id+"/events");
    assert.deepEqual(data,{command_id:turn,version:2,action:"observe",value:5.7,unit:"pH",source:"lab-note-2",observed:"now",note:"วัดซ้ำ"});
    return {row:{id,state:"active",chat_commands:[{id:turn}]}};
  }});
  assert.deepEqual(timed.labLink,{target:"timed",project:9,id});
  await assert.rejects(applyWorkPlan(observation,9,turn,{save:async()=>({row:{id,state:"active"}})}));
  const stage:WorkPlan={tool:"record_study_stage",args:{study_id:id,sequence:2,stage:"plan",disposition:"hold",
    observed_on:"2026-01-31",evidence:"record-A",finding:"รอข้อมูล",unit:null,measurements:[]}};
  const recorded=await applyWorkPlan(stage,9,turn,{save:async(path,data)=>{
    assert.equal(path,"/api/lab/projects/9/orders/"+id+"/stages/plan/results");
    assert.equal((data as {id:string}).id,turn);
    return {id,events:[{command:{id:turn}}]};
  }});
  assert.equal(recorded.labLink.id,id);
});
