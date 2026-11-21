// Keep a successfully submitted job visible even if the runner is busy or a status read fails.
export async function awaitChatQsar<Receipt extends {id:string;state?:string}>(initial:Receipt,
  read:()=>Promise<Receipt>,signal:AbortSignal,wait=()=>new Promise(resolve=>setTimeout(resolve,1400))) {
  let row=initial
  for(let attempt=0;attempt<8 && ["queued","preparing","running"].includes(row.state||"");attempt++){
    await wait()
    if(signal.aborted)throw new DOMException("Aborted","AbortError")
    try{
      const latest=await read()
      if(latest?.id!==initial.id)break
      row=latest
    }catch(e){if(signal.aborted)throw e;break}
  }
  return row
}
