import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const release=vi.hoisted(()=>vi.fn(async()=>{}));
const reserve=vi.hoisted(()=>vi.fn(async()=>release));
const log=vi.hoisted(()=>vi.fn());
vi.mock("../lib/usage-guard",async importOriginal=>({...await importOriginal<typeof import("../lib/usage-guard")>(),reserveModelCall:reserve}));
vi.mock("../lib/logs",()=>({logLlmCall:log,usageInt:(v:unknown)=>v==null?null:Number(v)}));
import {llmChatJsonWith,llmEmbed,validateEmbeddingRows} from "../lib/llm";
import {checkBudget,positiveLimit} from "../lib/usage-guard";
import {getLlmEmbeddingConfig,validateModelEndpoint} from "../lib/config";

const cfg={baseUrl:"https://example.com/v1",apiKey:"test",model:"test-model"};
beforeEach(()=>{vi.clearAllMocks();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("provider safety",()=>{
 it("does not retry authentication or throttling failures",async()=>{
  for(const status of [401,403,429]){
   const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:"thinking unsupported"}}),{status}));vi.stubGlobal("fetch",fetch);
   await expect(llmChatJsonWith(cfg,[{role:"user",content:"hi"}])).rejects.toThrow(`HTTP ${status}`);
   expect(fetch).toHaveBeenCalledTimes(1);
  }
 });
 it("only drops an explicitly unsupported extension",async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:{message:"unknown parameter thinking"}}),{status:400})).mockResolvedValueOnce(new Response(JSON.stringify({model:"resolved-model",usage:{prompt_tokens:5,completion_tokens:3},choices:[{message:{content:'{"ok":true}'}}]})));
  vi.stubGlobal("fetch",fetch);
  await expect(llmChatJsonWith(cfg,[{role:"user",content:"hi"}],{maxTokens:200})).resolves.toEqual({ok:true});
  const body=JSON.parse(fetch.mock.calls[1][1].body);expect(body.thinking).toBeUndefined();expect(body.max_tokens).toBe(200);
  expect(release).toHaveBeenCalledWith(8);expect(log).toHaveBeenCalledWith(expect.objectContaining({providerModel:"resolved-model"}));
 });
 it("sends explicit dimensions, avoids ambiguous batches, records token usage",async()=>{
  vi.stubEnv("LLM_EMBEDDING_BASE_URL",cfg.baseUrl);vi.stubEnv("LLM_EMBEDDING_API_KEY","test");vi.stubEnv("LLM_EMBEDDING_MODEL","qwen3.7-text-embedding-flash");vi.stubEnv("LLM_EMBEDDING_DIMENSIONS","2");
  const fetch=vi.fn(async()=>new Response(JSON.stringify({model:"qwen3.7-text-embedding-flash",usage:{prompt_tokens:7},data:[{index:0,embedding:[0.1,0.2]}]})));vi.stubGlobal("fetch",fetch);
  expect(await llmEmbed(["first","second"])).toEqual([[0.1,0.2],[0.1,0.2]]);expect(fetch).toHaveBeenCalledTimes(2);
  for(const call of fetch.mock.calls){const body=JSON.parse((call as unknown as [string,RequestInit])[1].body as string);expect(body.dimensions).toBe(2);expect(body.input).toHaveLength(1);}
  expect(log).toHaveBeenCalledWith(expect.objectContaining({promptTokens:7}));
 });
 it("rejects zero vectors",()=>{
  expect(()=>validateEmbeddingRows({data:[{index:0,embedding:[0,0]}]},1,2)).toThrow();
 });
 it("rejects a provider response from a different embedding model",async()=>{
  vi.stubEnv("LLM_EMBEDDING_BASE_URL",cfg.baseUrl);vi.stubEnv("LLM_EMBEDDING_API_KEY","test");vi.stubEnv("LLM_EMBEDDING_MODEL","requested");vi.stubEnv("LLM_EMBEDDING_DIMENSIONS","2");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({model:"different",data:[{index:0,embedding:[1,2]}]}))));
  await expect(llmEmbed(["test"])).rejects.toThrow("不同模型");
 });
 it("rejects duplicate indices, dimension mismatches and non-finite/coerced values",()=>{
  for(const data of [{data:[{index:0,embedding:[1,2]},{index:0,embedding:[3,4]}]}, {data:[{index:0,embedding:[1]}]}, {data:[{index:0,embedding:[1,Infinity]}]}, {data:[{index:0,embedding:[1,"2"]}]}])expect(()=>validateEmbeddingRows(data,data.data.length,2)).toThrow();
 });
 it("rejects unsafe URL and dimension configuration",()=>{
  for(const url of ["http://example.com","https://name:secret@example.com","https://example.com?key=test"])expect(()=>validateModelEndpoint(url)).toThrow();
  expect(validateModelEndpoint("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
  vi.stubEnv("LLM_EMBEDDING_BASE_URL",cfg.baseUrl);vi.stubEnv("LLM_EMBEDDING_API_KEY","test");vi.stubEnv("LLM_EMBEDDING_MODEL","test");vi.stubEnv("LLM_EMBEDDING_DIMENSIONS","Infinity");expect(()=>getLlmEmbeddingConfig()).toThrow();
 });
});
describe("budget admission",()=>{
 const base={active:0,actorActive:0,minuteCalls:0,globalMinuteCalls:0,dailyTokens:0,actorTokens:0};
 it("blocks concurrency, rate and daily overspend before HTTP",()=>{
  expect(()=>checkBudget(base,100)).not.toThrow();
  for(const state of [{active:4},{actorActive:2},{minuteCalls:60},{globalMinuteCalls:120},{dailyTokens:1_999_950},{actorTokens:499_950}])expect(()=>checkBudget({...base,...state},100)).toThrow();
 });
 it("fails closed on invalid limits",()=>{vi.stubEnv("MODEL_MAX_CONCURRENT","NaN");expect(()=>positiveLimit("MODEL_MAX_CONCURRENT",4)).toThrow();});
});
