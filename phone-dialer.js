export function ringCentralHref(value,device=navigator){
  const digits=String(value||'').replace(/\D/g,''),number=digits.length===10?'1'+digits:digits;
  if(!/^1\d{10}$/.test(number))return '';
  const ua=device.userAgent||'',platform=device.platform||'';
  const ios=/iPad|iPhone|iPod/i.test(ua)||(/^Mac/i.test(platform)&&(device.maxTouchPoints||0)>1);
  const apple=!ios&&(/Macintosh|Mac OS X/i.test(ua)||/^Mac/i.test(platform));
  return apple?'tel:+'+number:'https://app.ringcentral.com/r/call?number='+encodeURIComponent(number);
}
export function callLink(phone,label='Call in RingCentral'){
  const href=ringCentralHref(phone);
  if(!href)return null;
  const link=document.createElement('a');link.href=href;link.className='btn secondary';link.textContent=label;
  if(href.startsWith('https:')){link.target='_blank';link.rel='noopener noreferrer';}
  return link;
}
