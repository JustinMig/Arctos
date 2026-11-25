export async function resolveTextAttachment(request, scope, id) {
  if(!id)return {attachment:null,mediaUrl:''};
  const response=await fetch('https://crm.mayerig.com/api/crm-text-attachments',{
    method:'POST',headers:{Authorization:request.headers.get('authorization')||'','Content-Type':'application/json','X-CRM-Scope':scope},
    body:JSON.stringify({id}),signal:AbortSignal.timeout(20000)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.error||'Attachment unavailable.'),{status:response.status});
  return result;
}
