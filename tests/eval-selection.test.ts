import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { evaluationBudgetStop } from "../eval/selection";
describe("bounded evaluation selection", () => {
 it.each([[true,45,44,"insufficient_free_quota_for_full_suite"],[true,45,45,null],[false,11,1,null],[false,11,0,"exhausted_free_quota"],[true,45,NaN,"unknown_free_quota"]] as const)("checks free-budget bounds before starting (%s,%s,%s)", (full,planned,remaining,expected) => {
  expect(evaluationBudgetStop(full,planned,remaining)).toBe(expected);
 });
 function offline(args: string[]) {
  return spawnSync(process.execPath,["--conditions=react-server","eval/run.ts",...args],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,OPENROUTER_API_KEY:""},timeout:10000});
 }
 it("selects affected cases for one repetition without changing the frozen corpus or making requests", () => {
  const result=offline(["--cases=E05,E14,E15","--repetitions=1"]);
  expect(result.status).toBe(0);
  const data=JSON.parse(result.stdout);
  expect(data).toMatchObject({cases:3,selected_case_ids:["E05","E14","E15"],repetitions:1,planned_attempts:3,live_calls:0,suite_sha256:"238d2505377ad5ba94165b72ce9e5e375699288cf7369389804188d8cfb90bba"});
 });
 it("keeps the default full suite at 15 cases and exactly 45 planned attempts", () => {
  const result=offline([]);expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({cases:15,repetitions:3,planned_attempts:45,live_calls:0});
 });
 it.each(["--cases=E99","--cases=E05,E05","--cases=","--repetitions=0","--repetitions=4","--repetitions=1.5","--unknown-flag"].map(arg=>({args:[arg]})))("rejects invalid bounds $args before credentials or inference", ({args}) => {
  const result=offline(args);expect(result.status).not.toBe(0);expect(result.stderr).toContain("Invalid evaluation selection");
 });
});
