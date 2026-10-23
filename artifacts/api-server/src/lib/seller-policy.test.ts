import {describe,it,expect} from "vitest";
import {allocateCents,saleLineCents,commissionCents} from "./seller-policy";
describe("source seller allocation",()=>{
 it("uses exact percentage basis points and symmetric refund cents",()=>{
  expect(commissionCents(5000,2.01)).toBe(101);
  expect(commissionCents(-5000,2.01)).toBe(-101);
  expect(commissionCents(9_000_000_000_000_000,100)).toBe(9_000_000_000_000_000);
 });
 it("retains all source cents and deterministic discount rounding",()=>{
  const result=saleLineCents(19001,[100,100],[100,100]);
  expect(result).toEqual({net:[9501,9500],gross:[10000,10000]});
  expect(result.gross.map((g,n)=>g-result.net[n]!)).toEqual([499,500]);
 });
 it("does not reject positive micro-quantity lines rounded to a cent only in aggregate",()=>{
  expect(allocateCents(1,[0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001]).reduce((a,b)=>a+b,0)).toBe(1);
  const result=saleLineCents(1,[0.004,0.006],[0.004,0.003]);
  expect(result.net.reduce((a,b)=>a+b,0)).toBe(1);
  expect(result.gross.reduce((a,b)=>a+b,0)).toBe(1);
  expect(result.gross.every((g,n)=>g>=result.net[n]!)).toBe(true);
 });
});
