import {requireCrmUser,smsConnectionStatus} from '../server/communications.js';
export async function GET(request){
  try{
    await requireCrmUser(request);
    return Response.json(await smsConnectionStatus(),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return Response.json({error:error.message||'Texting is unavailable.'},{status:Number(error.status)||503});}
}
