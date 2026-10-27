// Disposable PostgreSQL only. No timers decide operation order: the second
// request starts only after PostgreSQL proves the first is behind our barrier.
import {pool} from "@workspace/db";
import {expect} from "vitest";
export type LockEdge={pid:number;blockers:number[];query:string};
export const lockRows=async(q:string,v:unknown[]=[])=> (await pool.query(q,v)).rows;
export async function graph():Promise<LockEdge[]>{
 return lockRows(`SELECT pid,pg_blocking_pids(pid) AS blockers,left(query,200) AS query
  FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`);
}
function reaches(edges:LockEdge[],pid:number,target:number,seen=new Set<number>()):boolean{
 if(seen.has(pid))return false;seen.add(pid);
 return (edges.find(e=>e.pid===pid)?.blockers??[]).some(p=>p===target||reaches(edges,p,target,seen));
}
export async function until<T>(read:()=>Promise<T>,accept:(v:T)=>boolean,label:string):Promise<T>{
 const end=Date.now()+6000;
 do{const v=await read();if(accept(v))return v;await new Promise(r=>setTimeout(r,10));}while(Date.now()<end);
 throw new Error(`PostgreSQL barrier not established: ${label}`);
}
export async function orderedRace(key:string,first:()=>Promise<unknown>,second:()=>Promise<unknown>){
 const barrier=await pool.connect(),pending:Promise<unknown>[]=[];
 let firstWait:LockEdge[]=[],bothWait:LockEdge[]=[],cycle:LockEdge[]=[];
 try{
  await barrier.query("BEGIN");
  await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);
  const pid=Number((await barrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const one=first();pending.push(one);
  firstWait=await until(graph,g=>g.some(e=>reaches(g,e.pid,pid)),"first request");
  const two=second();pending.push(two);
  bothWait=await until(graph,g=>g.filter(e=>reaches(g,e.pid,pid)).length>=2,"both requests");
  await barrier.query("COMMIT");
  let complete=false;
  const all=Promise.allSettled([one,two]).then(r=>{complete=true;return r;});
  while(!complete){
   const g=await graph();
   if(g.some(e=>reaches(g,e.pid,e.pid)))cycle=g;
   await new Promise(r=>setTimeout(r,10));
  }
  const results=await all;
  return {results,firstWait,bothWait,cycle};
 }finally{
  await barrier.query("ROLLBACK").catch(()=>undefined);
  barrier.release();
  // Even a failed barrier assertion must drain every HTTP/transaction promise.
  await Promise.allSettled(pending);
 }
}
export async function reconcile(product:number,company:number){
 const c=await pool.connect();
 try{
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const read=async(q:string,v:unknown[]=[])=> (await c.query(q,v)).rows;
  const quants=await read("SELECT warehouse_id,variant_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1 ORDER BY warehouse_id,variant_id",[product]);
  const moves=await read("SELECT id,kind,state,variant_id,quantity::text,unit_cost::text,journal_entry_id,source_type FROM stock_moves WHERE product_id=$1 ORDER BY id",[product]);
  const journals=await read(`SELECT j.id,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit
   FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
   WHERE j.id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1) GROUP BY j.id ORDER BY j.id`,[product]);
  const [values]=await read(`SELECT
   (SELECT coalesce(sum(quantity*avg_cost),0) FROM stock_quants WHERE product_id=$1)::text AS stock,
   (SELECT coalesce(sum(quantity*unit_cost),0) FROM stock_moves WHERE product_id=$1 AND kind='transfer' AND state='in_transit')::text AS transit,
   (SELECT coalesce(sum(remaining_qty*unit_cost),0) FROM stock_layers WHERE product_id=$1)::text AS layers,
   (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
    WHERE a.system_key='inventory' AND l.entry_id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1))::text AS ledger`,[product]);
  const audits=await read(`SELECT action,details::jsonb FROM audit_logs WHERE company_id=$1 AND action LIKE 'inventory.%'
   AND ((details::jsonb->>'productId')::integer=$2 OR details::jsonb->>'moveId' IN(SELECT id::text FROM stock_moves WHERE product_id=$2))
   ORDER BY id`,[company,product]);
  const openTransactions=await read(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
   AND pid<>pg_backend_pid() AND state='idle in transaction'`);
  await c.query("COMMIT");
  expect(journals.every(j=>Number(j.debit)===Number(j.credit))).toBe(true);
  expect(Number(values.stock)+Number(values.transit)).toBe(Number(values.ledger));
  expect(Number(values.layers)).toBe(Number(values.stock));
  expect(openTransactions).toEqual([]);
  return {quants,moves,journals,values,audits,openTransactions};
 }finally{await c.query("ROLLBACK").catch(()=>undefined);c.release();}
}
