import { readTokenFromHash } from "./team-access";

// Memory only, shared across a same-route remount after the address is cleaned.
// It is never persisted in storage, a query string, server logs or history state.
let pending: {path:string;token:string}|null=null;
export function captureActivationToken(path:string,hash:string):string|null {
  if(!path.endsWith("/team-activate")){pending=null;return null;}
  const token=readTokenFromHash(hash);
  if(token)pending={path,token};
  return pending?.path===path?pending.token:null;
}
export function clearActivationToken(){pending=null;}
