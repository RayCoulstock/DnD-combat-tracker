import test from 'node:test'
import assert from 'node:assert/strict'
import {summarizeBrowserReports} from './ci/browser-summary.mjs'
const report=(stats={})=>({stats:{duration:100,expected:20,skipped:0,unexpected:0,flaky:0,...stats},suites:[{title:'Private fixture',attachments:['secret']} ]})
test('serial spec summaries include every case and retain earlier failures',()=>{
 assert.deepEqual(summarizeBrowserReports([report({expected:19,unexpected:1}),report()]),{duration:200,expected:39,skipped:0,unexpected:1,flaky:0})
 const summary=summarizeBrowserReports([report({expected:18,skipped:1,flaky:1}),report()]);assert.equal(summary.skipped,1);assert.equal(summary.flaky,1);assert.equal(JSON.stringify(summary).includes('Private'),false);assert.equal(JSON.stringify(summary).includes('secret'),false)
})
test('missing or invalid spec reports fail instead of presenting incomplete success',()=>{
 for(const reports of [[],[{}],[report({unexpected:-1})],[report({expected:1.5})],[report({duration:Infinity})],[report({expected:'20'})]])assert.throws(()=>summarizeBrowserReports(reports))
})

test('all spec reports contribute to the aggregate without losing an early failure',()=>{
 const reports=Array.from({length:35},(_,i)=>report(i===0?{expected:19,unexpected:1}:{}))
 assert.deepEqual(summarizeBrowserReports(reports),{duration:3500,expected:699,skipped:0,unexpected:1,flaky:0})
})
