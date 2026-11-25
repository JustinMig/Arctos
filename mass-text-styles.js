export function installMassTextStyles(){
  if(document.getElementById('crm-mass-text-styles'))return;
  const style=document.createElement('style');
  style.id='crm-mass-text-styles';
  style.textContent=`
    dialog.crm-mass-text-dialog{
      color-scheme:light;color:#172f3f;background:#fff;border:1px solid #c7d5de;
      border-radius:16px;padding:0;margin:auto;width:min(1040px,calc(100vw - 28px));
      max-width:calc(100vw - 28px);height:min(760px,calc(100dvh - 28px));
      max-height:calc(100dvh - 28px);overflow:hidden;font:14px/1.5 Inter,"Segoe UI",Arial,sans-serif;
      box-shadow:0 24px 80px #07131c55;
    }
    dialog.crm-mass-text-dialog::backdrop{background:#07131c99;backdrop-filter:blur(2px)}
    .crm-mass-text-dialog *{box-sizing:border-box}
    .crm-mass-text-dialog .crm-mass-frame{height:100%;display:flex;flex-direction:column;min-height:0;background:#fff;color:#172f3f}
    .crm-mass-text-dialog .crm-mass-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 20px;border-bottom:1px solid #d6e1e7;background:#f3f7fa;flex-shrink:0}
    .crm-mass-text-dialog h2{margin:0;color:#172f3f;font-size:21px;line-height:1.3}
    .crm-mass-text-dialog .crm-mass-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:1;min-height:0}
    .crm-mass-text-dialog .crm-mass-picker{display:flex;flex-direction:column;gap:12px;padding:20px;min-height:0;min-width:0;background:#f8fafc;border-right:1px solid #d6e1e7}
    .crm-mass-text-dialog .crm-mass-compose{display:flex;flex-direction:column;gap:14px;padding:20px;margin:0;min-width:0;min-height:0;overflow:auto;background:#fff}
    .crm-mass-text-dialog label{color:#243e50;font-size:14px;font-weight:600}
    .crm-mass-text-dialog .crm-mass-field{display:grid;gap:7px;min-width:0}
    .crm-mass-text-dialog input[type=search],.crm-mass-text-dialog select,.crm-mass-text-dialog textarea{
      display:block;width:100%;max-width:100%;min-height:44px;margin:0;padding:10px 12px;
      background:#fff;color:#172f3f;border:1px solid #b8cbd7;border-radius:8px;font:inherit;opacity:1;
    }
    .crm-mass-text-dialog input::placeholder,.crm-mass-text-dialog textarea::placeholder{color:#657b8a;opacity:1}
    .crm-mass-text-dialog textarea{min-height:155px;resize:vertical}
    .crm-mass-text-dialog select option{background:#fff;color:#172f3f}
    .crm-mass-text-dialog input[type=checkbox]{appearance:auto;width:18px;height:18px;min-width:18px;min-height:18px;margin:2px 0 0;padding:0;flex:0 0 18px;accent-color:#1a647b}
    .crm-mass-text-dialog .crm-mass-tools{display:flex;flex-wrap:wrap;gap:8px}
    .crm-mass-text-dialog .crm-mass-count{margin:0;color:#405a6b;font-size:13px}
    .crm-mass-text-dialog .crm-mass-recipients{display:grid;align-content:start;gap:8px;min-height:100px;overflow:auto;flex:1}
    .crm-mass-text-dialog .crm-mass-recipient{display:flex;align-items:flex-start;gap:12px;padding:11px 12px;background:#fff;border:1px solid #d0dce4;border-radius:9px;cursor:pointer}
    .crm-mass-text-dialog .crm-mass-recipient>span{display:grid;gap:2px;min-width:0;overflow-wrap:anywhere}
    .crm-mass-text-dialog .crm-mass-recipient strong{color:#172f3f;font-size:14px;font-weight:650}
    .crm-mass-text-dialog small{color:#526c7d;font-size:12px;line-height:1.5}
    .crm-mass-text-dialog .crm-mass-consent{display:flex;align-items:flex-start;gap:10px;font-size:13px;font-weight:400}
    .crm-mass-text-dialog .crm-mass-status{margin:0;min-height:22px;color:#244d64;overflow-wrap:anywhere;font-size:13px}
    .crm-mass-text-dialog .text-attachment-picker{display:grid;gap:8px;padding:12px;background:#f1f6f9;border:1px solid #c7d9e3;border-radius:9px;min-width:0}
    .crm-mass-text-dialog .text-attachment-picker label{display:grid;gap:8px}
    .crm-mass-text-dialog input[type=file]{display:block;width:100%;max-width:100%;min-height:44px;padding:0;background:transparent;color:#172f3f;border:0;font:inherit}
    .crm-mass-text-dialog input[type=file]::file-selector-button{min-height:40px;margin:0 10px 0 0;padding:8px 12px;border:1px solid #8baaba;border-radius:7px;background:#fff;color:#174b62;font:inherit;font-weight:600;cursor:pointer}
    .crm-mass-text-dialog [data-file-name]{color:#172f3f;overflow-wrap:anywhere}
    .crm-mass-text-dialog button.btn{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:9px 12px;border:1px solid #bdced9;border-radius:8px;background:#eef4f7;color:#244357;font:inherit;font-weight:650;cursor:pointer}
    .crm-mass-text-dialog button.btn.primary{background:#195c75;border-color:#195c75;color:#fff}
    .crm-mass-text-dialog button:disabled{opacity:.55;cursor:default}
    .crm-mass-text-dialog [data-send]{width:100%;margin-top:auto}
    .crm-mass-text-dialog :is(input,select,textarea,button):focus-visible{outline:3px solid #62a3c8;outline-offset:2px}
    @media(max-width:700px){
      dialog.crm-mass-text-dialog{width:calc(100vw - 12px);max-width:calc(100vw - 12px);height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:12px}
      .crm-mass-text-dialog .crm-mass-head{padding:12px 14px}
      .crm-mass-text-dialog h2{font-size:18px}
      .crm-mass-text-dialog .crm-mass-layout{display:flex;flex-direction:column;overflow:auto}
      .crm-mass-text-dialog .crm-mass-picker{padding:14px;gap:9px;min-height:auto;flex-shrink:0;border-right:0;border-bottom:1px solid #d6e1e7}
      .crm-mass-text-dialog .crm-mass-recipients{height:160px;max-height:24dvh;min-height:80px;flex:auto}
      .crm-mass-text-dialog .crm-mass-compose{padding:14px;gap:12px;overflow:visible;flex-shrink:0}
      .crm-mass-text-dialog textarea{min-height:110px}
      .crm-mass-text-dialog :is(input[type=search],select,textarea){font-size:16px}
    }
  `;
  document.head.append(style);
}
