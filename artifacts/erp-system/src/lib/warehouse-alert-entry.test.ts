import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import * as actions from "./pos-actions";
type Selection={resource:string;actions:readonly string[]}|null;
const canReach=(actions as unknown as {canReachWarehouseAlerts:(s:Selection,p:string)=>boolean}).canReachWarehouseAlerts;
describe("native warehouse alert entry for selected scoped inventory responsibilities",()=>{
 it("lets an explicit inventory reader/editor reach only the warehouse-rule route",()=>{
  expect(canReach({resource:"inventory",actions:["inventory.read"]},"/inventory/reorder")).toBe(true);
  expect(canReach({resource:"inventory",actions:["inventory.read","inventory.reorder.manage"]},"/inventory/reorder")).toBe(true);
  expect(canReach({resource:"inventory",actions:["inventory.read"]},"/settings")).toBe(false);
 });
 it("does not infer inventory access from a title, another resource, or manage without read",()=>{
  expect(canReach(null,"/inventory/reorder")).toBe(false);
  expect(canReach({resource:"pos",actions:["inventory.read"]},"/inventory/reorder")).toBe(false);
  expect(canReach({resource:"inventory",actions:["inventory.reorder.manage"]},"/inventory/reorder")).toBe(false);
 });
 it("wires the same capability into both protected entry and scoped navigation",()=>{
  const app=readFileSync(`${process.cwd()}/src/App.tsx`,"utf8");
  const layout=readFileSync(`${process.cwd()}/src/components/layout.tsx`,"utf8");
  expect(app).toContain("canReachWarehouseAlerts(selected,location)");
  expect(layout).toContain('canReachWarehouseAlerts(selected,"/inventory/reorder")');
 });
});
