import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
// Only aggregate Playwright's numerical counters. Never publish fixture names,
// response bodies, screenshots, traces, session data or report attachments.
export function summarizeBrowserReports(reports){
 if(!reports.length)throw Error('Browser reports are required.')
 const result={duration:0,expected:0,skipped:0,unexpected:0,flaky:0}
 for(const report of reports){
  for(const key of Object.keys(result)){
   const value=report?.stats?.[key]
   if(!Number.isFinite(value)||value<0||(key!=='duration'&&!Number.isSafeInteger(value)))throw Error('Invalid browser summary counter.')
   result[key]+=value
  }
 }
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const reports=process.argv.slice(2).map(path=>JSON.parse(readFileSync(path,'utf8')))
 process.stdout.write(JSON.stringify(summarizeBrowserReports(reports),null,2)+'\n')
}
