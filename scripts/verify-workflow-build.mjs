import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
// A fresh process models a cold Vercel invocation: no action route has run
// and registered its steps as a side effect before the workflow handler loads.
const route=require('../.next/server/app/.well-known/workflow/v1/flow/route.js');
await route.routeModule.ensureUserland();
const steps=globalThis[Symbol.for('@workflow/core//registeredSteps')];
for(const name of ['claim','populate','html','mobile','finish','dispatchNext']){
  assert.ok(steps?.has(`step//./workflows/discovery//${name}`),`Missing cold-start workflow step: ${name}`);
}
console.log('All six discovery steps are registered in a cold workflow handler.');
